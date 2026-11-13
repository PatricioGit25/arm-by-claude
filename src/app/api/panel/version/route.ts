import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { currentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * "Huella" de los datos del panel: cambia cuando entra un mensaje, un cliente,
 * un aviso o una visita. El panel la consulta cada pocos segundos y solo se
 * recarga cuando cambia.
 */
export async function GET() {
  const s = await currentUser();
  if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = await getDb();
  const id = s.agency.id;
  const r = await db.execute(sql`select
    (select coalesce(max(created_at), 'epoch') from messages where agency_id = ${id})::text as m,
    (select coalesce(max(updated_at), 'epoch') from leads where agency_id = ${id})::text as l,
    (select count(*) from notifications where agency_id = ${id})::text as n,
    (select count(*) from visits where agency_id = ${id})::text as v,
    (select count(*) from properties where agency_id = ${id})::text as p`);
  const row = (Array.isArray(r) ? r[0] : (r as { rows: unknown[] }).rows[0]) as Record<string, string>;
  const latest = (await db.select({ id: notifications.id, title: notifications.title }).from(notifications)
    .where(eq(notifications.agencyId, id)).orderBy(desc(notifications.createdAt)).limit(1))[0];
  return NextResponse.json(
    { v: [row.m, row.l, row.n, row.v, row.p].join("|"), latest: latest ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
