import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { latestNotifications, morningSummary } from "@/lib/engine";

export const dynamic = "force-dynamic";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default async function Dashboard() {
  const { agency, user } = await requireUser();
  const s = await morningSummary(agency.id);
  const notes = await latestNotifications(agency.id);
  const max = Math.max(1, s.funnel[0].count);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="card lg:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-arm">● Tu resumen de la mañana</p>
        <h1 className="mt-1 text-3xl font-black">{DAYS[new Date().getDay()]}</h1>
        <p className="text-sm text-mute">Hola {user.name.split(" ")[0]}, esto es lo que hizo tu ARM mientras no mirabas.</p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {s.vacation ? (
            <>
              <Stat label="Consultas nuevas (24 h)" value={s.entered24} />
              <Stat label="Quieren reservar" value={s.ready} hot />
              <Stat label="Incidencias abiertas" value={s.incidents} alert={s.incidents > 0} />
              <Stat label="Mensajes de la IA (24 h)" value={s.aiMessages24} />
            </>
          ) : (
            <>
              <Stat label="Clientes que entraron (24 h)" value={s.entered24} />
              <Stat label="Listos para comprar" value={s.ready} hot />
              <Stat label="En calificación / seguimiento" value={s.following} />
              <Stat label="Mensajes de la IA (24 h)" value={s.aiMessages24} />
            </>
          )}
        </div>
        {s.afterHours > 0 && (
          <p className="mt-3 text-sm text-mute">🌙 {s.afterHours} cliente(s) escribieron fuera de horario y recibieron respuesta al instante.</p>
        )}

        <h2 className="mt-8 mb-3 text-sm font-semibold">Embudo de los últimos 30 días</h2>
        <div className="space-y-2">
          {s.funnel.map((f) => (
            <div key={f.label} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 text-mute">{f.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-arm" style={{ width: `${(f.count / max) * 100}%` }} />
              </div>
              <span className="w-8 text-right tabular-nums">{f.count}</span>
            </div>
          ))}
        </div>
        {s.worst.lost > 0 && (
          <div className="mt-4 rounded-xl border border-hot/30 bg-hot/10 p-3 text-sm">
            <b className="text-hot">Dónde se están cayendo:</b> entre <b>{s.worst.from}</b> y <b>{s.worst.to}</b> se pierde el{" "}
            {Math.round(s.worst.pct * 100)}% ({s.worst.lost} leads).
          </div>
        )}
      </section>

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Avisos</h2>
          <Link href="/app/leads" className="text-xs text-arm">Ver leads →</Link>
        </div>
        {notes.length === 0 && <p className="text-sm text-mute">Sin avisos todavía. Prueba el <Link className="text-arm" href={`/chat/${agency.slug}`}>chat del comprador</Link>.</p>}
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl bg-panel2 p-3">
              <Link href={n.leadId ? `/app/leads/${n.leadId}` : "/app/leads"} className="block">
                <p className="text-sm font-semibold">{n.title}</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-mute">{n.body}</p>
                <p className="mt-1 text-[10px] text-mute">{n.createdAt.toLocaleString("es-ES")}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, hot, alert }: { label: string; value: number; hot?: boolean; alert?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${alert ? "bg-bad/10" : "bg-panel2"}`}>
      <p className={`text-3xl font-black tabular-nums ${alert ? "text-bad" : hot ? "text-hot" : ""}`}>{value}</p>
      <p className="mt-1 text-xs text-mute">{label}</p>
    </div>
  );
}
