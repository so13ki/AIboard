import {
  DECISION_LABELS,
  STANCE_LABELS,
  type DecisionResult,
  type Stance,
} from "@/lib/meeting/constants";

const stanceColors: Record<Stance, string> = {
  approve: "bg-emerald-100 text-emerald-900 border-emerald-300",
  conditional: "bg-amber-100 text-amber-900 border-amber-300",
  reject: "bg-rose-100 text-rose-900 border-rose-300",
  hold: "bg-slate-100 text-slate-800 border-slate-300",
};

const decisionColors: Record<DecisionResult, string> = {
  approved: "bg-emerald-100 text-emerald-900 border-emerald-300",
  conditional: "bg-amber-100 text-amber-900 border-amber-300",
  reconsider: "bg-sky-100 text-sky-900 border-sky-300",
  rejected: "bg-rose-100 text-rose-900 border-rose-300",
};

export function StanceBadge({ stance }: { stance?: string | null }) {
  if (!stance || !(stance in STANCE_LABELS)) {
    return null;
  }
  const key = stance as Stance;
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${stanceColors[key]}`}
    >
      {STANCE_LABELS[key]}
    </span>
  );
}

export function DecisionBadge({ result }: { result?: string | null }) {
  if (!result || !(result in DECISION_LABELS)) {
    return null;
  }
  const key = result as DecisionResult;
  return (
    <span
      className={`inline-flex rounded border px-2.5 py-1 text-sm font-semibold ${decisionColors[key]}`}
    >
      {DECISION_LABELS[key]}
    </span>
  );
}
