import type { Stage, Vertical } from "@/lib/db/schema";
import { stageLabel } from "@/lib/scoring";

const COLORS: Record<Stage, string> = {
  nuevo: "bg-panel2 text-fg ring-line",
  calificando: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  seguimiento: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  listo: "bg-hot/10 text-hot ring-hot/25",
  visita: "bg-arm/10 text-arm ring-arm/25",
  oferta: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
  cerrado: "bg-good/10 text-good ring-good/25",
  perdido: "bg-panel2 text-mute ring-line",
  reservado: "bg-good/10 text-good ring-good/25",
  huesped: "bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300",
  incidencia: "bg-bad/10 text-bad ring-bad/25",
};

export function StageBadge({ stage, vertical = "venta" }: { stage: Stage; vertical?: Vertical }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${COLORS[stage]}`}>{stageLabel(stage, vertical)}</span>;
}

export function ScoreBar({ score, threshold = 70 }: { score: number; threshold?: number }) {
  const hot = score >= threshold;
  return (
    <div className="flex items-center gap-2" title={`Intención ${score}/100`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-panel2 ring-1 ring-inset ring-line">
        <div className={`h-full rounded-full ${hot ? "bg-hot" : "bg-arm"}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`tabular text-xs ${hot ? "font-semibold text-hot" : "text-mute"}`}>{score}</span>
    </div>
  );
}
