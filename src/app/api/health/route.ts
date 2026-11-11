import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { hasClaude } from "@/lib/agent/claude";

export const dynamic = "force-dynamic";

const UTF8 = { "content-type": "application/json; charset=utf-8" };

/** Diagnóstico sin datos sensibles: abre /api/health para ver qué falla. */
export async function GET() {
  const env = {
    DATABASE_URL: process.env.DATABASE_URL ? "configurada" : "FALTA",
    AUTH_SECRET: process.env.AUTH_SECRET ? "configurada" : "FALTA",
    CRON_SECRET: process.env.CRON_SECRET ? "configurada" : "FALTA",
    ANTHROPIC_API_KEY: hasClaude() ? "configurada (IA real)" : "no configurada (modo demo)",
  };
  try {
    const db = await getDb();
    const r = await db.execute(sql`select (select count(*) from agencies)::int as agencies, (select count(*) from leads)::int as leads`);
    const row = (Array.isArray(r) ? r[0] : (r as { rows: unknown[] }).rows[0]) as { agencies: number; leads: number };
    return NextResponse.json({ ok: true, database: "conectada", ...row, env }, { headers: UTF8 });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).replace(/postgres(ql)?:\/\/[^\s]+/gi, "postgresql://***");
    return NextResponse.json({ ok: false, database: "ERROR", error: message, env }, { status: 500, headers: UTF8 });
  }
}
