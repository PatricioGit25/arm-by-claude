import type { Lang } from "./db/schema";

const PATTERNS: Record<Lang, RegExp> = {
  sv: /\b(hej|tjena|jag|vi|söker|letar|lägenhet|hus|sovrum|tack|hur|är|och|med|vill|köpa|hyra|visning|månader|nätter|personer)\b|[åä]/i,
  en: /\b(hi|hello|hey|i'm|i am|we are|looking|bedroom|bedrooms|house|apartment|flat|buy|budget|thanks|thank you|please|would|could|viewing|months|cash|mortgage|nights|people|available|booking)\b/i,
  es: /\b(hola|busco|buscamos|quiero|piso|casa|habitaciones|dormitorios|presupuesto|gracias|comprar|meses|hipoteca|contado|visita|noches|personas|disponible|reserva|el|la|los|para|con)\b|[ñ¿¡]/i,
  de: /\b(hallo|guten|ich|wir|suchen|wohnung|haus|schlafzimmer|danke|bitte|nächte|personen|frei|buchen|und|mit|für|ist|nicht)\b|ß|[äöü]/i,
  fr: /\b(bonjour|salut|je|nous|cherche|cherchons|appartement|maison|chambres|merci|nuits|personnes|disponible|réserver|avec|pour|est|une|les)\b|[çèêà]/i,
};

/** Detección simple de idioma. Claude detecta mejor; esto es para el modo demo. */
export function detectLang(text: string, fallback: Lang = "es"): Lang {
  let best: Lang = fallback;
  let max = 0;
  for (const lang of ["es", "en", "sv", "de", "fr"] as Lang[]) {
    const n = (text.match(new RegExp(PATTERNS[lang], "gi")) ?? []).length;
    if (n > max) {
      max = n;
      best = lang;
    }
  }
  return best;
}

export const LANG_LABEL: Record<Lang, string> = {
  es: "Español",
  en: "English",
  sv: "Svenska",
  de: "Deutsch",
  fr: "Français",
};

export const LANG_FLAG: Record<Lang, string> = { es: "🇪🇸", en: "🇬🇧", sv: "🇸🇪", de: "🇩🇪", fr: "🇫🇷" };
