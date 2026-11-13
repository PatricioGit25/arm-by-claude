/** Asistente comercial de VistaAlta en modo demo (sin IA): califica a la agencia y agenda la demo. */
import type { LeadProfile } from "../db/schema";
import { availableSlots, formatSlot } from "../calendar";
import { detectLang } from "../i18n";
import { norm } from "../scoring";
import { pickSlot } from "./mock";
import { emptyTurnState, type AgentInput, type AgentOutput } from "./types";

export async function runMockCommercialAgent(input: AgentInput): Promise<AgentOutput> {
  const { agency, lead, history } = input;
  const state = emptyTurnState();
  const text = [...history].reverse().find((m) => m.direction === "in")?.body ?? "";
  const t = norm(text);
  const lang = lead.inboundCount <= 1 ? detectLang(text, lead.language) : lead.language;
  if (lang !== lead.language) state.contactPatch.language = lang;
  const en = lang !== "es";
  const parts: string[] = [];
  if (!history.some((m) => m.direction === "out")) {
    parts.push(en
      ? `Hi! I'm ${agency.assistantName} from ${agency.name}. I'm an AI assistant, exactly like the one your agency would have. 😊`
      : `¡Hola! Soy ${agency.assistantName}, de ${agency.name}. Soy un asistente con IA, igual que el que tendría tu agencia. 😊`);
  }

  // Datos que se pueden deducir del mensaje
  const company = text.match(/(?:agencia|inmobiliaria|agency|empresa|somos)\s+([A-ZÁÉÍÓÚÑ][\p{L}&.\- ]{1,40})/u)?.[1]?.trim();
  if (company) state.profilePatch.company = company;
  if (/vacacional|alquiler turistico|holiday|vacation/.test(t)) state.profilePatch.business_type = /venta|sale/.test(t) ? "ambas" : "alquiler vacacional";
  else if (/venta|compraventa|sales|vendemos/.test(t)) state.profilePatch.business_type = "venta";
  const crm = ["inmovilla", "witei", "mobilia", "sooprema", "inmoweb", "lodgify", "avantio", "smoobu", "resales", "inmobalia"].find((c) => t.includes(c));
  if (crm) state.profilePatch.crm = crm.charAt(0).toUpperCase() + crm.slice(1);
  const n = t.match(/(\d{1,4})\s*(contactos|leads|consultas|mensajes|clientes)/);
  if (n) state.profilePatch.leads_month = +n[1];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  if (email) state.contactPatch.email = email;
  const phone = text.match(/\+?\d[\d\s-]{7,}\d/)?.[0];
  if (phone) state.contactPatch.phone = phone.trim();
  const name = text.match(/(?:[Mm]e llamo|[Ss]oy|[Mm]y name is|I'm|I am)\s+([A-ZÁÉÍÓÚÑ][\p{L}]+)/u)?.[1];
  if (name) state.contactPatch.name = name;
  if (/demo|reuni|llamada|ver(lo)? funcionando|probar|meeting|call/.test(t)) state.profilePatch.wants_visit = true;
  if (/precio|cuesta|cuanto|tarifa|price|cost/.test(t)) {
    parts.push(en
      ? "It's €99/month per agency, no commitment and free setup, with a free 30-day pilot first."
      : "Son 99 €/mes por agencia, sin permanencia y con el alta gratis. Antes, un piloto de 30 días sin coste.");
  }

  // ¿Eligió hueco para la demo?
  const offered = lead.profile.offered_slots ?? [];
  const pick = offered.length ? pickSlot(text, offered, agency.timezone) : undefined;
  if (pick) {
    const label = formatSlot(new Date(pick), agency.timezone, lang);
    state.visit = { preferredTime: label, startsAt: pick };
    state.profilePatch.offered_slots = [];
    state.handoff = { reason: "Demo agendada", summary: summary({ ...lead.profile, ...state.profilePatch }, label) };
    parts.push(en ? `Done! Demo booked for ${label}. We'll set it up with your own listings. 🙌` : `¡Hecho! Demo agendada para el ${label}. La preparamos con vuestras propias propiedades. 🙌`);
    if (!lead.phone && !lead.email && !phone && !email) parts.push(en ? "What's the best phone or email to reach you?" : "¿A qué teléfono o email te contactamos?");
    return { reply: parts.join("\n"), state, engine: "demo" };
  }

  const profile: LeadProfile = { ...lead.profile, ...state.profilePatch };
  if (profile.wants_visit || (profile.company && (profile.crm || profile.leads_month || profile.business_type))) {
    const slots = await availableSlots(agency, { max: 3 }).catch(() => []);
    if (slots.length) {
      state.profilePatch.offered_slots = slots.map((s) => s.start.toISOString());
      parts.push(en ? "Shall we do a 30-minute demo with your own listings? These times are free:" : "¿Hacemos una demo de 30 minutos con vuestras propias propiedades? Tengo estos huecos libres:",
        ...slots.map((s, i) => `${i + 1}. ${formatSlot(s.start, agency.timezone, lang)}`),
        en ? "Reply with the number." : "Responde con el número.");
      return { reply: parts.join("\n"), state, engine: "demo" };
    }
  }
  const ask = !profile.company
    ? (en ? "Which agency are you with, and where do you work?" : "¿De qué agencia nos escribes y en qué zona trabajáis?")
    : !profile.business_type
      ? (en ? "Do you work in sales, holiday rentals or both?" : "¿Os dedicáis a venta, alquiler vacacional o ambas?")
      : !profile.channels && !profile.leads_month
        ? (en ? "Roughly how many enquiries do you get a month, and through where (Idealista, WhatsApp, web…)?" : "¿Cuántas consultas recibís al mes, más o menos, y por dónde (Idealista, WhatsApp, web…)?")
        : (en ? "Which CRM do you use?" : "¿Qué CRM o programa usáis?");
  parts.push(ask);
  return { reply: parts.join("\n"), state, engine: "demo" };
}

function summary(p: LeadProfile, when: string): string {
  return [p.company && `Agencia: ${p.company}`, p.zones?.length && `zona: ${p.zones.join(", ")}`, p.business_type, p.leads_month && `${p.leads_month} contactos/mes`, p.crm && `CRM: ${p.crm}`, `Demo: ${when}`].filter(Boolean).join(" · ");
}
