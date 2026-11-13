import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildToday } from "@/lib/today";
import { synthesize, ttsEnabled } from "@/lib/tts";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; script: string; audio: ArrayBuffer }>();

/** Resumen del día en audio (MP3). Se regenera como mucho cada 15 minutos. */
export async function GET() {
  const s = await currentUser();
  if (!s) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!ttsEnabled()) return NextResponse.json({ error: "Audio no configurado" }, { status: 501 });
  const { script } = await buildToday(s.agency);
  const hit = cache.get(s.agency.id);
  let audio = hit && hit.script === script && Date.now() - hit.at < 15 * 60000 ? hit.audio : undefined;
  if (!audio) {
    try {
      audio = await synthesize(script);
      cache.set(s.agency.id, { at: Date.now(), script, audio });
    } catch (err) {
      console.error("[ARM] Error generando el audio:", err);
      return NextResponse.json({ error: "No se pudo generar el audio" }, { status: 502 });
    }
  }
  return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=600" } });
}
