import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { transcribe } from "@/lib/stt";

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

  try {
    return NextResponse.json({ text: await transcribe(audio, "nota.webm") });
  } catch (err) {
    console.error("[ARM] Error de transcripción:", err);
    return NextResponse.json({ error: "No se pudo transcribir el audio" }, { status: 502 });
  }
}
