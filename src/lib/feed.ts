/**
 * Sincroniza el catálogo con el feed XML del CRM de la agencia. Soporta el
 * formato Kyero v3 (el que exportan la mayoría de CRMs para portales) y
 * feeds genéricos con una lista de <property>/<listing> con precio.
 */
import { XMLParser } from "fast-xml-parser";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { agencies, properties, type Agency, type Property } from "./db/schema";
import { matchNewProperty } from "./engine";

type Node = Record<string, unknown>;

const TYPE_MAP: [RegExp, string][] = [
  [/penthouse|atico|ático|duplex penthouse/i, "atico"],
  [/studio|estudio/i, "estudio"],
  [/villa|chalet|finca|cortijo|country/i, "villa"],
  [/town ?house|adosado|semi|bungalow|house|casa|detached|linked/i, "casa"],
  [/apartment|apartamento|flat|piso|duplex|ground floor|planta baja/i, "apartamento"],
  [/plot|land|parcela|terreno|solar/i, "terreno"],
  [/commercial|local|office|oficina|garage|garaje|parking/i, "comercial"],
];

const TYPE_ES: Record<string, string> = { atico: "Ático", estudio: "Estudio", villa: "Villa", casa: "Casa", apartamento: "Apartamento", terreno: "Terreno", comercial: "Local" };

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (Array.isArray(v)) return text(v[0]);
  const o = v as Node;
  if ("#text" in o) return text(o["#text"]);
  return "";
}

function num(v: unknown): number {
  const n = Number(text(v).replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function pickLang(v: unknown, order = ["es", "en"]): string {
  if (!v || typeof v !== "object") return text(v);
  const o = v as Node;
  for (const l of order) if (text(o[l])) return text(o[l]);
  return text(Object.values(o)[0]);
}

/** Busca la primera lista de nodos que parezcan inmuebles (tienen precio). */
function findListings(node: unknown, depth = 0): Node[] {
  if (!node || typeof node !== "object" || depth > 6) return [];
  for (const [k, v] of Object.entries(node as Node)) {
    const arr = Array.isArray(v) ? v : [v];
    if (/^(property|listing|inmueble|propiedad|ad|item)$/i.test(k) && arr.some((x) => x && typeof x === "object" && ("price" in (x as Node) || "precio" in (x as Node)))) {
      return arr as Node[];
    }
  }
  for (const v of Object.values(node as Node)) {
    const found = findListings(Array.isArray(v) ? v[0] : v, depth + 1);
    if (found.length) return found;
  }
  return [];
}

export interface FeedProperty {
  externalId: string; ref: string; title: string; type: string; price: number; operation: "sale" | "rent";
  bedrooms: number; bathrooms: number; areaM2: number; town: string; zone: string; description: string;
  features: string[]; imageUrl?: string; url?: string;
}

export function parseFeed(xml: string): FeedProperty[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true });
  const doc = parser.parse(xml) as Node;
  const out: FeedProperty[] = [];
  for (const p of findListings(doc)) {
    const id = text(p.id) || text(p["@_id"]) || text(p.ref) || text(p.reference);
    if (!id) continue;
    const rawType = text(p.type) || text(p.tipo) || text(p.property_type);
    const type = TYPE_MAP.find(([re]) => re.test(rawType))?.[1] ?? (rawType.toLowerCase() || "apartamento");
    const town = text(p.town) || text(p.city) || text(p.ciudad) || text(p.municipio) || text(p.province);
    const zone = text(p.location_detail) || text(p.area) || text(p.zona) || text(p.urbanization) || "";
    const beds = num(p.beds ?? p.bedrooms ?? p.dormitorios ?? p.habitaciones);
    const baths = num(p.baths ?? p.bathrooms ?? p.banos);
    const surf = p.surface_area as Node | undefined;
    const area = num(surf?.built ?? p.built ?? p.size ?? p.superficie ?? p.m2);
    const freq = text(p.price_freq).toLowerCase();
    const operation: "sale" | "rent" = !freq || freq === "sale" ? "sale" : "rent";
    const featuresNode = (p.features as Node | undefined)?.feature ?? p.features;
    const features = (Array.isArray(featuresNode) ? featuresNode : featuresNode ? [featuresNode] : []).map(text).filter(Boolean).slice(0, 12);
    if (text(p.pool) === "1" && !features.some((f) => /pool|piscina/i.test(f))) features.unshift("piscina");
    const imgs = (p.images as Node | undefined)?.image;
    const firstImg = Array.isArray(imgs) ? imgs[0] : imgs;
    const title = pickLang(p.title) ||
      `${TYPE_ES[type] ?? rawType}${beds ? ` de ${beds} dormitorio${beds > 1 ? "s" : ""}` : ""}${town ? ` en ${zone && zone !== town ? `${zone}, ` : ""}${town}` : ""}`;
    out.push({
      externalId: id,
      ref: (text(p.ref) || text(p.reference) || `CRM-${id}`).slice(0, 40),
      title: title.slice(0, 160),
      type, price: num(p.price ?? p.precio), operation,
      bedrooms: beds, bathrooms: baths, areaM2: area, town: town || "—", zone,
      description: pickLang(p.desc ?? p.description ?? p.descripcion).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500),
      features,
      imageUrl: firstImg ? text((firstImg as Node).url ?? firstImg) || undefined : undefined,
      url: pickLang(p.url, ["es", "en"]) || undefined,
    });
  }
  return out;
}

