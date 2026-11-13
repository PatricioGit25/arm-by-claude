import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Agency, Lead, Property, Vertical } from "../db/schema";
import { availableSlots, formatSlot, isFree } from "../calendar";
import { formatPrice, norm, sameType } from "../scoring";
import type { TurnState } from "./types";

const PROFILE_FIELDS_COMMON = {
  name: { type: "string" },
  email: { type: "string" },
  phone: { type: "string" },
  language: { type: "string", enum: ["es", "en", "sv", "de", "fr"], description: "Idioma en el que escribe el cliente" },
  property_type: { type: "string", description: "apartamento, atico, estudio, casa, villa..." },
  zones: { type: "array", items: { type: "string" } },
  notes: { type: "string", description: "Otros detalles relevantes" },
} as const;

const PROFILE_FIELDS_SALE = {
  bedrooms_min: { type: "integer" },
  budget_max: { type: "integer", description: "Presupuesto máximo de compra en euros" },
  timeline_months: { type: "integer", description: "En cuántos meses quiere comprar (0 = ya)" },
  financing: { type: "string", enum: ["contado", "hipoteca_aprobada", "hipoteca_pendiente", "desconocido"] },
  purpose: { type: "string", description: "vivir, segunda residencia, inversión, jubilación..." },
  wants_visit: { type: "boolean" },
} as const;

const PROFILE_FIELDS_VACATION = {
  check_in: { type: "string", description: "Fecha de llegada, AAAA-MM-DD si se sabe" },
  check_out: { type: "string", description: "Fecha de salida, AAAA-MM-DD si se sabe" },
  guests: { type: "integer", description: "Número total de personas" },
  pets: { type: "boolean", description: "Viaja con mascota" },
  budget_night: { type: "integer", description: "Presupuesto por noche en euros" },
  property_ref: { type: "string", description: "Alojamiento que le interesa (referencia)" },
  wants_booking: { type: "boolean", description: "Quiere reservar o confirmar disponibilidad" },
} as const;

const PROFILE_FIELDS_COMMERCIAL = {
  company: { type: "string", description: "Nombre de la agencia" },
  zones: { type: "array", items: { type: "string" }, description: "Pueblos o zonas donde trabaja" },
  business_type: { type: "string", description: "venta, alquiler vacacional o ambas" },
  team_size: { type: "integer", description: "Personas en el equipo" },
  leads_month: { type: "integer", description: "Contactos de clientes al mes, aproximado" },
  crm: { type: "string", description: "CRM o programa que usa (Inmovilla, Witei, Lodgify, ninguno...)" },
  channels: { type: "string", description: "Por dónde le llegan los clientes (Idealista, WhatsApp, web, teléfono...)" },
  wants_visit: { type: "boolean", description: "Quiere ver la demo" },
} as const;

