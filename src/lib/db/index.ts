import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzlePglite<typeof schema>>;

// Esquema idempotente. Se ejecuta al arrancar (sirve igual para PGlite y Postgres).
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  town text NOT NULL DEFAULT '',
  languages jsonb NOT NULL DEFAULT '["es","en","sv"]',
  handoff_threshold integer NOT NULL DEFAULT 70,
  agent_phone text,
  wa_phone_number_id text,
  assistant_name text NOT NULL DEFAULT 'Sofía',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'agent',
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  ref text NOT NULL,
  title text NOT NULL,
  type text NOT NULL,
  price integer NOT NULL,
  bedrooms integer NOT NULL DEFAULT 0,
  bathrooms integer NOT NULL DEFAULT 0,
  area_m2 integer NOT NULL DEFAULT 0,
  town text NOT NULL,
  zone text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  features jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'disponible',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, ref)
);
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  name text, phone text, email text, external_id text,
  language text NOT NULL DEFAULT 'es',
  channel text NOT NULL DEFAULT 'web',
  source text,
  stage text NOT NULL DEFAULT 'nuevo',
  score integer NOT NULL DEFAULT 0,
  profile jsonb NOT NULL DEFAULT '{}',
  summary text,
  ai_paused boolean NOT NULL DEFAULT false,
  assigned_user_id uuid,
  inbound_count integer NOT NULL DEFAULT 0,
  followup_count integer NOT NULL DEFAULT 0,
  next_followup_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  handed_off_at timestamptz,
  lost_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_agency_stage ON leads (agency_id, stage);
CREATE UNIQUE INDEX IF NOT EXISTS leads_agency_channel_ext ON leads (agency_id, channel, external_id);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direction text NOT NULL,
  author text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_lead ON messages (lead_id, created_at);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  lead_id uuid,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_agency ON events (agency_id, created_at);
CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  property_id uuid,
  preferred_time text NOT NULL,
  status text NOT NULL DEFAULT 'pendiente',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'venta';
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS knowledge text NOT NULL DEFAULT '';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS max_guests integer NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pets_allowed text NOT NULL DEFAULT 'consultar';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS booking_url text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS guest_info text NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS guest_property_id uuid;
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  lead_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

type Holder = { promise?: Promise<DB> };
const g = globalThis as unknown as { __armDb?: Holder };
const holder: Holder = (g.__armDb ??= {});

/**
 * Limpia errores típicos al pegar la URL: comillas, espacios, el prefijo
 * `psql '...'` que muestra Neon o `DATABASE_URL=` copiado de un .env.
 */
export function cleanDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  // Si se pegó un bloque .env entero (como el que da Neon), usa la línea
  // DATABASE_URL= y, si no está, la primera URL postgres que aparezca.
  const line = raw.match(/^\s*DATABASE_URL\s*=\s*(.+)$/im)?.[1];
  const found = (line ?? raw).match(/postgres(?:ql)?:\/\/[^\s'"]+/i)?.[0];
  if (!found) {
    throw new Error("DATABASE_URL no es válida: tiene que contener una dirección postgresql:// (revisa la variable en Vercel)");
  }
  let url = found;
  // pg trata sslmode=require como verify-full; con Neon basta TLS normal.
  return url.replace(/([?&])channel_binding=require&?/, "$1").replace(/[?&]$/, "");
}

// Evita que dos arranques en frío creen tablas o datos de ejemplo a la vez.
const LOCK = "SELECT pg_advisory_lock(727274);";
const UNLOCK = "SELECT pg_advisory_unlock(727274);";

async function connect(): Promise<DB> {
  const url = cleanDatabaseUrl(process.env.DATABASE_URL);
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000 });
    const client = await pool.connect();
    try {
      await client.query(LOCK);
      await client.query(BOOTSTRAP_SQL);
      const db = drizzlePg(client, { schema }) as unknown as DB;
      const { seedIfEmpty } = await import("../seed");
      await seedIfEmpty(db);
    } finally {
      await client.query(UNLOCK).catch(() => {});
      client.release();
    }
    return drizzlePg(pool, { schema }) as unknown as DB;
  }
  if (process.env.VERCEL) {
    throw new Error("Falta DATABASE_URL en las variables de entorno de Vercel");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DIR ?? "./.data/pglite";
  if (dataDir !== "memory") (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = dataDir === "memory" ? new PGlite() : new PGlite(dataDir);
  await client.exec(BOOTSTRAP_SQL);
  const db = drizzlePglite(client, { schema });
  const { seedIfEmpty } = await import("../seed");
  await seedIfEmpty(db);
  return db;
}

export async function getDb(): Promise<DB> {
  if (!holder.promise) {
    holder.promise = connect();
    holder.promise.catch((err) => {
      console.error("[ARM] No se pudo conectar a la base de datos:", err);
      holder.promise = undefined;
    });
  }
  return holder.promise;
}

export { schema };
