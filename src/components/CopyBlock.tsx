"use client";

import { useRef, useState } from "react";

/** Bloque de código con botón "Copiar". */
export function CopyBlock({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch {
      const sel = window.getSelection();
      const range = document.createRange();
      if (pre.current && sel) {
        range.selectNodeContents(pre.current);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }
  return (
    <div className="space-y-2">
      <button type="button" onClick={copy} className="btn">{done ? "✓ Copiado" : label}</button>
      <pre ref={pre} className="max-h-72 overflow-auto rounded-xl bg-ink p-3 text-xs leading-relaxed text-arm">{text}</pre>
    </div>
  );
}
