import { Fragment } from "react";

const URL_RE = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/g;

/** Convierte las URLs de un texto (y los enlaces [texto](url) en markdown) en enlaces que se pueden tocar. */
export function Linkify({ text, className = "underline underline-offset-2 break-all" }: { text: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[2] ?? m[3];
    let label = m[1];
    let tail = "";
    if (!m[2]) {
      // Quita la puntuación final que no forma parte del enlace: "…/casa-torrecilla)."
      const trimmed = url.match(/^(.*?)([).,;:!?¡¿»”']+)$/);
      if (trimmed) {
        url = trimmed[1];
        tail = trimmed[2];
      }
      label = prettyUrl(url);
    }
    if (start > last) out.push(<Fragment key={i++}>{text.slice(last, start)}</Fragment>);
    out.push(<a key={i++} href={url} target="_blank" rel="noopener noreferrer" className={className}>{label}</a>);
    if (tail) out.push(<Fragment key={i++}>{tail}</Fragment>);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}

/** Texto corto y legible para un enlace largo: "southcosta.lodgify.com/…/casa-torrecilla". */
function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return host;
    const lastPart = parts[parts.length - 1].replace(/---south-costa$|-south-costa$/, "");
    return `${host}/${parts.length > 1 ? "…/" : ""}${lastPart.length > 40 ? lastPart.slice(0, 40) + "…" : lastPart}`;
  } catch {
    return url;
  }
}
