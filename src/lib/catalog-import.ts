/**
 * Importa un catálogo (JSON o CSV) con columnas en español:
 * ref, titulo, tipo, precio, dormitorios, banos, m2, pueblo, zona, gastos, ibi,
 * licencia_turistica, agente, agente_tel, agente_email, enlace, imagen,
 * caracteristicas (lista o separadas por ";"), descripcion.
 * Crea los agentes que no existan y actualiza los inmuebles por referencia.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { agents, properties, type Agency } from "./db/schema";

type Row = Record<string, unknown>;

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field); rows.push(cur); cur = []; field = "";
    } else field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]?.trim() ?? ""])));
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const int = (v: unknown) => {
  const n = Number(str(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const TYPES: [RegExp, string][] = [
  [/atico|ático|penthouse/i, "atico"], [/estudio|studio/i, "estudio"], [/villa|chalet|cortijo|finca/i, "villa"],
  [/casa|adosad|townhouse|house/i, "casa"], [/terreno|parcela|plot/i, "terreno"], [/apart|piso|condominio|flat/i, "apartamento"],
];

export async function importCatalog(agency: Agency, raw: string) {
  const text = raw.trim().replace(/^﻿/, "");
  let rows: Row[];
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text) as Row[] | { properties?: Row[] };
    rows = Array.isArray(parsed) ? parsed : parsed.properties ?? [];
  } else rows = parseCsv(text);
  if (!rows.length) throw new Error("No encontré inmuebles en el archivo");

  const db = await getDb();
  const team = await db.select().from(agents).where(eq(agents.agencyId, agency.id));
  let created = 0, updated = 0, newAgents = 0;
  for (const r of rows) {
    const ref = str(r.ref ?? r.referencia);
    const title = str(r.titulo ?? r.title);
    if (!ref || !title) continue;
    let agentId: string | null = null;
    const agentName = str(r.agente ?? r.agent);
    if (agentName) {
      let a = team.find((t) => t.name.toLowerCase() === agentName.toLowerCase());
      if (!a) {
        [a] = await db.insert(agents).values({ agencyId: agency.id, name: agentName, phone: str(r.agente_tel) || null, email: str(r.agente_email) || null }).returning();
        team.push(a);
        newAgents++;
      }
      agentId = a.id;
    }
    const rawType = str(r.tipo ?? r.type);
    const feats = Array.isArray(r.caracteristicas) ? (r.caracteristicas as unknown[]).map(str) : str(r.caracteristicas).split(/[;|]/).map((x) => x.trim());
    const values = {
      title, type: TYPES.find(([re]) => re.test(rawType))?.[1] ?? (rawType.toLowerCase() || "apartamento"),
      price: int(r.precio ?? r.price), bedrooms: int(r.dormitorios), bathrooms: int(r.banos ?? r.baños), areaM2: int(r.m2),
      town: str(r.pueblo ?? r.town) || agency.town || "—", zone: str(r.zona), description: str(r.descripcion).slice(0, 2000),
      features: feats.filter(Boolean).slice(0, 15), communityFees: str(r.gastos) || null, ibi: str(r.ibi) || null,
      touristLicense: str(r.licencia_turistica) || null, bookingUrl: str(r.enlace ?? r.url) || null, imageUrl: str(r.imagen) || null,
      agentId, origin: "import", status: "disponible",
    };
    const prev = (await db.select().from(properties).where(and(eq(properties.agencyId, agency.id), eq(properties.ref, ref))))[0];
    if (prev) {
      await db.update(properties).set(values).where(eq(properties.id, prev.id));
      updated++;
    } else {
      await db.insert(properties).values({ ...values, ref, agencyId: agency.id });
      created++;
    }
  }
  return { created, updated, agents: newAgents };
}
