/**
 * Agente de reglas para el "modo demo" (sin ANTHROPIC_API_KEY).
 * Imita el flujo del agente real: detecta idioma, extrae datos, recomienda
 * propiedades del catálogo, califica y pasa el lead al humano.
 */
import type { Lang, LeadProfile } from "../db/schema";
import { detectLang } from "../i18n";
import { formatPrice, norm, scoreLead } from "../scoring";
import { searchCatalog } from "./tools";
import { runMockVacationAgent } from "./mock-vacation";
import { emptyTurnState, type AgentInput, type AgentOutput } from "./types";

type Key =
  | "greet" | "ask_type" | "ask_zone" | "ask_budget" | "ask_timeline" | "ask_financing" | "ask_contact"
  | "matches" | "no_matches" | "visit" | "handoff" | "thanks";

const T: Record<"es" | "en" | "sv", Record<Key, string>> = {
  es: {
    greet: "¡Hola! Soy {assistant}, de {agency}. 😊",
    ask_type: "¿Qué tipo de propiedad buscas (apartamento, casa, villa…) y cuántos dormitorios?",
    ask_zone: "¿Tienes alguna zona en mente? Nerja, Frigiliana, Torrox…",
    ask_budget: "¿Hasta qué presupuesto te gustaría llegar?",
    ask_timeline: "¿Para cuándo te gustaría comprar?",
    ask_financing: "¿Cómo lo financiarías: al contado o con hipoteca?",
    ask_contact: "¿Me dejas tu nombre y un teléfono para tenerte al tanto?",
    matches: "Tengo esto que encaja contigo:",
    no_matches: "Ahora mismo no tengo nada que encaje del todo, pero te aviso en cuanto entre algo. 🙌",
    visit: "¡Perfecto! Apunto la visita ({time}) y un compañero te la confirma enseguida.",
    handoff: "Genial, con esto ya tengo todo. Le paso tu ficha a un agente del equipo y te contacta muy pronto. 🏡",
    thanks: "¡Gracias! Si necesitas algo más, aquí estoy.",
  },
  en: {
    greet: "Hi! I'm {assistant} from {agency}. 😊",
    ask_type: "What kind of property are you looking for (apartment, house, villa…) and how many bedrooms?",
    ask_zone: "Any area in mind? Nerja, Frigiliana, Torrox…",
    ask_budget: "What's your maximum budget?",
    ask_timeline: "When would you like to buy?",
    ask_financing: "How would you finance it: cash or mortgage?",
    ask_contact: "Could you share your name and a phone number so I can keep you posted?",
    matches: "Here's what matches what you're looking for:",
    no_matches: "Nothing matches perfectly right now, but I'll let you know as soon as something comes in. 🙌",
    visit: "Perfect! I've noted the viewing ({time}) and a colleague will confirm it shortly.",
    handoff: "Great, I have everything I need. I'm passing your details to one of our agents, who'll contact you very soon. 🏡",
    thanks: "Thank you! I'm here if you need anything else.",
  },
  sv: {
    greet: "Hej! Jag heter {assistant} och jobbar på {agency}. 😊",
    ask_type: "Vilken typ av bostad letar du efter (lägenhet, hus, villa…) och hur många sovrum?",
    ask_zone: "Har du något område i åtanke? Nerja, Frigiliana, Torrox…",
    ask_budget: "Vad är din maxbudget?",
    ask_timeline: "När skulle du vilja köpa?",
    ask_financing: "Hur skulle du finansiera köpet: kontant eller med bolån?",
    ask_contact: "Får jag ditt namn och ett telefonnummer så att jag kan hålla dig uppdaterad?",
    matches: "Det här passar det du söker:",
    no_matches: "Just nu finns inget som passar helt, men jag hör av mig så fort något nytt kommer in. 🙌",
    visit: "Perfekt! Jag har noterat visningen ({time}) och en kollega bekräftar den snart.",
    handoff: "Toppen, nu har jag allt jag behöver. Jag skickar dina uppgifter till en av våra mäklare som kontaktar dig mycket snart. 🏡",
    thanks: "Tack! Hör av dig om du behöver något mer.",
  },
};

const TYPE_WORDS: [RegExp, string][] = [
  [/\b(atico|penthouse|takvaning)/, "atico"],
  [/\b(estudio|studio)\b/, "estudio"],
  [/\b(villa|chalet)\b/, "villa"],
  [/\b(casa|house|hus|adosado|townhouse|radhus)\b/, "casa"],
  [/\b(apartamento|piso|apartment|flat|lagenhet)/, "apartamento"],
  [/\b(terreno|parcela|plot|tomt)\b/, "terreno"],
];

