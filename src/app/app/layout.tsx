import Link from "next/link";
import { Logo } from "@/components/Logo";
import { requireUser } from "@/lib/auth";
import { hasClaude } from "@/lib/agent/claude";
import { logoutAction } from "../actions";

const NAV = [
  { href: "/app/hoy", label: "Tu día" },
  { href: "/app", label: "Resumen" },
  { href: "/app/leads", label: "Leads" },
  { href: "/app/nuevo", label: "+ Nuevo cliente" },
  { href: "/app/conectar", label: "Conectar Idealista" },
  { href: "/app/properties", label: "Propiedades" },
  { href: "/app/settings", label: "Ajustes" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, agency } = await requireUser();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
        <div className="flex items-center gap-4">
          <Link href="/app"><Logo className="text-xl" /></Link>
          <span className="hidden text-sm text-mute sm:inline">{agency.name}</span>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-mute hover:bg-panel2 hover:text-white">{n.label}</Link>
          ))}
          <form action={logoutAction}><button className="rounded-lg px-3 py-1.5 text-mute hover:text-white" title={user.email}>Salir</button></form>
        </nav>
      </header>
      {!hasClaude() && (
        <div className="mt-4 rounded-xl border border-hot/30 bg-hot/10 px-4 py-2 text-sm text-hot">
          Modo demo: el agente funciona con reglas. Añade <code>ANTHROPIC_API_KEY</code> para activar a Claude.
        </div>
      )}
      <main className="pt-6">{children}</main>
    </div>
  );
}
