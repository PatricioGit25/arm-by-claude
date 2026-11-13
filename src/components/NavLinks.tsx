"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/app/hoy", label: "Tu día" },
  { href: "/app", label: "Resumen", exact: true },
  { href: "/app/leads", label: "Clientes" },
  { href: "/app/properties", label: "Propiedades" },
  { href: "/app/conectar", label: "Conectar" },
  { href: "/app/settings", label: "Ajustes" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1 text-sm [scrollbar-width:none]" aria-label="Secciones">
      {NAV.map((n) => {
        const active = n.exact ? path === n.href : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 transition ${active ? "bg-fg text-ink" : "text-mute hover:bg-panel2 hover:text-fg"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
