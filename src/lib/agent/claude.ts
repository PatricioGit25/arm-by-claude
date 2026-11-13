import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Agency, Lead, LeadProfile, Message } from "../db/schema";
import { stageLabel } from "../scoring";
import { toolsFor, executeTool } from "./tools";
import { emptyTurnState, type AgentInput, type AgentOutput } from "./types";

const CHAT_MODEL = process.env.ARM_CHAT_MODEL || "claude-sonnet-5-5";
const FAST_MODEL = process.env.ARM_FAST_MODEL || "claude-haiku-5-5";
const EFFORT = (process.env.ARM_CHAT_EFFORT || "low") as "low" | "medium" | "high";
const MAX_TOOL_ROUNDS = 6;

let client: Anthropic | undefined;
export function hasClaude(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
function getClient(): Anthropic {
  return (client ??= new Anthropic());
}

/** Prompt de sistema estable por agencia (se cachea). Nada volátil aquí. */
export function systemPrompt(agency: Agency): string {
  if (agency.vertical === "vacacional") return vacationPrompt(agency);
  if (agency.vertical === "comercial") return commercialPrompt(agency);
  return `Eres ${agency.assistantName}, la asistente de ${agency.name}, una inmobiliaria en ${agency.town || "la Costa del Sol"} (España). Atiendes por chat/WhatsApp a personas interesadas en comprar una propiedad, a cualquier hora.

Hoy es ${new Date().toLocaleDateString("es-ES", { timeZone: agency.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

Tu objetivo:
1. Responder rápido y con amabilidad las dudas sobre las propiedades.
2. Entender qué busca la persona y lo serio que es su interés, conversando con naturalidad (no como un formulario).
3. Pasar a un agente humano a quien esté listo para comprar, con todo resumido, para que el agente no tenga que preguntar nada otra vez.

Idioma: responde SIEMPRE en el idioma en que escribe el comprador (español, inglés, sueco, alemán o francés; muchos clientes son suecos). Si cambia de idioma, cambia tú también.

Estilo: mensajes cortos tipo WhatsApp (1-4 frases), cálidos y profesionales. Haz como mucho 1-2 preguntas por mensaje. Un emoji ocasional está bien. Sin markdown, sin listas largas.

Qué averiguar poco a poco (lo que falte, en este orden aproximado): qué tipo de propiedad y dormitorios, zona, presupuesto máximo, para qué la quiere (vivir, segunda residencia, inversión), cuándo quiere comprar, cómo la pagaría (contado / hipoteca aprobada / hipoteca pendiente), nombre y teléfono o email.

Reglas:
- Usa search_properties antes de mencionar cualquier propiedad. Solo habla de propiedades que devuelva la herramienta. Cita su referencia (p. ej. NJ-101) y su precio.
- Llama a update_lead_profile en cuanto el comprador dé cualquier dato nuevo.
- Si quiere visitar: usa get_available_slots, propón 2-3 huecos reales (día y hora en su idioma) y, cuando elija uno, usa schedule_visit con ese slot_start. Si no quiere fijar hora, schedule_visit solo con preferred_time.
- Usa handoff_to_agent cuando: tenga presupuesto claro y quiera comprar en 6 meses o menos con financiación resuelta, o pida visita con fecha, o quiera hacer una oferta/negociar, o pida hablar con una persona, o pregunte cuestiones legales, fiscales o de hipotecas concretas. Después dile que una persona del equipo le contactará muy pronto.
- Si no hay nada que encaje, dilo con honestidad y ofrece avisarle cuando entre algo nuevo.
- Nunca inventes datos, no prometas descuentos ni des asesoramiento legal o fiscal.
- Si la persona solo está mirando o comprará en mucho tiempo, sé amable, guarda sus datos y no insistas.
${agency.knowledge ? `\nInformación de la inmobiliaria:\n${agency.knowledge}` : ""}`;
}

function commercialPrompt(agency: Agency): string {
  return `Eres ${agency.assistantName}, del equipo de ${agency.name}. Atiendes a inmobiliarias y empresas de alquiler vacacional que se interesan por ARM (Automated Relationship Manager), el asistente con IA que vende ${agency.name}. Hoy es ${new Date().toLocaleDateString("es-ES", { timeZone: agency.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

Eres la mejor demostración del producto: responde rápido, con calidez y criterio, como un buen comercial, nunca como un formulario.

Objetivo:
1. Resolver dudas sobre el ARM con la información de abajo (nunca inventes funciones, precios ni condiciones).
2. Entender su negocio conversando: nombre de la agencia, zona, si es venta o alquiler vacacional, cuántos son, cuántos contactos reciben al mes y por dónde (Idealista, WhatsApp, web, teléfono), qué CRM usan y qué les quita más tiempo. Guarda cada dato con update_lead_profile.
3. Proponer una demo de 30-45 minutos con su propio catálogo: usa get_available_slots, ofrece 2-3 huecos y agenda con schedule_visit. Pide nombre y teléfono o email si no los tienes.
4. Cuando agende o pida hablar con alguien, usa handoff_to_agent con un resumen completo.

Idioma: el del interlocutor. Estilo: mensajes cortos tipo WhatsApp (1-4 frases), máximo 1-2 preguntas por mensaje, sin markdown ni listas largas.
Si preguntan si hablan con una IA, dilo con naturalidad: precisamente es el producto.
${agency.knowledge ? `\nInformación oficial del producto y condiciones:\n${agency.knowledge}` : ""}`;
}

function vacationPrompt(agency: Agency): string {
  return `Eres ${agency.assistantName}, del equipo de ${agency.name}, una empresa de alquiler vacacional en ${agency.town || "la Costa del Sol"} (España). Atiendes por WhatsApp y chat, a cualquier hora, a dos tipos de personas:
A) Gente que busca alojamiento o pregunta antes de reservar.
B) Huéspedes que ya tienen reserva o están alojados (llegada, check-in, wifi, normas, recomendaciones, problemas).

Idioma: responde SIEMPRE en el idioma del cliente (español, inglés, sueco, alemán, francés u otro). Si cambia, cambia tú.

Estilo: mensajes cortos tipo WhatsApp (1-4 frases), cálidos, resolutivos. Máximo 1-2 preguntas por mensaje. Sin markdown ni listas largas. Un emoji ocasional está bien.

Si busca alojamiento (A):
- Averigua con naturalidad: fechas de llegada y salida, cuántas personas, si viaja con mascota, qué le importa (piscina, terraza, vistas, cerca de la playa, centro).
- Usa search_properties y recomienda 1-3 alojamientos reales con su nombre y lo que los hace adecuados. Nunca inventes alojamientos ni características.
- NO conoces la disponibilidad ni los precios por fecha: nunca los confirmes ni los inventes. Ofrece el enlace de reserva del alojamiento para ver disponibilidad y precio al momento, y ofrece que el equipo se lo confirme.
- Guarda todo con update_lead_profile (fechas en formato AAAA-MM-DD si puedes deducirlas).
- Si quiere reservar, confirmar disponibilidad o pide algo especial (salida tardía, cuna, parking, descuento, grupo grande), usa handoff_to_agent con un resumen completo y dile que el equipo le responde muy pronto.

Si es huésped (B):
- Usa get_guest_info para responder sobre llegada, check-in, wifi, parking y normas. Si la herramienta indica que no está confirmado, no des códigos, contraseñas ni la dirección exacta: pide el nombre de la reserva y avisa al equipo.
- Si hay un problema (no funciona algo, no puede entrar, ruido, limpieza, agua, luz...), muestra empatía, haz 1 pregunta útil si hace falta (qué alojamiento, qué pasa exactamente) y usa report_incident. Marca urgent=true si no puede entrar o hay agua, gas, electricidad, seguridad o salud. Si hay peligro, recuerda el 112.
- Puedes dar recomendaciones generales de la zona (playas, restaurantes, qué ver) sin inventar precios ni horarios exactos.

Reglas generales:
- No prometas descuentos, devoluciones ni excepciones a las normas: eso lo decide el equipo.
- Si pide hablar con una persona, usa handoff_to_agent.
${agency.knowledge ? `\nInformación y normas de ${agency.name} (fuente oficial, úsala para responder):\n${agency.knowledge}` : ""}`;
}

function crmContext(lead: Lead): string {
  return `[Ficha CRM actual — no la menciones: nombre=${lead.name ?? "?"}; etapa=${stageLabel(lead.stage)}; huésped confirmado=${lead.guestPropertyId ? "sí" : "no"}; perfil=${JSON.stringify(lead.profile)}]`;
}

/** Convierte el historial de la BD a turnos user/assistant alternos. */
function toMessages(history: Message[], lead: Lead): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history) {
    if (m.author === "system") continue;
    const role = m.direction === "in" ? "user" : "assistant";
    const text = m.author === "agent" ? `(Mensaje del agente humano) ${m.body}` : m.body;
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "(inicio de la conversación)" });
  const last = out[out.length - 1];
  if (last?.role === "user" && typeof last.content === "string") {
    last.content = [
      { type: "text", text: last.content },
      { type: "text", text: crmContext(lead) },
    ];
  }
  return out;
}

