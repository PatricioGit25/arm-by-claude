import { NextResponse, after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agencies, events, type Agency } from "@/lib/db/schema";
import { handleInbound, phoneKey } from "@/lib/engine";
import { downloadWhatsAppMedia, markWhatsAppRead, parseWhatsAppWebhook, validSignature, type WhatsAppInbound } from "@/lib/channels/whatsapp";
import { sttEnabled, transcribe } from "@/lib/stt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verificación del webhook (Meta envía hub.challenge).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = (process.env.WHATSAPP_VERIFY_TOKEN ?? "").trim();
  if (expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Firma no válida", { status: 401 });
  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { /* cuerpo vacío o no JSON */ }
  const inbound = parseWhatsAppWebhook(payload);
  // Respondemos a Meta enseguida y la IA trabaja después (si no, Meta reintenta).
  if (inbound.length) after(() => processAll(inbound));
  return NextResponse.json({ ok: true });
}

/** Números permitidos en modo prueba (vacío = responde a todos). */
function testAllows(agency: Agency, from: string): boolean {
  const list = (agency.waTestNumbers ?? "").split(/[,;\n]+/).map(phoneKey).filter(Boolean);
  return !list.length || list.includes(phoneKey(from));
}

async function processAll(inbound: WhatsAppInbound[]) {
  const db = await getDb();
  for (const m of inbound) {
    try {
      const agency = (await db.select().from(agencies).where(eq(agencies.waPhoneNumberId, m.phoneNumberId)))[0];
      if (!agency) { console.warn("[ARM] WhatsApp de un número sin agencia:", m.phoneNumberId); continue; }
      // Meta puede mandar el mismo mensaje dos veces: lo procesamos una sola.
      const seen = await db.select({ id: events.id }).from(events)
        .where(and(eq(events.agencyId, agency.id), eq(events.type, "wa_message"), sql`${events.data}->>'id' = ${m.id}`)).limit(1);
      if (seen.length) continue;
      await db.insert(events).values({ agencyId: agency.id, type: "wa_message", data: { id: m.id, kind: m.kind } });
      await markWhatsAppRead(m.phoneNumberId, m.id);

      let text = m.text;
      if (m.kind === "audio" && m.mediaId && sttEnabled()) {
        try {
          const said = await transcribe(await downloadWhatsAppMedia(m.mediaId), "nota.ogg");
          if (said) text = `🎤 ${said}`;
        } catch (err) {
          console.error("[ARM] No pude transcribir la nota de voz:", err);
        }
      }
      if (text === "[Nota de voz]") text = "[Nota de voz sin transcribir: pídele amablemente que lo escriba]";
      await handleInbound({
        agency, channel: "whatsapp", externalId: m.from, phone: `+${m.from}`, name: m.name, text, source: "WhatsApp",
        noAutoReply: !testAllows(agency, m.from),
      });
    } catch (err) {
      console.error("[ARM] Error procesando WhatsApp:", err);
    }
  }
}
