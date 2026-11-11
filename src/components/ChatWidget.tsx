"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { id: string; direction: "in" | "out"; author: string; body: string; createdAt: string };

const HELLO = {
  es: "Escribe tu consulta… (también en inglés o sueco)",
  en: "Type your question…",
  sv: "Skriv din fråga…",
};

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
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVid(visitorId(slug));
  }, [slug]);

  const load = useCallback(async () => {
    if (!vid) return;
    const r = await fetch(`/api/chat/${slug}?visitor=${vid}`, { cache: "no-store" });
    if (r.ok) setMsgs((await r.json()).messages);
  }, [slug, vid]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, typing]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !vid || typing) return;
    setText("");
    setMsgs((m) => [...m, { id: `tmp-${Date.now()}`, direction: "in", author: "lead", body, createdAt: new Date().toISOString() }]);
    setTyping(true);
    try {
      await fetch(`/api/chat/${slug}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitor: vid, text: body }) });
      await load();
    } finally {
      setTyping(false);
    }
  }

  function reset() {
    try { localStorage.removeItem(`arm_visitor_${slug}`); } catch {}
    setMsgs([]);
    setVid(visitorId(slug));
  }

  return (
    <div className="mx-auto flex h-[100dvh] max-w-md flex-col bg-[#0b141a]">
      <header className="flex items-center gap-3 bg-[#202c33] px-4 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-arm font-black text-ink">{assistant[0]}</div>
        <div className="flex-1">
          <p className="font-semibold">{agencyName}</p>
          <p className="text-xs text-arm">{typing ? "escribiendo…" : `${assistant} · en línea 24/7`}</p>
        </div>
        <button onClick={reset} className="text-xs text-mute hover:text-white" title="Empezar como otro comprador">Nuevo</button>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {msgs.length === 0 && (
          <div className="mx-auto mt-10 max-w-xs rounded-xl bg-[#182229] p-4 text-center text-sm text-mute">
            👋 ¡Hola! Escríbenos en tu idioma.<br />Hi! · Hej! · Hallo! · Bonjour !
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "in" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-[15px] leading-snug ${m.direction === "in" ? "bg-[#005c4b]" : "bg-[#202c33]"}`}>
              {m.body}
              <span className="ml-2 align-bottom text-[10px] text-white/50">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
        ))}
        {typing && <div className="w-14 rounded-xl bg-[#202c33] px-3 py-2 text-center tracking-widest text-mute">···</div>}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex gap-2 bg-[#202c33] p-3">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu mensaje… / Type your message…" className="flex-1 rounded-full bg-[#2a3942] px-4 py-2 text-[15px] outline-none" />
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-arm font-bold text-ink" aria-label="Enviar">➤</button>
      </form>
    </div>
  );
}
