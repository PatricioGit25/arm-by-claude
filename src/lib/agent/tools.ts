import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Property } from "../db/schema";
import { formatPrice, norm, sameType } from "../scoring";
import type { TurnState } from "./types";

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_properties",
    description:
      "Busca en el catálogo REAL de la inmobiliaria. Úsala siempre antes de recomendar o mencionar una propiedad; nunca inventes propiedades, precios ni características. Todos los filtros son opcionales.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", description: "apartamento, atico, estudio, casa, villa o terreno" },
        max_price: { type: "integer", description: "Precio máximo en euros" },
        min_bedrooms: { type: "integer" },
        town_or_zone: { type: "string", description: "Pueblo o zona, p. ej. Nerja, Frigiliana, Burriana" },
        ref: { type: "string", description: "Referencia exacta si el comprador pregunta por una propiedad concreta" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "update_lead_profile",
    description:
      "Guarda en el CRM cualquier dato nuevo que el comprador haya dado. Llámala cada vez que aprendas algo (nombre, contacto, qué busca, presupuesto, plazo, financiación, si quiere visitar). Solo incluye los campos que sabes con certeza.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        language: { type: "string", enum: ["es", "en", "sv"], description: "Idioma en el que escribe el comprador" },
        property_type: { type: "string", description: "apartamento, atico, estudio, casa, villa o terreno" },
        bedrooms_min: { type: "integer" },
        budget_max: { type: "integer", description: "Presupuesto máximo en euros" },
        zones: { type: "array", items: { type: "string" } },
        timeline_months: { type: "integer", description: "En cuántos meses quiere comprar (0 = ya)" },
        financing: { type: "string", enum: ["contado", "hipoteca_aprobada", "hipoteca_pendiente", "desconocido"] },
        purpose: { type: "string", description: "vivir, segunda residencia, inversión, jubilación..." },
        wants_visit: { type: "boolean" },
        notes: { type: "string", description: "Otros detalles relevantes (mascotas, piscina, garaje...)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "schedule_visit",
    description:
      "Registra una solicitud de visita. El agente inmobiliario la confirmará. Úsala cuando el comprador quiera ver una propiedad e indique cuándo puede.",
    input_schema: {
      type: "object",
      properties: {
        property_ref: { type: "string" },
        preferred_time: { type: "string", description: "Cuándo puede el comprador, tal y como lo dijo" },
      },
      required: ["preferred_time"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_agent",
    description:
      "Pasa el lead a un agente humano. Úsala cuando el comprador esté listo para comprar (presupuesto + plazo cercano + financiación o visita), cuando quiera hacer una oferta o negociar, cuando pida hablar con una persona o cuando pregunte algo legal/fiscal que no debes responder.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Por qué se pasa ahora" },
        summary: {
          type: "string",
          description: "Resumen en ESPAÑOL para el agente: quién es, qué busca, presupuesto, plazo, financiación, propiedades de interés y próximo paso.",
        },
      },
      required: ["reason", "summary"],
      additionalProperties: false,
    },
  },
];

const ProfileInput = z.object({
  name: z.string().min(1).optional(),
  email: z.string().min(3).optional(),
  phone: z.string().min(5).optional(),
  language: z.enum(["es", "en", "sv"]).optional(),
  property_type: z.string().min(1).optional(),
  bedrooms_min: z.number().int().min(0).max(20).optional(),
  budget_max: z.number().int().positive().optional(),
  zones: z.array(z.string()).optional(),
  timeline_months: z.number().int().min(0).max(120).optional(),
  financing: z.enum(["contado", "hipoteca_aprobada", "hipoteca_pendiente", "desconocido"]).optional(),
  purpose: z.string().optional(),
  wants_visit: z.boolean().optional(),
  notes: z.string().optional(),
});
const SearchInput = z.object({
  type: z.string().optional(),
  max_price: z.number().optional(),
  min_bedrooms: z.number().optional(),
  town_or_zone: z.string().optional(),
  ref: z.string().optional(),
});
const VisitInput = z.object({ property_ref: z.string().optional(), preferred_time: z.string().min(1) });
const HandoffInput = z.object({ reason: z.string().min(1), summary: z.string().min(1) });

export function describeProperty(p: Property): string {
  return `${p.ref} | ${p.title} | ${p.type} | ${formatPrice(p.price)} | ${p.bedrooms} dorm, ${p.bathrooms} baños, ${p.areaM2} m² | ${p.town} (${p.zone}) | ${p.features.join(", ")} | ${p.description}`;
}

export function searchCatalog(catalog: Property[], f: z.infer<typeof SearchInput>): Property[] {
  if (f.ref) return catalog.filter((p) => norm(p.ref) === norm(f.ref!));
  return catalog
    .filter((p) => p.status === "disponible")
    .filter((p) => !f.type || sameType(p.type, f.type))
    .filter((p) => !f.max_price || p.price <= f.max_price * 1.05)
    .filter((p) => !f.min_bedrooms || p.bedrooms >= f.min_bedrooms)
    .filter((p) => !f.town_or_zone || norm(`${p.town} ${p.zone}`).includes(norm(f.town_or_zone)))
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);
}

/** Ejecuta una herramienta. Devuelve el texto del tool_result y si fue error. */
export function executeTool(
  name: string,
  rawInput: unknown,
  catalog: Property[],
  state: TurnState,
): { content: string; isError: boolean } {
  try {
    switch (name) {
      case "search_properties": {
        const found = searchCatalog(catalog, SearchInput.parse(rawInput));
        found.forEach((p) => state.shownRefs.includes(p.ref) || state.shownRefs.push(p.ref));
        return {
          content: found.length ? found.map(describeProperty).join("\n") : "Sin resultados con esos filtros. Prueba a ampliar presupuesto o zona, u ofrece avisarle cuando entre algo.",
          isError: false,
        };
      }
      case "update_lead_profile": {
        const { name: n, email, phone, language, ...profile } = ProfileInput.parse(rawInput);
        Object.assign(state.contactPatch, clean({ name: n, email, phone, language }));
        Object.assign(state.profilePatch, clean(profile));
        return { content: "Guardado en el CRM.", isError: false };
      }
      case "schedule_visit": {
        const v = VisitInput.parse(rawInput);
        state.visit = { propertyRef: v.property_ref, preferredTime: v.preferred_time };
        state.profilePatch.wants_visit = true;
        return { content: "Solicitud de visita registrada. Un agente la confirmará pronto.", isError: false };
      }
      case "handoff_to_agent": {
        state.handoff = HandoffInput.parse(rawInput);
        return { content: "Agente humano avisado con el resumen. Dile al comprador que una persona del equipo le contactará muy pronto.", isError: false };
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