export async function runClaudeAgent(input: AgentInput): Promise<AgentOutput> {
  const state = emptyTurnState();
  const messages = toMessages(input.history, input.lead);
  let reply = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await getClient().beta.messages.create({
      model: CHAT_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: EFFORT },
      system: systemPrompt(input.agency),
      tools: toolsFor(input.agency.vertical),
      messages,
    });

    if (response.stop_reason === "refusal") {
      state.handoff ??= {
        reason: "El asistente no pudo responder a este mensaje",
        summary: "La IA no pudo continuar la conversación. Revisa el chat y responde manualmente.",
      };
      break;
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) reply = text;

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

    // Pasamos el contenido tal cual (incluidos bloques de thinking) dentro del turno.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: await Promise.all(toolUses.map(async (t) => {
        const r = await executeTool(t.name, t.input, { agency: input.agency, catalog: input.catalog, lead: input.lead, knowledge: input.agency.knowledge }, state);
        return { type: "tool_result" as const, tool_use_id: t.id, content: r.content, is_error: r.isError };
      })),
    });
  }

  return { reply, state, engine: "claude" };
}

/** Mensaje de seguimiento personalizado (modelo rápido y barato). */
export async function writeFollowup(opts: {
  agency: Agency;
  lead: Lead;
  attempt: number;
  newMatches: string[];
}): Promise<string> {
  const { agency, lead, attempt, newMatches } = opts;
  const response = await getClient().messages.create({
    model: FAST_MODEL,
    max_tokens: 1000,
    output_config: { effort: "low" },
    system: `Eres ${agency.assistantName}, de ${agency.name}. Escribe UN mensaje corto de WhatsApp (máx. 3 frases), cálido y nada insistente, para retomar el contacto con ${agency.vertical === "vacacional" ? "alguien que preguntó por alojamiento y no reservó (no inventes disponibilidad ni precios)" : "un posible comprador"}. Escribe en el idioma con código "${lead.language}". Si hay propiedades nuevas que encajan, menciónalas con su referencia y precio. Termina con una pregunta fácil de responder. Devuelve solo el texto del mensaje.`,
    messages: [
      {
        role: "user",
        content: `Nombre: ${lead.name ?? "(desconocido)"}\nPerfil: ${JSON.stringify(lead.profile)}\nNúmero de seguimiento: ${attempt}\nPropiedades nuevas que encajan:\n${newMatches.join("\n") || "(ninguna)"}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const IntakeSchema = z.object({
  name: z.string().nullable().describe("Nombre del cliente (no el del portal ni el de la agencia)"),
  phone: z.string().nullable(),
  email: z.string().nullable().describe("Email del cliente, nunca el del portal (noreply, notificaciones)"),
  language: z.enum(["es", "en", "sv", "de", "fr"]).nullable().describe("Idioma en el que conviene escribirle"),
  property_ref: z.string().nullable().describe("Referencia del catálogo por la que pregunta, si se puede identificar"),
  client_message: z.string().nullable().describe("Mensaje literal del cliente, si lo hay"),
  portal: z.string().nullable().describe("Portal de origen: Idealista, Fotocasa, Rightmove, Kyero..."),
  summary: z.string().describe("Resumen en español, 1-2 frases, para el equipo"),
  property_type: z.string().nullable(),
  bedrooms_min: z.number().int().nullable(),
  budget_max: z.number().int().nullable().describe("Presupuesto de compra en euros"),
  zones: z.array(z.string()),
  timeline_months: z.number().int().nullable(),
  financing: z.enum(["contado", "hipoteca_aprobada", "hipoteca_pendiente", "desconocido"]).nullable(),
  check_in: z.string().nullable().describe("AAAA-MM-DD"),
  check_out: z.string().nullable().describe("AAAA-MM-DD"),
  guests: z.number().int().nullable(),
  pets: z.boolean().nullable(),
});

/** Lee un email de aviso de un portal o la nota de un agente y devuelve los datos del cliente. */
export async function extractIntakeWithClaude(kind: "email" | "note", text: string, agency: Agency, catalog: { ref: string; title: string }[]) {
  const response = await getClient().messages.parse({
    model: FAST_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(IntakeSchema) },
    system: `Extraes datos de clientes para el CRM de ${agency.name} (${agency.vertical === "vacacional" ? "alquiler vacacional" : "inmobiliaria de venta"}). Hoy es ${new Date().toISOString().slice(0, 10)}. Usa null cuando un dato no aparezca; no inventes nada. Catálogo (referencia: nombre):\n${catalog.map((p) => `${p.ref}: ${p.title}`).join("\n")}`,
    messages: [{
      role: "user",
      content: kind === "email"
        ? `Email de aviso de un portal inmobiliario. Extrae los datos del CLIENTE interesado:\n\n${text}`
        : `Nota del agente tras una llamada o visita a la oficina. Extrae los datos del cliente. El idioma es el del cliente (si la nota dice que es sueco, inglés, etc.), no el de la nota:\n\n${text}`,
    }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Sin datos extraídos");
  const o = response.parsed_output;
  const profile: LeadProfile = {};
  const put = <K extends keyof LeadProfile>(k: K, v: LeadProfile[K] | null | undefined) => {
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) profile[k] = v;
  };
  put("property_type", o.property_type); put("bedrooms_min", o.bedrooms_min); put("budget_max", o.budget_max);
  put("zones", o.zones); put("timeline_months", o.timeline_months); put("financing", o.financing);
  put("check_in", o.check_in); put("check_out", o.check_out); put("guests", o.guests); put("pets", o.pets);
  put("property_ref", o.property_ref);
  return {
    name: o.name ?? undefined, phone: o.phone ?? undefined, email: o.email ?? undefined,
    language: o.language ?? undefined, propertyRef: o.property_ref ?? undefined,
    clientMessage: o.client_message ?? undefined, portal: o.portal ?? undefined, summary: o.summary,
    profile,
  };
}

/** Primer mensaje de WhatsApp a un cliente que llamó o vino a la oficina. */
export async function writeOutreach(opts: { agency: Agency; lead: Lead; note: string; source: string; matches: { title: string; ref: string; price: number; maxGuests: number; bookingUrl: string | null }[] }): Promise<string> {
  const { agency, lead, note, source, matches } = opts;
  const response = await getClient().messages.create({
    model: FAST_MODEL,
    max_tokens: 1000,
    output_config: { effort: "low" },
    system: `Eres ${agency.assistantName}, de ${agency.name}. Escribe el PRIMER mensaje de WhatsApp a un cliente que acaba de ${/oficina|visita/i.test(source) ? "pasar por la oficina" : "llamar por teléfono"}. Idioma: código "${lead.language}". Máximo 4 frases, cálido y profesional, sin markdown. Agradece el contacto, demuestra que recuerdas lo que busca, y si hay propiedades que encajan menciónalas (solo esas, sin inventar). Termina con una pregunta fácil. Devuelve solo el texto.`,
    messages: [{
      role: "user",
      content: `Nombre: ${lead.name ?? "(desconocido)"}\nNota del agente: ${note}\nPropiedades que encajan:\n${matches.map((m) => `${m.ref} ${m.title}${m.bookingUrl ? ` ${m.bookingUrl}` : ""}`).join("\n") || "(ninguna)"}`,
    }],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  return response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}

const PropertySchema = z.object({
  title: z.string().describe("Título comercial corto en español"),
  type: z.enum(["apartamento", "atico", "estudio", "casa", "villa", "terreno", "comercial"]),
  price: z.number().int().describe("Precio en euros; 0 si no se dice"),
  bedrooms: z.number().int(),
  bathrooms: z.number().int(),
  area_m2: z.number().int(),
  max_guests: z.number().int().describe("Solo alquiler vacacional: personas; 0 si no aplica"),
  town: z.string(),
  zone: z.string().describe("Zona o urbanización; vacío si no se dice"),
  features: z.array(z.string()).describe("Características clave en español, cortas"),
  owner_contact: z.string().nullable().describe("Nombre y teléfono del propietario si se mencionan"),
  description_es: z.string(),
  description_en: z.string(),
  description_sv: z.string(),
});

/** Ficha de propiedad a partir de lo que el agente dictó, con descripción en 3 idiomas. */
export async function extractPropertyWithClaude(agency: Agency, note: string) {
  const response = await getClient().messages.parse({
    model: FAST_MODEL,
    max_tokens: 3000,
    output_config: { effort: "low", format: zodOutputFormat(PropertySchema) },
    system: `Creas fichas de inmuebles para ${agency.name} (${agency.town || "Costa del Sol"}, ${agency.vertical === "vacacional" ? "alquiler vacacional" : "venta"}). A partir de la nota dictada por el agente, rellena los datos (0 o vacío si no se dicen, nunca inventes) y escribe una descripción comercial breve (3-4 frases) en español, inglés y sueco basada SOLO en lo que dice la nota.`,
    messages: [{ role: "user", content: note }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Sin datos");
  const o = response.parsed_output;
  return {
    title: o.title, type: o.type, price: o.price, bedrooms: o.bedrooms, bathrooms: o.bathrooms, areaM2: o.area_m2,
    town: o.town, zone: o.zone, features: o.features, ownerContact: o.owner_contact ?? undefined, maxGuests: o.max_guests,
    description: `${o.description_es}\n\n🇬🇧 ${o.description_en}\n\n🇸🇪 ${o.description_sv}`,
  };
}
