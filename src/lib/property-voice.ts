/**
 * Alta de propiedades por voz o nota: el agente dicta lo que ha visto y el ARM
 * crea la ficha, redacta la descripción (es/en/sv) y avisa a los compradores
 * que encajan.
 */
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { properties, type Agency, type Property } from "./db/schema";
import { extractPropertyWithClaude, hasClaude } from "./agent/claude";
import { extractProfile } from "./agent/mock";
import { matchNewProperty } from "./engine";
import { formatPrice, norm } from "./scoring";

export interface PropertyDraft {
  title: string; type: string; price: number; bedrooms: number; bathrooms: number; areaM2: number;
  town: string; zone: string; features: string[]; ownerContact?: string; description: string; maxGuests?: number;
}

const FEATURES: [RegExp, string][] = [
  [/vistas? al mar|sea views?/i, "vistas al mar"], [/piscina privada/i, "piscina privada"], [/piscina/i, "piscina"],
  [/terraza/i, "terraza"], [/balc[oó]n/i, "balcón"], [/jard[ií]n/i, "jardín"], [/garaje|parking|plaza de aparcamiento/i, "garaje"],
  [/trastero/i, "trastero"], [/ascensor/i, "ascensor"], [/aire acondicionado|a\/?c\b/i, "aire acondicionado"],
  [/calefacci[oó]n/i, "calefacción"], [/reformad[oa]/i, "reformado"], [/amueblad[oa]/i, "amueblado"],
  [/solarium|solárium/i, "solárium"], [/primera l[ií]nea/i, "primera línea de playa"], [/licencia tur[ií]stica/i, "licencia turística"],
];

const TYPE_ES: Record<string, string> = { atico: "Ático", estudio: "Estudio", villa: "Villa", casa: "Casa", apartamento: "Apartamento", terreno: "Terreno" };

export function parsePropertyNote(note: string, agency: Agency, catalog: Property[]): PropertyDraft {
  const towns = [...new Set([agency.town, ...catalog.flatMap((p) => [p.town, p.zone])].filter(Boolean))];
  const prof = extractProfile(note, towns);
  const t = norm(note);
  const area = Number(t.match(/(\d{2,4})\s*(m2|m²|metros|mts|sqm)/)?.[1] ?? 0);
  const baths = Number(t.match(/(\d)\s*(banos|bano|bathrooms?)/)?.[1] ?? 0);
  const features = FEATURES.filter(([re]) => re.test(note)).map(([, f]) => f).filter((f, i, a) => !(f === "piscina" && a.includes("piscina privada")) && a.indexOf(f) === i);
  const zones = prof.zones ?? [];
  const town = zones.find((z) => catalog.some((p) => norm(p.town) === norm(z))) ?? agency.town ?? "";
  const zone = zones.find((z) => norm(z) !== norm(town)) ?? "";
  const owner = note.match(/(?:propietari[oa]|due[ñn][oa])\s*:?\s*([\p{L}]+(?:\s[\p{Lu}][\p{L}]+)?)/iu)?.[1];
  const phone = note.match(/\+?\d[\d\s-]{7,}\d/)?.[0]?.trim();
  const type = prof.property_type ?? "apartamento";
  const beds = prof.bedrooms_min ?? 0;
  const title = `${TYPE_ES[type] ?? "Inmueble"}${beds ? ` de ${beds} dormitorio${beds > 1 ? "s" : ""}` : ""}${zone ? ` en ${zone}` : town ? ` en ${town}` : ""}${features.includes("vistas al mar") ? " con vistas al mar" : ""}`;
  const description = `${title}${area ? `, ${area} m²` : ""}${baths ? `, ${baths} baño${baths > 1 ? "s" : ""}` : ""}.${features.length ? ` ${features.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(", ")}.` : ""}`;
  return {
    title, type, price: prof.budget_max ?? 0, bedrooms: beds, bathrooms: baths, areaM2: area, town, zone, features,
    ownerContact: [owner && owner.charAt(0).toUpperCase() + owner.slice(1), phone].filter(Boolean).join(" · ") || undefined,
    description,
  };
}

async function nextRef(agency: Agency): Promise<string> {
  const db = await getDb();
  const refs = new Set((await db.select({ ref: properties.ref }).from(properties).where(eq(properties.agencyId, agency.id))).map((r) => r.ref));
  const prefix = agency.name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "P";
  let n = refs.size + 101;
  while (refs.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

export async function addPropertyFromNote(agency: Agency, note: string): Promise<{ property: Property; notified: number; missing: string[] }> {
  const db = await getDb();
  const catalog = await db.select().from(properties).where(eq(properties.agencyId, agency.id));
  let draft = parsePropertyNote(note, agency, catalog);
  if (hasClaude()) {
    try {
      draft = await extractPropertyWithClaude(agency, note);
    } catch (err) {
      console.error("[ARM] Alta de propiedad con IA falló, uso reglas:", err);
    }
  }
  const [property] = await db.insert(properties).values({
    agencyId: agency.id, ref: await nextRef(agency), title: draft.title, type: draft.type, price: draft.price,
    bedrooms: draft.bedrooms, bathrooms: draft.bathrooms, areaM2: draft.areaM2, town: draft.town || agency.town || "—", zone: draft.zone,
    description: draft.description, features: draft.features, ownerContact: draft.ownerContact ?? null, origin: "voz",
    maxGuests: draft.maxGuests ?? 0,
  }).returning();
  const notified = await matchNewProperty(agency, property);
  const missing = [
    agency.vertical === "venta" && !draft.price && "precio",
    !draft.town && "pueblo",
    agency.vertical === "venta" && !draft.bedrooms && draft.type !== "terreno" && "dormitorios",
  ].filter(Boolean) as string[];
  return { property, notified, missing };
}

export function describeDraft(p: Property): string {
  return `${p.ref} · ${p.title}${p.price ? ` · ${formatPrice(p.price)}` : ""}`;
}