export async function syncFeed(agency: Agency): Promise<{ ok: boolean; message: string; created: number; updated: number; removed: number }> {
  const db = await getDb();
  const fail = async (message: string) => {
    await db.update(agencies).set({ feedStatus: `⚠ ${message}` }).where(eq(agencies.id, agency.id));
    return { ok: false, message, created: 0, updated: 0, removed: 0 };
  };
  if (!agency.feedUrl) return fail("No hay feed configurado");
  let xml: string;
  try {
    const res = await fetch(agency.feedUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return fail(`El feed respondió ${res.status}`);
    xml = await res.text();
  } catch (err) {
    return fail(`No se pudo descargar el feed (${err instanceof Error ? err.message : "error"})`);
  }
  let items: FeedProperty[];
  try {
    items = parseFeed(xml);
  } catch {
    return fail("El archivo no es un XML válido");
  }
  if (agency.vertical === "venta") items = items.filter((i) => i.operation === "sale");
  if (!items.length) return fail("No encontré inmuebles en el feed");

  const firstSync = !agency.feedSyncedAt;
  const existing = await db.select().from(properties).where(eq(properties.agencyId, agency.id));
  const byExt = new Map(existing.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  const usedRefs = new Set(existing.map((p) => p.ref));
  let created = 0, updated = 0, removed = 0;
  const fresh: Property[] = [];
  const seen = new Set<string>();

  for (const it of items) {
    seen.add(it.externalId);
    const values = {
      title: it.title, type: it.type, price: it.price, bedrooms: it.bedrooms, bathrooms: it.bathrooms, areaM2: it.areaM2,
      town: it.town, zone: it.zone, description: it.description, features: it.features,
      imageUrl: it.imageUrl ?? null, bookingUrl: it.url ?? null, status: "disponible", origin: "feed",
    };
    const prev = byExt.get(it.externalId);
    if (prev) {
      await db.update(properties).set(values).where(eq(properties.id, prev.id));
      updated++;
    } else {
      let ref = it.ref;
      if (usedRefs.has(ref)) ref = `${ref}-${it.externalId}`.slice(0, 40);
      usedRefs.add(ref);
      const [row] = await db.insert(properties).values({ ...values, agencyId: agency.id, ref, externalId: it.externalId }).returning();
      fresh.push(row);
      created++;
    }
  }
  for (const p of existing) {
    if (p.origin === "feed" && p.externalId && !seen.has(p.externalId) && p.status === "disponible") {
      await db.update(properties).set({ status: "retirada" }).where(and(eq(properties.id, p.id), eq(properties.agencyId, agency.id)));
      removed++;
    }
  }
  // En la primera carga no se avisa a nadie (serían todas "nuevas").
  if (!firstSync) for (const p of fresh) await matchNewProperty(agency, p);

  const message = `${items.length} inmuebles en el feed · ${created} nuevos · ${updated} actualizados · ${removed} retirados`;
  await db.update(agencies).set({ feedSyncedAt: new Date(), feedStatus: `✓ ${message}` }).where(eq(agencies.id, agency.id));
  return { ok: true, message, created, updated, removed };
}
