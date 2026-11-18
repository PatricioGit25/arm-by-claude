/** Speech-to-Text con ElevenLabs (dictado del panel y audios de WhatsApp). */
export function sttEnabled(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

export async function transcribe(audio: Blob, filename = "audio.webm"): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Transcripción no configurada");
  const out = new FormData();
  out.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  out.append("file", audio, filename);
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: out });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
