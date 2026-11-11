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

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    await pool.query(BOOTSTRAP_SQL);
    return drizzlePg(pool, { schema }) as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DIR ?? "./.data/pglite";
  if (dataDir !== "memory") (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = dataDir === "memory" ? new PGlite() : new PGlite(dataDir);
  await client.exec(BOOTSTRAP_SQL);
  return drizzlePglite(client, { schema });
}

export async function getDb(): Promise<DB> {
  if (!holder.promise) {
    holder.promise = (async () => {
      const db = await connect();
      const { seedIfEmpty } = await import("../seed");
      await seedIfEmpty(db);
      return db;
    })();
    holder.promise.catch(() => (holder.promise = undefined));
  }
  return holder.promise;
}

export { schema };
