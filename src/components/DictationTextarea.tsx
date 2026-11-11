"use client";

import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

/** Área de texto con botón para dictar por voz (Web Speech API del navegador). */
export function DictationTextarea({ name, placeholder, rows = 5 }: { name: string; placeholder?: string; rows?: number }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string>();
  const rec = useRef<Recognition | null>(null);
  const base = useRef("");

  useEffect(() => () => rec.current?.stop(), []);

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setHint("Tu navegador no permite dictar aquí. Usa el micrófono del teclado del móvil.");
      return;
    }
    const r = new Ctor();
    r.lang = "es-ES";
    r.continuous = true;
    r.interimResults = true;
    base.current = text ? `${text.trimEnd()} ` : "";
    r.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setText(base.current + finalText + interim);
    };
    r.onerror = (e) => {
      setHint(e.error === "not-allowed" ? "Permite el micrófono para dictar." : "No se pudo dictar en este navegador. Usa el micrófono del teclado del móvil.");
      setListening(false);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setHint(undefined);
    r.start();
    setListening(true);
  }

  return (
    <div className="space-y-2">
      <textarea name={name} rows={rows} className="input" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} required />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} className={listening ? "btn" : "btn-ghost"}>
          {listening ? "⏹ Parar dictado" : "🎤 Dictar"}
        </button>
        {listening && <span className="text-xs text-arm">Escuchando… habla con normalidad</span>}
        {hint && <span className="text-xs text-hot">{hint}</span>}
      </div>
    </div>
  );
}