export function toolsFor(vertical: Vertical): Anthropic.Tool[] {
  if (vertical === "comercial") return commercialTools();
  const vacation = vertical === "vacacional";
  const tools: Anthropic.Tool[] = [
    {
      name: "search_properties",
      description:
        "Busca en el catálogo REAL de la agencia. Úsala siempre antes de recomendar o mencionar un alojamiento o propiedad; nunca inventes propiedades, precios ni características. Todos los filtros son opcionales.",
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string", description: "apartamento, atico, estudio, casa, villa" },
          ...(vacation
            ? { guests: { type: "integer", description: "Personas que se alojan" }, pets: { type: "boolean" } }
            : { max_price: { type: "integer", description: "Precio máximo en euros" }, min_bedrooms: { type: "integer" } }),
          town_or_zone: { type: "string", description: "Pueblo o zona" },
          ref: { type: "string", description: "Referencia exacta si pregunta por una propiedad concreta" },
          text: { type: "string", description: "Palabra a buscar en nombre o características (piscina, terraza, vistas al mar...)" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "update_lead_profile",
      description:
        "Guarda en el CRM cualquier dato nuevo que haya dado el cliente. Llámala cada vez que aprendas algo. Solo incluye los campos que sabes con certeza.",
      input_schema: {
        type: "object",
        properties: { ...PROFILE_FIELDS_COMMON, ...(vacation ? PROFILE_FIELDS_VACATION : PROFILE_FIELDS_SALE) },
        additionalProperties: false,
      },
    },
  ];

  if (vacation) {
    tools.push(
      {
        name: "get_guest_info",
        description:
          "Devuelve la información práctica de un alojamiento para un huésped: llegada, check-in, wifi, parking, normas. Los datos privados (códigos, contraseñas) solo se devuelven si el equipo ha confirmado que este cliente es huésped de ese alojamiento.",
        input_schema: {
          type: "object",
          properties: { property_ref: { type: "string" } },
          additionalProperties: false,
        },
      },
      {
        name: "report_incident",
        description:
          "Avisa al equipo de un problema durante la estancia (algo no funciona, no puede entrar, ruido, limpieza, fuga, llaves...). Úsala siempre que el huésped tenga un problema que requiera a una persona.",
        input_schema: {
          type: "object",
          properties: {
            property_ref: { type: "string" },
            description: { type: "string", description: "Qué pasa, en ESPAÑOL, para el equipo" },
            urgent: { type: "boolean", description: "true si el huésped no puede entrar, hay agua, gas, electricidad, seguridad o salud" },
          },
          required: ["description", "urgent"],
          additionalProperties: false,
        },
      },
    );
  } else {
    tools.push(
      {
        name: "get_available_slots",
        description: "Devuelve huecos libres REALES en la agenda del agente para hacer una visita. Úsala antes de proponer día y hora; nunca inventes horarios.",
        input_schema: {
          type: "object",
          properties: {
            from_date: { type: "string", description: "AAAA-MM-DD desde el que buscar (por defecto, hoy)" },
            part_of_day: { type: "string", enum: ["morning", "afternoon"], description: "Si el cliente prefiere mañana o tarde" },
          },
          additionalProperties: false,
        },
      },
      {
        name: "schedule_visit",
        description: "Agenda la visita en el calendario del agente. Pasa slot_start EXACTAMENTE como lo devolvió get_available_slots para el hueco que eligió el cliente. Si el cliente no quiere fijar hora todavía, pasa solo preferred_time y el agente le contactará.",
        input_schema: {
          type: "object",
          properties: {
            property_ref: { type: "string" },
            slot_start: { type: "string", description: "Inicio del hueco elegido (ISO), tal cual de get_available_slots" },
            preferred_time: { type: "string", description: "Preferencia del cliente en sus palabras, si no eligió hueco" },
          },
          additionalProperties: false,
        },
      },
    );
  }

  tools.push({
    name: "handoff_to_agent",
    description: vacation
      ? "Pasa la conversación al equipo. Úsala cuando el cliente quiera reservar o confirmar disponibilidad y precio para unas fechas, pida algo especial (salida tardía, cuna, parking, descuento), pregunte por cancelaciones o pagos concretos, o pida hablar con una persona."
      : "Pasa el lead a un agente humano: cuando esté listo para comprar, quiera hacer una oferta, pida hablar con una persona o pregunte cuestiones legales/fiscales.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        summary: { type: "string", description: "Resumen en ESPAÑOL para el equipo con todo lo necesario y el próximo paso" },
      },
      required: ["reason", "summary"],
      additionalProperties: false,
    },
  });
  return tools;
}

