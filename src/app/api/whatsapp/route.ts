import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agencies } from "@/lib/db/schema";
import { handleInbound } from "@/lib/engine";
import { parseWhatsAppWebhook } from "@/lib/channels/whatsapp";

export const dynamic = "force-dynamic";

// Verificación del webhook (Meta envía hub.challenge).
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  const db = await getDb();
  for (const m of parseWhatsAppWebhook(payload)) {
    const agency = (await db.select().from(agencies).where(eq(agencies.waPhoneNumberId, m.phoneNumberId)))[0];
    if (!agency) continue;
    try {
      await handleInbound({ agency, channel: "whatsapp", externalId: m.from, phone: `+${m.from}`, name: m.name, text: m.text, source: "WhatsApp" });
    } catch (err) {
      console.error("[ARM] Error procesando WhatsApp:", err);
    }
  }
  return NextResponse.json({ ok: true });
}