export function extractProfile(raw: string, towns: string[]): Partial<LeadProfile> & { name?: string; phone?: string; email?: string } {
  const text = norm(raw);
  const out: Partial<LeadProfile> & { name?: string; phone?: string; email?: string } = {};

  for (const [re, type] of TYPE_WORDS) if (re.test(text)) { out.property_type = type; break; }

  const beds = text.match(/(\d+)\s*(hab|habitaciones|dormitorios|dorm|bed|bedrooms|beds|sovrum|rum)\b/);
  if (beds) out.bedrooms_min = Number(beds[1]);

  // Presupuesto: 300k, 300.000, 300 000 €, 300 mil, 1,2 millones
  const money = text.replace(/\+?\d[\d\s-]{8,}\d/g, " "); // quita teléfonos
  const mill = money.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|million|miljoner|miljon)/);
  const kilo = money.match(/(\d{2,4})\s*(k|mil|tusen)\b/);
  const full = money.match(/(\d{1,3}(?:[.\s]\d{3})+|\d{5,7})/);
  if (mill) out.budget_max = Math.round(parseFloat(mill[1].replace(",", ".")) * 1_000_000);
  else if (kilo) out.budget_max = Number(kilo[1]) * 1000;
  else if (full) {
    const n = Number(full[1].replace(/[.\s]/g, ""));
    if (n >= 30000 && n <= 20_000_000) out.budget_max = n;
  }

  const months = text.match(/(\d+)\s*(meses|mes|months|month|manader|manad)/);
  if (months) out.timeline_months = Number(months[1]);
  else if (/\b(ya|cuanto antes|asap|right away|now|direkt|snarast|nu)\b/.test(text)) out.timeline_months = 1;
  else if (/(ano que viene|proximo ano|next year|nasta ar)/.test(text)) out.timeline_months = 12;

  if (/(contado|cash|kontant)/.test(text)) out.financing = "contado";
  else if (/(hipoteca aprobada|preaprobada|pre-approved|approved mortgage|lanelofte|beviljat)/.test(text)) out.financing = "hipoteca_aprobada";
  else if (/\b(hipoteca|mortgage|bolan|lan)\b/.test(text)) out.financing = "hipoteca_pendiente";

  if (/(visita|visitar|ver el|verlo|verla|ver la casa|ver el piso|viewing|visit|see it|see the|we see|i see|view it|visning|titta pa|besichtig|anschauen|visiter|voir le|voir la)/.test(text)) out.wants_visit = true;

  const zones = towns.filter((t) => text.includes(norm(t)));
  if (zones.length) out.zones = zones;

  const email = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) out.email = email[0];
  const phone = raw.match(/\+?\d[\d\s-]{7,}\d/);
  if (phone) out.phone = phone[0].trim();
  const name = raw.match(/(?:[Mm]e llamo|[Ss]oy|[Mm]y name is|I'm|I am|[Jj]ag heter|[Mm]itt namn är)\s+([A-ZÁÉÍÓÚÅÄÖ][\p{L}]+(?:\s[A-ZÁÉÍÓÚÅÄÖ][\p{L}]+)?)/u);
  if (name) out.name = name[1];
  return out;
}

export async function runMockAgent(input: AgentInput): Promise<AgentOutput> {
  if (input.agency.vertical === "vacacional") return runMockVacationAgent(input);
  const { agency, lead, history, catalog } = input;
  const state = emptyTurnState();
  const lastIn = [...history].reverse().find((m) => m.direction === "in");
  const text = lastIn?.body ?? "";
  const lang = lead.inboundCount <= 1 ? detectLang(text, lead.language) : lead.language;
  if (lang !== lead.language) state.contactPatch.language = lang;
  const t = lang === "es" || lang === "sv" ? T[lang] : T.en;

  const towns = [...new Set(catalog.flatMap((p) => [p.town, p.zone]).filter(Boolean))];
  const { name, phone, email, ...profilePatch } = extractProfile(text, towns);
  Object.assign(state.contactPatch, Object.fromEntries(Object.entries({ name, phone, email }).filter(([, v]) => v)));
  Object.assign(state.profilePatch, profilePatch);

  const refMatch = text.toUpperCase().match(/\b[A-Z]{2}-\d{3}\b/);
  const profile: LeadProfile = { ...lead.profile, ...state.profilePatch };
  const hasContact = !!(lead.phone || lead.email || state.contactPatch.phone || state.contactPatch.email);
  const { score } = scoreLead(profile, { inboundCount: lead.inboundCount, hasContact });

  const parts: string[] = [];
  const firstReply = !history.some((m) => m.direction === "out");
  if (firstReply) parts.push(fill(t.greet, agency.assistantName, agency.name));

  // Propiedades a mostrar
  const justLearnedSearch = profilePatch.property_type || profilePatch.budget_max || profilePatch.zones || refMatch;
  if (justLearnedSearch) {
    const found = refMatch
      ? searchCatalog(catalog, { ref: refMatch[0] })
      : searchCatalog(catalog, {
          type: profile.property_type,
          max_price: profile.budget_max,
          min_bedrooms: profile.bedrooms_min,
          town_or_zone: profile.zones?.[0],
        }).slice(0, 2);
    if (refMatch && found[0] && !profile.property_type) {
      state.profilePatch.property_type = found[0].type;
      profile.property_type = found[0].type;
    }
    if (found.length) {
      parts.push(t.matches);
      for (const p of found) {
        parts.push(`• ${p.ref}: ${p.title} — ${formatPrice(p.price)}`);
        state.shownRefs.push(p.ref);
      }
    } else if (profile.budget_max && profile.property_type) parts.push(t.no_matches);
  }

  if (profilePatch.wants_visit) {
    const when = visitTime(text);
    state.visit = { propertyRef: refMatch?.[0] ?? lastShownRef(history), preferredTime: when ?? "a convenir" };
    parts.push(fill(t.visit, agency.assistantName, agency.name).replace(" ({time})", when ? ` (${when})` : ""));
  }

  if (score >= agency.handoffThreshold || state.visit) {
    state.handoff = {
      reason: state.visit ? "Pidió visita" : `Puntaje ${score} ≥ ${agency.handoffThreshold}`,
      summary: demoSummary(lead.name ?? name, profile),
    };
    if (!state.visit) parts.push(t.handoff);
    if (!hasContact && lead.channel !== "whatsapp") parts.push(t.ask_contact);
  } else {
    const next: Key | undefined = !profile.property_type ? "ask_type"
      : !profile.zones?.length ? "ask_zone"
      : !profile.budget_max ? "ask_budget"
      : profile.timeline_months === undefined ? "ask_timeline"
      : !profile.financing ? "ask_financing"
      : !hasContact ? "ask_contact"
      : undefined;
    parts.push(next ? t[next] : t.thanks);
  }

  return { reply: parts.join("\n"), state, engine: "demo" };
}

/** Frase de cuándo quiere visitar: "este sábado", "next Monday morning", "på lördag"... */
function visitTime(text: string): string | undefined {
  const days = "lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|mañana|fin de semana|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|weekend|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|imorgon|helgen";
  const m = text.match(new RegExp(`((?:este|esta|el|la|el próximo|next|this|on|på|nästa)\\s+)?(${days})(\\s+(?:por la |a la |in the |på )?(?:mañana|tarde|morning|afternoon|förmiddag|eftermiddag))?`, "i"));
  return m ? m[0].trim() : undefined;
}

function fill(s: string, assistant: string, agency: string) {
  return s.replace("{assistant}", assistant).replace("{agency}", agency);
}

function lastShownRef(history: AgentInput["history"]): string | undefined {
  for (const m of [...history].reverse()) {
    const r = m.direction === "out" && m.body.match(/\b[A-Z]{2}-\d{3}\b/);
    if (r) return r[0];
  }
}

function demoSummary(name: string | null | undefined, p: LeadProfile): string {
  const bits = [
    name ? `${name}.` : "Comprador sin nombre.",
    p.property_type && `Busca ${p.property_type}${p.bedrooms_min ? ` de ${p.bedrooms_min} dorm.` : ""}`,
    p.zones?.length && `en ${p.zones.join("/")}`,
    p.budget_max && `hasta ${formatPrice(p.budget_max)}.`,
    p.timeline_months !== undefined && `Plazo: ${p.timeline_months} meses.`,
    p.financing && `Financiación: ${p.financing.replace("_", " ")}.`,
    p.wants_visit && "Quiere visitar.",
  ];
  return bits.filter(Boolean).join(" ");
}
