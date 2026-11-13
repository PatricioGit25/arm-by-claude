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
    <div className="fixed inset-0 flex justify-center bg-[#0b141a]">
      <div className="flex h-full w-full max-w-md flex-col">
        <header className="flex shrink-0 items-center gap-3 bg-[#202c33] px-4 py-3" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-arm font-black text-ink">{assistant[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{agencyName}</p>
            <p className="text-xs text-arm">{typing ? "escribiendo…" : `${assistant} · en línea 24/7`}</p>
          </div>
          <button onClick={reset} className="text-xs text-mute hover:text-white" title="Empezar como otro cliente">Nuevo</button>
        </header>
        <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4">
          {msgs.length === 0 && (
            <div className="mx-auto mt-10 max-w-xs rounded-xl bg-[#182229] p-4 text-center text-sm text-mute">
              👋 ¡Hola! Escríbenos en tu idioma.<br />Hi! · Hej! · Hallo! · Bonjour !
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "in" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-line break-words rounded-xl px-3 py-2 text-[15px] leading-snug ${m.direction === "in" ? "bg-[#005c4b]" : "bg-[#202c33]"}`}>
                <Linkify text={m.body} className="text-[#53bdeb] underline underline-offset-2 break-all" />
                <span className="ml-2 align-bottom text-[10px] text-white/50">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          ))}
          {typing && <div className="w-14 rounded-xl bg-[#202c33] px-3 py-2 text-center tracking-widest text-mute">···</div>}
        </div>
        <form onSubmit={send} className="flex shrink-0 gap-2 bg-[#202c33] p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          {/* 16px: con menos, el iPhone hace zoom al tocar el campo */}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe tu mensaje… / Type your message…"
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-full bg-[#2a3942] px-4 py-2 text-base outline-none"
          />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-arm font-bold text-ink" aria-label="Enviar">➤</button>
        </form>
      </div>
    </div>
  );
}