function commercialTools(): Anthropic.Tool[] {
  const { name, email, phone, language, notes } = PROFILE_FIELDS_COMMON;
  return [
    {
      name: "update_lead_profile",
      description: "Guarda en el CRM lo que sepas de la agencia interesada y de la persona. Llámala cada vez que aprendas algo.",
      input_schema: { type: "object", properties: { name, email, phone, language, notes, ...PROFILE_FIELDS_COMMERCIAL }, additionalProperties: false },
    },
    {
      name: "get_available_slots",
      description: "Huecos libres REALES para una videollamada o visita de demo de 30-45 minutos. Úsala antes de proponer horarios.",
      input_schema: {
        type: "object",
        properties: { from_date: { type: "string" }, part_of_day: { type: "string", enum: ["morning", "afternoon"] } },
        additionalProperties: false,
      },
    },
    {
      name: "schedule_visit",
      description: "Agenda la demo en el calendario. Pasa slot_start exactamente como lo devolvió get_available_slots.",
      input_schema: {
        type: "object",
        properties: { slot_start: { type: "string" }, preferred_time: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "handoff_to_agent",
      description: "Avisa a la persona responsable de VistaAlta con un resumen: cuando agenden la demo, quieran hablar con alguien, pregunten algo que no sabes o pidan un presupuesto especial.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string" }, summary: { type: "string", description: "Resumen en español: agencia, zona, tipo, volumen, CRM, canales, qué le interesa y próximo paso" } },
        required: ["reason", "summary"],
        additionalProperties: false,
      },
    },
  ];
}

const ProfileInput = z.object({
  name: z.string().min(1).optional(),
  email: z.string().min(3).optional(),
  phone: z.string().min(5).optional(),
  language: z.enum(["es", "en", "sv", "de", "fr"]).optional(),
  property_type: z.string().min(1).optional(),
  bedrooms_min: z.number().int().min(0).max(20).optional(),
  budget_max: z.number().int().positive().optional(),
  zones: z.array(z.string()).optional(),
  timeline_months: z.number().int().min(0).max(120).optional(),
  financing: z.enum(["contado", "hipoteca_aprobada", "hipoteca_pendiente", "desconocido"]).optional(),
  purpose: z.string().optional(),
  wants_visit: z.boolean().optional(),
  notes: z.string().optional(),
  check_in: z.string().optional(),
  check_out: z.string().optional(),
  guests: z.number().int().min(1).max(50).optional(),
  pets: z.boolean().optional(),
  budget_night: z.number().int().positive().optional(),
  property_ref: z.string().optional(),
  wants_booking: z.boolean().optional(),
  company: z.string().optional(),
  business_type: z.string().optional(),
  team_size: z.number().int().min(1).max(500).optional(),
  leads_month: z.number().int().min(0).max(100000).optional(),
  crm: z.string().optional(),
  channels: z.string().optional(),
});
const SearchInput = z.object({
  type: z.string().optional(),
  max_price: z.number().optional(),
  min_bedrooms: z.number().optional(),
  guests: z.number().optional(),
  pets: z.boolean().optional(),
  town_or_zone: z.string().optional(),
  ref: z.string().optional(),
  text: z.string().optional(),
});
const VisitInput = z.object({ property_ref: z.string().optional(), slot_start: z.string().optional(), preferred_time: z.string().optional() });
const SlotsInput = z.object({ from_date: z.string().optional(), part_of_day: z.enum(["morning", "afternoon"]).optional() });
const HandoffInput = z.object({ reason: z.string().min(1), summary: z.string().min(1) });
const GuestInfoInput = z.object({ property_ref: z.string().optional() });
const IncidentInput = z.object({ property_ref: z.string().optional(), description: z.string().min(1), urgent: z.boolean() });

export function describeProperty(p: Property): string {
  if (p.maxGuests) {
    const pets = p.petsAllowed === "si" ? "admite mascotas (suplemento)" : p.petsAllowed === "no" ? "no admite mascotas" : "mascotas: consultar";
    return `${p.ref} | ${p.title} | ${p.type} | hasta ${p.maxGuests} personas, ${p.areaM2} m² | ${p.town}${p.zone ? ` (${p.zone})` : ""} | ${p.features.join(", ")} | ${pets} | reservar: ${p.bookingUrl ?? "consultar con el equipo"}${p.description ? ` | ${p.description}` : ""}`;
  }
  return `${p.ref} | ${p.title} | ${p.type} | ${formatPrice(p.price)} | ${p.bedrooms} dorm, ${p.bathrooms} baños, ${p.areaM2} m² | ${p.town} (${p.zone}) | ${p.features.join(", ")} | ${p.description}`;
}

