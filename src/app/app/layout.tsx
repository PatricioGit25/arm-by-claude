import Link from "next/link";
import { Logo } from "@/components/Logo";
import { AutoRefresh } from "@/components/AutoRefresh";
import { NavLinks } from "@/components/NavLinks";
import { requireUser } from "@/lib/auth";
import { hasClaude } from "@/lib/agent/claude";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, agency } = await requireUser();
  const initials = user.name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "·";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/80 backdrop-blur-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/app/hoy" className="shrink-0"><Logo className="text-[17px]" withBy={false} /></Link>
          <span className="hidden shrink-0 text-line sm:inline">/</span>
          <span className="hidden max-w-40 shrink-0 truncate text-sm font-medium sm:inline">{agency.name}</span>
          <div className="mx-2 hidden min-w-0 flex-1 md:block"><NavLinks /></div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link href="/app/nuevo" className="btn !px-3.5 !py-1.5">+ Nuevo cliente</Link>
            <form action={logoutAction}>
              <button title={`${user.email} · Cerrar sesión`} className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs text-mute ring-1 ring-line transition hover:text-fg">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-panel2 font-semibold">{initials}</span>
                Salir
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-3 pb-2 md:hidden"><NavLinks /></div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        {!hasClaude() && (
          <div className="mt-4 rounded-xl border border-hot/25 bg-hot/10 px-4 py-2 text-sm text-hot">
            Modo demo: el asistente funciona con reglas. Añade <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> para activar la IA.
          </div>
        )}
        <main className="pt-6 sm:pt-8">{children}</main>
      </div>
      <AutoRefresh />
    </div>
  );
}
