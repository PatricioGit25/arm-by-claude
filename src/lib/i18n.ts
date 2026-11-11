import type { Lang } from "./db/schema";

const SV = /\b(hej|tjena|jag|vi|söker|letar|lägenhet|hus|sovrum|kronor|tack|hur|är|och|med|vill|köpa|visning|månader)\b|[åäö]/i;
const EN = /\b(hi|hello|hey|i'm|i am|we are|looking|bedroom|bedrooms|house|apartment|flat|buy|budget|thanks|thank you|please|would|could|viewing|months|cash|mortgage)\b/i;
const ES = /\b(hola|busco|buscamos|quiero|piso|casa|habitaciones|dormitorios|presupuesto|gracias|comprar|meses|hipoteca|contado|visita|el|la|los|para|con)\b|[ñ¿¡]/i;

/** Detección simple de idioma (es/en/sv). Claude detecta mejor; esto es para el modo demo. */
export function detectLang(text: string, fallback: Lang = "es"): Lang {
  const sv = (text.match(new RegExp(SV, "gi")) ?? []).length;
  const en = (text.match(new RegExp(EN, "gi")) ?? []).length;
  const es = (text.match(new RegExp(ES, "gi")) ?? []).length;
  const max = Math.max(sv, en, es);
  if (max === 0) return fallback;
  if (sv === max) return "sv";
  if (es === max) return "es";
  return "en";
}

export const LANG_LABEL: Record<Lang, string> = {
  es: "Español",
  en: "English",
  sv: "Svenska",
};

export const LANG_FLAG: Record<Lang, string> = { es: "🇪🇸", en: "🇬🇧", sv: "🇸🇪" };
