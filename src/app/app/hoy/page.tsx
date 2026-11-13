import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { buildToday, type TodayKind } from "@/lib/today";
import { ttsEnabled } from "@/lib/tts";

export const dynamic = "force-dynamic";

const ICON: Record<TodayKind, string> = { incident: "🚨", visit: "📅", hot: "🔥", confirm: "✅", send: "📤", match: "🏠", revive: "🔁", complete: "✏️" };

export default async function TodayPage() {
  const { agency, user } = await requireUser();
  const { items, script } = await buildToday(agency);
  const tel = (p?: string | null) => (p ? `tel:${p.replace(/[^\d+]/g, "")}` : undefined);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-3 lg:col-span-2">
        <div>
          <h1 className="text-2xl font-bold">Tu día, {user.name.split(" ")[0]}</h1>
          <p className="text-sm text-mute">Lo que necesita a una persona hoy, por orden. Del resto se encarga el asistente.</p>
        </div>
        {items.length === 0 && <div className="card text-sm text-mute">Nada pendiente por ahora. 🎉</div>}
        {items.map((i, n) => (
          <div key={n} className={`card flex items-start gap-3 !p-4 ${i.kind === "incident" ? "border-bad/40" : i.kind === "hot" ? "border-hot/40" : ""}`}>
            <span className="text-xl" aria-hidden>{ICON[i.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{i.time && <span className="mr-2 tabular-nums text-arm">{i.time}</span>}{i.title}</p>
              {i.detail && <p className="mt-0.5 line-clamp-2 text-sm text-mute">{i.detail}</p>}
            </div>
            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
              {i.phone && <a href={tel(i.phone)} className="btn-ghost !px-3 !py-1.5 text-xs">📞 Llamar</a>}
              <Link href={i.href} className="btn !px-3 !py-1.5 text-xs">Abrir</Link>
            </div>
          </div>
        ))}
      </section>
      <section className="card h-fit">
        <h2 className="font-semibold">🎧 Resumen del día</h2>
        {ttsEnabled() ? (
          <audio controls preload="none" src="/api/today/audio" className="mt-3 w-full" />
        ) : (
          <p className="mt-2 text-xs text-mute">Para escucharlo en audio, añade una clave de ElevenLabs (ELEVENLABS_API_KEY) en Vercel.</p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-mute">{script}</p>
      </section>
    </div>
  );
}
