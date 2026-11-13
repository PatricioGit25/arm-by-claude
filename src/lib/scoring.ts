import type { LeadProfile, Property, Stage, Vertical } from "./db/schema";

/**
 * Puntaje 0-100 de intención (comprar o reservar). Determinista y explicable:
 * el equipo puede ver por qué un lead se considera listo.
 */
export function scoreLead(
  profile: LeadProfile,
  opts: { inboundCount: number; hasContact: boolean },
  vertical: Vertical = "venta",
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(`+${n} ${why}`);
  };

  if (vertical === "comercial") {
    if (profile.company) add(20, "sabemos qué agencia es");
    if (profile.business_type) add(10, "tipo de negocio claro");
    if (profile.leads_month || profile.channels) add(10, "conocemos su volumen o canales");
    if (profile.crm) add(10, "sabemos qué CRM usa");
    if (opts.hasContact) add(20, "dejó teléfono o email");
    if (profile.wants_visit) add(30, "quiere ver la demo");
    return { score: Math.min(100, score), reasons };
  }

  if (vertical === "vacacional") {
    if (profile.check_in) add(25, "fechas definidas");
    if (profile.guests) add(15, "sabe cuántas personas son");
    if (profile.property_ref || profile.zones?.length || profile.property_type) add(10, "sabe qué alojamiento o zona quiere");
    if (profile.wants_booking) add(30, "quiere reservar");
    if (opts.hasContact) add(10, "dejó teléfono o email");
    if (opts.inboundCount >= 3) add(10, "conversación activa");
    return { score: Math.min(100, score), reasons };
  }

  if (profile.budget_max) add(20, "presupuesto definido");
  if (profile.property_type) add(10, "sabe qué tipo de propiedad busca");
  if (profile.zones?.length) add(10, "zona definida");
  if (profile.timeline_months !== undefined) {
    if (profile.timeline_months <= 3) add(20, "quiere comprar en ≤3 meses");
    else if (profile.timeline_months <= 6) add(10, "quiere comprar en ≤6 meses");
  }
  if (profile.financing === "contado" || profile.financing === "hipoteca_aprobada")
    add(20, "financiación resuelta");
  else if (profile.financing === "hipoteca_pendiente") add(5, "tramitando hipoteca");
  if (profile.wants_visit) add(15, "pidió visitar");
  if (opts.hasContact) add(5, "dejó teléfono o email");
  if (opts.inboundCount >= 4) add(5, "conversación activa");

  return { score: Math.min(100, score), reasons };
}

/** ¿Encaja una propiedad con lo que busca el lead? */
export function propertyMatches(p: Property, profile: LeadProfile, vertical: Vertical = "venta"): boolean {
  if (p.status !== "disponible") return false;
  if (vertical === "vacacional") {
    if (!profile.guests && !profile.property_type) return false;
    if (profile.guests && p.maxGuests && p.maxGuests < profile.guests) return false;
    if (profile.pets && p.petsAllowed === "no") return false;
    if (profile.property_type && !sameType(p.type, profile.property_type)) return false;
    if (profile.zones?.length) {
      const hay = norm(`${p.town} ${p.zone}`);
      if (!profile.zones.some((z) => hay.includes(norm(z)))) return false;
    }
    return true;
  }
  if (!profile.budget_max && !profile.property_type) return false;
  if (profile.budget_max && p.price > profile.budget_max * 1.05) return false;
  if (profile.bedrooms_min && p.bedrooms < profile.bedrooms_min) return false;
  if (profile.property_type && !sameType(p.type, profile.property_type)) return false;
  if (profile.zones?.length) {
    const hay = norm(`${p.town} ${p.zone}`);
    if (!profile.zones.some((z) => hay.includes(norm(z)))) return false;
  }
  return true;
}

const TYPE_GROUPS: string[][] = [
  ["apartamento", "piso", "apartment", "flat", "lagenhet", "atico", "penthouse", "takvaning", "estudio", "studio", "wohnung", "appartement"],
  ["casa", "house", "hus", "adosado", "townhouse", "radhus", "villa", "chalet", "haus", "maison"],
  ["terreno", "plot", "land", "tomt"],
];

export function sameType(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  return TYPE_GROUPS.some((g) => g.includes(na) && g.includes(nb));
}

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Etapa que corresponde según puntaje, sin retroceder etapas que puso un humano. */
export function nextStage(current: Stage, score: number, threshold: number): Stage {
  const manual: Stage[] = ["listo", "visita", "oferta", "cerrado", "perdido", "reservado", "huesped", "incidencia"];
  if (manual.includes(current)) return current;
  if (score >= threshold) return "listo";
  if (score > 0) return "calificando";
  return current;
}

const LABELS: Record<Stage, string> = {
  nuevo: "Nuevo",
  calificando: "Calificando (IA)",
  seguimiento: "En seguimiento",
  listo: "Listo para comprar",
  visita: "Visita agendada",
  oferta: "Oferta",
  cerrado: "Cerrado",
  perdido: "Perdido",
  reservado: "Reservado",
  huesped: "Huésped (en estancia)",
  incidencia: "Incidencia abierta",
};

const COMMERCIAL_LABELS: Partial<Record<Stage, string>> = {
  calificando: "Conversando (IA)",
  listo: "Quiere hablar",
  visita: "Demo agendada",
  oferta: "Propuesta enviada",
  cerrado: "Cliente",
};

const VACATION_LABELS: Partial<Record<Stage, string>> = {
  calificando: "Consultando (IA)",
  listo: "Quiere reservar",
};

export function stageLabel(stage: Stage, vertical: Vertical = "venta"): string {
  return (vertical === "vacacional" && VACATION_LABELS[stage]) || (vertical === "comercial" && COMMERCIAL_LABELS[stage]) || LABELS[stage] || stage;
}

/** Columnas del pipeline según el tipo de negocio. */
export function stagesFor(vertical: Vertical): Stage[] {
  return vertical === "vacacional"
    ? ["nuevo", "calificando", "seguimiento", "listo", "reservado", "huesped", "incidencia", "perdido"]
    : ["nuevo", "calificando", "seguimiento", "listo", "visita", "oferta", "cerrado", "perdido"];
}

export function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
