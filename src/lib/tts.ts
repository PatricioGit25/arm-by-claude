/** Texto a voz con ElevenLabs (resumen del día en audio). */
const API = "https://api.elevenlabs.io/v1";

export function ttsEnabled(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

let cachedVoice: string | undefined;
async function voiceId(key: string): Promise<string> {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (cachedVoice) return cachedVoice;
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": key } });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  const data = (await res.json()) as { voices?: { voice_id: string; category?: string; labels?: Record<string, string> }[] };
  // Las voces de la biblioteca requieren plan de pago; las "premade" y las propias, no.
  const voices = (data.voices ?? []).filter((v) => v.category !== "professional" && v.category !== "library");
  const own = voices.filter((v) => v.category === "premade" || v.category === "cloned" || v.category === "generated");
  const pool = own.length ? own : voices;
  const pick = pool.find((v) => /spanish|español|es\b/i.test(JSON.stringify(v.labels ?? {}))) ?? pool.find((v) => v.category === "premade") ?? pool[0];
  if (!pick) throw new Error("No hay voces disponibles en ElevenLabs");
  cachedVoice = pick.voice_id;
  return cachedVoice;
}

/** Devuelve el audio MP3 del texto. */
export async function synthesize(text: string): Promise<ArrayBuffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Falta ELEVENLABS_API_KEY");
  const res = await fetch(`${API}/text-to-speech/${await voiceId(key)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 2500), model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}
