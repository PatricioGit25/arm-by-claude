import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agencies } from "@/lib/db/schema";
import { exportIcs } from "@/lib/calendar";

export const dynamic = "force-dynamic";

/** Calendario de visitas del ARM (para suscribirse desde Google Calendar o el iPhone). */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const agency = (await db.select().from(agencies).where(eq(agencies.calendarToken, token.replace(/\.ics$/, ""))))[0];
  if (!agency) return new Response("Not found", { status: 404 });
  return new Response(await exportIcs(agency), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" },
  });
}