export function findProperty(catalog: Property[], ref?: string): Property | undefined {
  if (!ref) return undefined;
  const r = norm(ref);
  return catalog.find((p) => norm(p.ref) === r) ?? catalog.find((p) => norm(p.title).includes(r) || r.includes(norm(p.title)));
}

export function searchCatalog(catalog: Property[], f: z.infer<typeof SearchInput>): Property[] {
  if (f.ref) {
    const one = findProperty(catalog, f.ref);
    return one ? [one] : [];
  }
  return catalog
    .filter((p) => p.status === "disponible")
    .filter((p) => !f.type || sameType(p.type, f.type))
    .filter((p) => !f.max_price || p.price <= f.max_price * 1.05)
    .filter((p) => !f.min_bedrooms || p.bedrooms >= f.min_bedrooms)
    .filter((p) => !f.guests || !p.maxGuests || p.maxGuests >= f.guests)
    .filter((p) => !f.pets || p.petsAllowed !== "no")
    .filter((p) => !f.town_or_zone || norm(`${p.town} ${p.zone}`).includes(norm(f.town_or_zone)))
    .filter((p) => !f.text || textMatches(`${p.title} ${p.features.join(" ")} ${p.description}`, f.text))
    .sort((a, b) => (f.guests ? a.maxGuests - b.maxGuests : b.price - a.price))
    .slice(0, 5);
}

const STOP = new Set(["y", "e", "con", "de", "del", "la", "el", "los", "las", "un", "una", "and", "with", "a", "the", "och", "med", "und", "mit", "et", "avec", "o", "or"]);
const SYNONYMS: Record<string, string[]> = {
  piscina: ["piscina", "pool", "pool", "pool", "schwimmbad", "piscine"], pool: ["piscina", "pool"], pol: ["piscina"],
  terraza: ["terraza", "balcon", "terrace", "terrass", "terrasse"], terrace: ["terraza", "terrace"], terrass: ["terraza"], terrasse: ["terraza"], balcon: ["balcon", "terraza"],
  vistas: ["vistas", "view", "views", "utsikt", "blick", "vue"], mar: ["mar", "sea", "hav", "meer", "mer"], sea: ["mar", "sea"], view: ["vistas", "view"], views: ["vistas", "view"],
  garaje: ["garaje", "parking", "aparcamiento", "garage"], parking: ["garaje", "parking"],
  playa: ["playa", "beach", "strand", "plage"], beach: ["playa", "beach"],
  lavavajillas: ["lavavajillas", "dishwasher"], ascensor: ["ascensor", "lift", "elevator", "hiss", "aufzug"],
};

/** Cada palabra útil de la búsqueda (o un sinónimo/traducción) debe aparecer, en cualquier orden. */
export function textMatches(haystack: string, query: string): boolean {
  const hay = norm(haystack);
  const words = norm(query).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 1 && !STOP.has(w));
  return words.every((w) => (SYNONYMS[w] ?? [w]).some((v) => hay.includes(norm(v))));
}

export interface ToolContext {
  agency: Agency;
  catalog: Property[];
  lead: Lead;
  knowledge: string;
}

