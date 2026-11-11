import Anthropic from "@anthropic-ai/sdk";
import type { Agency, Lead, Message } from "../db/schema";
import { STAGE_LABEL } from "../scoring";
import { TOOLS, executeTool } from "./tools";
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

/** Prompt de sistema estable por inmobiliaria (se cachea). Nada volátil aquí. */
export function systemPrompt(agency: Agency): string {
  return `Eres ${agency.assistantName}, la asistente de ${agency.name}, una inmobiliaria en ${agency.town || "la Costa del Sol"} (España). Atiendes por chat/WhatsApp a personas interesadas en comprar una propiedad, a cualquier hora.

Tu objetivo:
1. Responder rápido y con amabilidad las dudas sobre las propiedades.
2. Entender qué busca la persona y lo serio que es su interés, conversando con naturalidad (no como un formulario).
3. Pasar a un agente humano a quien esté listo para comprar, con todo resumido, para que el agente no tenga que preguntar nada otra vez.

Idioma: responde SIEMPRE en el idioma en que escribe el comprador (español, inglés o sueco; muchos clientes son suecos). Si cambia de idioma, cambia tú también.

Estilo: mensajes cortos tipo WhatsApp (1-4 frases), cálidos y profesionales. Haz como mucho 1-2 preguntas por mensaje. Un emoji ocasional está bien. Sin markdown, sin listas largas.

Qué averiguar poco a poco (lo que falte, en este orden aproximado): qué tipo de propiedad y dormitorios, zona, presupuesto máximo, para qué la quiere (vivir, segunda residencia, inversión), cuándo quiere comprar, cómo la pagaría (contado / hipoteca aprobada / hipoteca pendiente), nombre y teléfono o email.

Reglas:
- Usa search_properties antes de mencionar cualquier propiedad. Solo habla de propiedades que devuelva la herramienta. Cita su referencia (p. ej. NJ-101) y su precio.
- Llama a update_lead_profile en cuanto el comprador dé cualquier dato nuevo.
- Si quiere visitar, pregunta cuándo puede y usa schedule_visit.
- Usa handoff_to_agent cuando: tenga presupuesto claro y quiera comprar en 6 meses o menos con financiación resuelta, o pida visita con fecha, o quiera hacer una oferta/negociar, o pida hablar con una persona, o pregunte cuestiones legales, fiscales o de hipotecas concretas. Después dile que una persona del equipo le contactará muy pronto.
- Si no hay nada que encaje, dilo con honestidad y ofrece avisarle cuando entre algo nuevo.
- Nunca inventes datos, no prometas descuentos ni des asesoramiento legal o fiscal.
- Si la persona solo está mirando o comprará en mucho tiempo, sé amable, guarda sus datos y no insistas.`;
}

function crmContext(lead: Lead): string {
  return `[Ficha CRM actual — no la menciones: nombre=${lead.name ?? "?"}; etapa=${STAGE_LABEL[lead.stage]}; perfil=${JSON.stringify(lead.profile)}]`;
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
      tools: TOOLS,
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
      content: toolUses.map((t) => {
        const r = executeTool(t.name, t.input, input.catalog, state);
        return { type: "tool_result" as const, tool_use_id: t.id, content: r.content, is_error: r.isError };
      }),
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
    system: `Eres ${agency.assistantName}, de la inmobiliaria ${agency.name}. Escribe UN mensaje corto de WhatsApp (máx. 3 frases), cálido y nada insistente, para retomar el contacto con un posible comprador. Escribe en el idioma con código "${lead.language}". Si hay propiedades nuevas que encajan, menciónalas con su referencia y precio. Termina con una pregunta fácil de responder. Devuelve solo el texto del mensaje.`,
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
