import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { agencies } from "@/lib/db/schema";
import { morningSummary, notify } from "@/lib/engine";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";

/** Resumen de la mañana para cada inmobiliaria. Llamar una vez al día (p. ej. 8:00). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const all = await db.select().from(agencies);
  for (const agency of all) {
    const s = await morningSummary(agency.id);
    const drop = s.worst.lost ? `\n⚠️ Se caen entre "${s.worst.from}" y "${s.worst.to}" (${Math.round(s.worst.pct * 100)}%).` : "";
    await notify(agency, null, "summary", "☀️ Tu resumen de la mañana",
      `Clientes que entraron: ${s.entered24}\nListos para comprar: ${s.ready} (${s.readyNew} nuevos)\nEn seguimiento: ${s.following}${drop}`);
  }
  return NextResponse.json({ agencies: all.length });
}
