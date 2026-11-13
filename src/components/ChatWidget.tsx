"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Linkify } from "./Linkify";

type Msg = { id: string; direction: "in" | "out"; author: string; body: string; createdAt: string };

function visitorId(slug: string): string {
  const key = `arm_visitor_${slug}`;
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function ChatWidget({ slug, agencyName, assistant }: { slug: string; agencyName: string; assistant: string }) {
  const [vid, setVid] = useState<string>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const lastKey = useRef("");

  useEffect(() => {
    setVid(visitorId(slug));
  }, [slug]);

  const load = useCallback(async () => {
    if (!vid) return;
    try {
      const r = await fetch(`/api/chat/${slug}?visitor=${vid}`, { cache: "no-store" });
      if (!r.ok) return;
      const next = (await r.json()).messages as Msg[];
      // Solo actualiza si hay algo nuevo, para que la pantalla no se mueva sola.
      const key = `${next.length}:${next[next.length - 1]?.id ?? ""}`;
      if (key !== lastKey.current) {
        lastKey.current = key;
        setMsgs(next);
      }
    } catch {
      /* sin conexión: se reintenta en el siguiente ciclo */
    }
  }, [slug, vid]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  // Baja al último mensaje solo dentro de la lista (nunca mueve la página entera).
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, typing]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !vid || typing) return;
    setText("");
    setMsgs((m) => [...m, { id: `tmp-${Date.now()}`, direction: "in", author: "lead", body, createdAt: new Date().toISOString() }]);
    setTyping(true);
    try {
      await fetch(`/api/chat/${slug}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitor: vid, text: body }) });
      lastKey.current = "";
      await load();
    } finally {
      setTyping(false);
    }
  }

  function reset() {
    try { localStorage.removeItem(`arm_visitor_${slug}`); } catch {}
    lastKey.current = "";
    setMsgs([]);
    setVid(visitorId(slug));
  }

  return (
    <div className="fixed inset-0 flex justify-center bg-ink">
      <div className="flex h-full w-full max-w-lg flex-col sm:my-6 sm:h-[calc(100%-3rem)] sm:overflow-hidden sm:rounded-3xl sm:border sm:border-line sm:shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel/85 px-4 py-3 backdrop-blur-xl" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="relative">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-arm to-arm2 text-sm font-semibold text-white">{assistant[0]}</div>
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-good" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">{agencyName}</p>
            <p className="text-xs text-mute">{typing ? "escribiendo…" : `${assistant} · responde al momento`}</p>
          </div>
          <button onClick={reset} className="rounded-full px-3 py-1 text-xs text-mute transition hover:bg-panel2 hover:text-fg" title="Empezar como otro cliente">Nuevo</button>
        </header>
        <div ref={list} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-4">
          {msgs.length === 0 && (
            <div className="mx-auto mt-12 max-w-xs text-center">
              <p className="text-2xl">👋</p>
              <p className="mt-2 text-[15px] font-medium">¿En qué podemos ayudarte?</p>
              <p className="mt-1 text-sm text-mute">Escríbenos en tu idioma.<br />Hi! · Hej! · Hallo! · Bonjour !</p>
            </div>
          )}
          {msgs.map((m) => {
            const mine = m.direction === "in";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] whitespace-pre-line break-words rounded-[20px] px-3.5 py-2 text-[15px] leading-snug ${mine ? "rounded-br-md" : "rounded-bl-md border border-line"}`}
                  style={{ background: mine ? "var(--bubble-me)" : "var(--bubble-them)", color: mine ? "var(--bubble-me-fg)" : "var(--fg)" }}
                >
                  <Linkify text={m.body} className={`underline underline-offset-2 break-all ${mine ? "" : "text-arm"}`} />
                  <span className={`ml-2 align-bottom text-[10px] ${mine ? "text-white/70" : "text-mute"}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            );
          })}
          {typing && (
            <div className="flex w-16 items-center justify-center gap-1 rounded-[20px] rounded-bl-md border border-line px-3 py-3" style={{ background: "var(--bubble-them)" }} aria-label="escribiendo">
              {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-mute" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>
          )}
        </div>
        <form onSubmit={send} className="flex shrink-0 items-center gap-2 border-t border-line bg-panel/85 p-2.5 backdrop-blur-xl" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
          {/* 16px: con menos, el iPhone hace zoom al tocar el campo */}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe un mensaje…"
            enterKeyHint="send"
            aria-label="Mensaje"
            className="min-w-0 flex-1 rounded-full border border-line bg-panel2 px-4 py-2.5 text-base text-fg outline-none placeholder:text-mute focus:border-arm"
          />
          <button
            disabled={!text.trim() || typing}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-arm text-white transition hover:bg-arm2 disabled:opacity-40"
            aria-label="Enviar"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </form>
        <p className="shrink-0 bg-panel/85 pb-1.5 text-center text-[10px] text-mute sm:pb-2">Asistente con IA · ARM by VistaAlta</p>
      </div>
    </div>
  );
}
