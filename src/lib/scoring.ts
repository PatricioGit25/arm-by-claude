import type { LeadProfile, Property, Stage } from "./db/schema";

/**
 * Puntaje 0-100 de "intención de compra". Determinista y explicable: el agente
 * inmobiliario puede ver por qué un lead se considera listo.
 */
export function scoreLead(
  profile: LeadProfile,
  opts: { inboundCount: number; hasContact: boolean },
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(`+${n} ${why}`);
  };

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
export function propertyMatches(p: Property, profile: LeadProfile): boolean {
  if (p.status !== "disponible") return false;
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
  ["apartamento", "piso", "apartment", "flat", "lagenhet", "atico", "penthouse", "takvaning", "estudio", "studio"],
  ["casa", "house", "hus", "adosado", "townhouse", "radhus", "villa", "chalet"],
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
  const manual: Stage[] = ["listo", "visita", "oferta", "cerrado", "perdido"];
  if (manual.includes(current)) return current;
  if (score >= threshold) return "listo";
  if (score > 0) return "calificando";
  return current;
}

export const STAGE_LABEL: Record<Stage, string> = {
  nuevo: "Nuevo",
  calificando: "Calificando (IA)",
  seguimiento: "En seguimiento",
  listo: "Listo para comprar",
  visita: "Visita agendada",
  oferta: "Oferta",
  cerrado: "Cerrado",
  perdido: "Perdido",
};

export function formatPrice(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