/** Ejecuta una herramienta. Devuelve el texto del tool_result y si fue error. */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext, state: TurnState): Promise<{ content: string; isError: boolean }> {
  const { catalog } = ctx;
  try {
    switch (name) {
      case "search_properties": {
        const found = searchCatalog(catalog, SearchInput.parse(rawInput));
        found.forEach((p) => state.shownRefs.includes(p.ref) || state.shownRefs.push(p.ref));
        return {
          content: found.length
            ? found.map(describeProperty).join("\n")
            : "Sin resultados con esos filtros. Prueba a ampliar la búsqueda, u ofrece avisarle cuando haya algo.",
          isError: false,
        };
      }
      case "update_lead_profile": {
        const { name: n, email, phone, language, ...profile } = ProfileInput.parse(rawInput);
        Object.assign(state.contactPatch, clean({ name: n, email, phone, language }));
        Object.assign(state.profilePatch, clean(profile));
        return { content: "Guardado en el CRM.", isError: false };
      }
      case "get_available_slots": {
        const f = SlotsInput.parse(rawInput);
        const from = f.from_date && /^\d{4}-\d{2}-\d{2}$/.test(f.from_date) ? new Date(`${f.from_date}T00:00:00Z`) : undefined;
        const slots = await availableSlots(ctx.agency, { from, partOfDay: f.part_of_day, max: 4 });
        if (!slots.length) return { content: "No hay huecos libres en los próximos días con esa preferencia. Ofrece que el agente le proponga horario (schedule_visit solo con preferred_time).", isError: false };
        return {
          content: `Huecos libres (propón 2-3 al cliente con el día y la hora en su idioma; cada visita dura ${ctx.agency.visitMinutes} min):\n` +
            slots.map((s) => `- slot_start=${s.start.toISOString()} → ${formatSlot(s.start, ctx.agency.timezone, ctx.lead.language)}`).join("\n"),
          isError: false,
        };
      }
      case "schedule_visit": {
        const v = VisitInput.parse(rawInput);
        state.profilePatch.wants_visit = true;
        if (v.slot_start) {
          const start = new Date(v.slot_start);
          if (Number.isNaN(start.getTime())) return { content: "slot_start no válido: usa uno de get_available_slots.", isError: true };
          if (!(await isFree(ctx.agency, start))) return { content: "Ese hueco ya no está libre. Vuelve a consultar get_available_slots y ofrece otro.", isError: true };
          const label = formatSlot(start, ctx.agency.timezone, ctx.lead.language);
          state.visit = { propertyRef: v.property_ref, preferredTime: label, startsAt: start.toISOString() };
          return { content: `Visita agendada: ${label}. Confírmaselo al cliente y dile que le escribirán para recordárselo.`, isError: false };
        }
        state.visit = { propertyRef: v.property_ref, preferredTime: v.preferred_time || "a convenir" };
        return { content: "Solicitud de visita registrada sin hora. Un agente le propondrá horario pronto.", isError: false };
      }
      case "get_guest_info": {
        const { property_ref } = GuestInfoInput.parse(rawInput);
        const confirmed = ctx.lead.guestPropertyId ? catalog.find((p) => p.id === ctx.lead.guestPropertyId) : undefined;
        const p = findProperty(catalog, property_ref) ?? confirmed;
        const general = `Información general de la agencia:\n${ctx.knowledge || "(sin información general)"}`;
        if (!p) return { content: `${general}\n\nNo sé en qué alojamiento está. Pregúntaselo.`, isError: false };
        if (confirmed && confirmed.id === p.id) {
          return { content: `${general}\n\nAlojamiento ${p.ref} (${p.title}), huésped CONFIRMADO. Información privada:\n${p.guestInfo || "(no cargada: pásalo al equipo)"}`, isError: false };
        }
        return {
          content: `${general}\n\nAlojamiento ${p.ref} (${p.title}). Este cliente NO está confirmado como huésped: no des códigos, contraseñas ni direcciones exactas. Pídele el nombre de la reserva y avisa al equipo con handoff_to_agent para que lo confirmen.`,
          isError: false,
        };
      }
      case "report_incident": {
        const inc = IncidentInput.parse(rawInput);
        state.incident = { propertyRef: inc.property_ref, description: inc.description, urgent: inc.urgent };
        return {
          content: inc.urgent
            ? "Equipo avisado como URGENTE. Dile al huésped que una persona le contactará en minutos y, si hay peligro, que llame al 112."
            : "Equipo avisado. Dile al huésped que lo están gestionando y le escribirán pronto.",
          isError: false,
        };
      }
      case "handoff_to_agent": {
        state.handoff = HandoffInput.parse(rawInput);
        return { content: "Equipo avisado con el resumen. Dile al cliente que una persona del equipo le contactará muy pronto.", isError: false };
      }
      default:
        return { content: `Herramienta desconocida: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: `Entrada inválida: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
