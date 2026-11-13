import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { formatPrice, stageLabel, stagesFor } from "@/lib/scoring";
import { LANG_FLAG } from "@/lib/i18n";
import { ScoreBar } from "@/components/StageBadge";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { agency } = await requireUser();
  const db = await getDb();
  const all = await db.select().from(leads).where(eq(leads.agencyId, agency.id)).orderBy(desc(leads.score), desc(leads.updatedAt));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-sm text-mute">Todo se actualiza solo. La IA mueve las conversaciones; tú solo intervienes cuando hace falta.</p>
        </div>
        <Link href={`/chat/${agency.slug}`} target="_blank" className="btn-ghost">Abrir chat de comprador ↗</Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stagesFor(agency.vertical).map((stage) => {
          const col = all.filter((l) => l.stage === stage);
          return (
            <div key={stage} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-mute">
                <span className={stage === "listo" ? "text-hot" : stage === "incidencia" ? "text-bad" : ""}>{stageLabel(stage, agency.vertical)}</span>
                <span>{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((l) => (
                  <Link key={l.id} href={`/app/leads/${l.id}`} className={`block rounded-xl border bg-panel p-3 transition hover:border-arm ${stage === "listo" ? "border-hot/40" : stage === "incidencia" ? "border-bad/40" : "border-line"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{LANG_FLAG[l.language]} {l.name ?? "Sin nombre"}</p>
                      <ScoreBar score={l.score} threshold={agency.handoffThreshold} />
                    </div>
                    <p className="mt-1 truncate text-xs text-mute">
                      {(agency.vertical === "vacacional"
                        ? [l.profile.check_in && `${l.profile.check_in}${l.profile.check_out ? ` → ${l.profile.check_out}` : ""}`, l.profile.guests && `${l.profile.guests} pers.`, l.profile.pets && "mascota"]
                        : [l.profile.property_type, l.profile.bedrooms_min && `${l.profile.bedrooms_min} dorm`, l.profile.budget_max && `≤ ${formatPrice(l.profile.budget_max)}`]
                      ).filter(Boolean).join(" · ") || (l.summary ? l.summary.slice(0, 60) : "Perfil por completar")}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-mute">{l.source ?? l.channel}{l.aiPaused ? " · humano" : ""}</p>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
