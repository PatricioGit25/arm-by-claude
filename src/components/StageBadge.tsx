import type { Stage } from "@/lib/db/schema";
import { STAGE_LABEL } from "@/lib/scoring";

const COLORS: Record<Stage, string> = {
  nuevo: "bg-white/10 text-white",
  calificando: "bg-sky-400/15 text-sky-300",
  seguimiento: "bg-violet-400/15 text-violet-300",
  listo: "bg-hot/15 text-hot",
  visita: "bg-arm/15 text-arm",
  oferta: "bg-orange-400/15 text-orange-300",
  cerrado: "bg-arm text-ink",
  perdido: "bg-red-500/10 text-red-300",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[stage]}`}>{STAGE_LABEL[stage]}</span>;
}

export function ScoreBar({ score, threshold = 70 }: { score: number; threshold?: number }) {
  const hot = score >= threshold;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
        <div className={`h-full ${hot ? "bg-hot" : "bg-arm"}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${hot ? "text-hot" : "text-mute"}`}>{score}</span>
    </div>
  );
}
