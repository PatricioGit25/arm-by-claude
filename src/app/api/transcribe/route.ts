import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Convierte un audio grabado en el panel en texto (ElevenLabs Speech-to-Text). */
export async function POST(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "Transcripción no configurada" }, { status: 501 });

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "No llegó el audio" }, { status: 400 });
  if (audio.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Audio demasiado largo" }, { status: 413 });

  const out = new FormData();
  out.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  out.append("file", audio, "nota.webm");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: out });
  if (!res.ok) {
    console.error("[ARM] Error de transcripción:", res.status, await res.text());
    return NextResponse.json({ error: "No se pudo transcribir el audio" }, { status: 502 });
  }
  const data = (await res.json()) as { text?: string };
  return NextResponse.json({ text: (data.text ?? "").trim() });
}
