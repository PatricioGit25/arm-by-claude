"use client";

import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const KEYBOARD_HINT = "Toca el cuadro de texto y usa el micrófono 🎤 del teclado de tu móvil para dictar.";

/**
 * Área de texto con dictado. Si el servidor tiene transcripción configurada,
 * graba audio real (funciona en cualquier navegador con micrófono); si no,
 * usa el dictado del navegador; y si tampoco, indica usar el del teclado.
 */
export function DictationTextarea({ name, placeholder, rows = 5, serverStt = false }: { name: string; placeholder?: string; rows?: number; serverStt?: boolean }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "listening" | "recording" | "transcribing">("idle");
  const [hint, setHint] = useState<string>();
  const rec = useRef<Recognition | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const base = useRef("");

  useEffect(() => () => {
    rec.current?.stop();
    media.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const append = (t: string) => setText((prev) => (prev ? `${prev.trimEnd()} ${t}` : t));

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", new Blob(chunks, { type: r.mimeType || "audio/webm" }));
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          const j = (await res.json()) as { text?: string; error?: string };
          if (j.text) append(j.text);
          else setHint(j.error ?? "No se entendió el audio. Prueba otra vez.");
        } catch {
          setHint("No se pudo enviar el audio. " + KEYBOARD_HINT);
        }
        setState("idle");
      };
      media.current = r;
      r.start();
      setHint(undefined);
      setState("recording");
    } catch {
      setHint("No se pudo usar el micrófono. Revisa los permisos del navegador, o: " + KEYBOARD_HINT);
    }
  }

  function startBrowserDictation() {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    const brave = !!(navigator as unknown as { brave?: unknown }).brave;
    if (!Ctor || brave) {
      setHint((brave ? "Brave bloquea el dictado. " : "Este navegador no permite dictar aquí. ") + KEYBOARD_HINT);
      return;
    }
    const r = new Ctor();
    r.lang = "es-ES";
    r.continuous = true;
    r.interimResults = true;
    base.current = text ? `${text.trimEnd()} ` : "";
    r.onresult = (e) => {
      let all = "";
      for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript;
      setText(base.current + all);
    };
    r.onerror = (e) => {
      setHint(e.error === "not-allowed" ? "Permite el micrófono para dictar." : "No se pudo dictar en este navegador. " + KEYBOARD_HINT);
      setState("idle");
    };
    r.onend = () => setState("idle");
    rec.current = r;
    setHint(undefined);
    try {
      r.start();
      setState("listening");
    } catch {
      setHint(KEYBOARD_HINT);
    }
  }

  function toggle() {
    if (state === "recording") return media.current?.stop();
    if (state === "listening") return rec.current?.stop();
    if (state !== "idle") return;
    if (serverStt && typeof MediaRecorder !== "undefined" && "mediaDevices" in navigator) startRecording();
    else startBrowserDictation();
  }

  const label = { idle: "🎤 Dictar", listening: "⏹ Parar dictado", recording: "⏹ Parar y transcribir", transcribing: "Transcribiendo…" }[state];

  return (
    <div className="space-y-2">
      <textarea name={name} rows={rows} className="input" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} required />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} disabled={state === "transcribing"} className={state === "idle" ? "btn-ghost" : "btn"}>{label}</button>
        {state === "recording" && <span className="text-xs text-arm">● Grabando… habla con normalidad</span>}
        {state === "listening" && <span className="text-xs text-arm">Escuchando…</span>}
      </div>
      {hint && <p className="rounded-lg bg-hot/10 px-3 py-2 text-xs text-hot">{hint}</p>}
      {!hint && <p className="text-xs text-mute">También puedes usar el micrófono 🎤 del teclado del móvil.</p>}
    </div>
  );
}
