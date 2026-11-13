"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const INTERVAL = 5000;

/** Mantiene el panel al día sin recargar a mano: se actualiza solo cuando hay datos nuevos. */
export function AutoRefresh() {
  const router = useRouter();
  const version = useRef<string | null>(null);
  const lastNotice = useRef<string | null>(null);
  const pending = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const baseTitle = document.title;

    // No recargar mientras alguien escribe en un formulario del panel.
    const busy = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el.matches("input, textarea, select, [contenteditable=true]")) return true;
      return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("main input:not([type=hidden]), main textarea")]
        .some((f) => f.value !== f.defaultValue && f.type !== "checkbox");
    };

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/panel/version", { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as { v: string; latest: { id: string; title: string } | null };
            if (version.current === null) {
              version.current = j.v;
              lastNotice.current = j.latest?.id ?? null;
            } else if (j.v !== version.current) {
              version.current = j.v;
              if (j.latest && j.latest.id !== lastNotice.current) {
                lastNotice.current = j.latest.id;
                setToast(j.latest.title);
                document.title = `🔔 ${baseTitle}`;
                setTimeout(() => setToast(null), 6000);
              }
              pending.current = true;
            }
            if (pending.current && !busy()) {
              pending.current = false;
              router.refresh();
            }
          }
        } catch {
          /* sin conexión: se reintenta */
        }
      }
      timer = setTimeout(tick, INTERVAL);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") document.title = baseTitle;
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  if (!toast) return null;
  return (
    <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-arm/40 bg-panel px-4 py-3 text-sm shadow-lg" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
      <p className="text-xs font-semibold uppercase tracking-wide text-arm">Nuevo</p>
      <p className="mt-0.5">{toast}</p>
    </div>
  );
}
