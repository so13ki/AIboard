import { StanceBadge } from "@/components/StanceBadge";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

const TURN_LABELS: Record<string, string> = {
  claim: "主張",
  rebuttal: "反論",
  re_rebuttal: "再反論",
};

const CUT_REASON_LABELS: Record<string, string> = {
  over_quality: "過剰品質",
  complicates: "複雑化",
  mvp_unnecessary: "MVPでは不要",
  future_ok: "将来対応で良い",
};

function VoteChangeLine({ turn }: { turn: Record<string, unknown> }) {
  const previousVote = String(turn.previousVote ?? turn.previousDecision ?? "-");
  const currentVote = String(turn.currentVote ?? turn.currentDecision ?? "-");
  const voteChanged = Boolean(turn.voteChanged);
  const conditionChanged = Boolean(turn.conditionChanged);
  const previousCondition = String(turn.previousCondition ?? "");
  const currentCondition = String(
    turn.currentCondition ?? turn.changedCondition ?? "",
  );

  let label = "採決・条件とも変更なし";
  if (voteChanged && conditionChanged) label = "採決変更あり・条件変更あり";
  else if (voteChanged) label = "採決変更あり・条件変更なし";
  else if (conditionChanged) label = "採決変更なし・条件変更あり";

  return (
    <div className="mt-2 rounded border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700">
      <div className="font-medium">{label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span>票:</span>
        <StanceBadge stance={previousVote} />
        <span>→</span>
        <StanceBadge stance={currentVote} />
      </div>
      {(previousCondition || currentCondition) && (
        <p className="mt-1 whitespace-pre-wrap">
          条件: {previousCondition || "（なし）"} → {currentCondition || "（なし）"}
        </p>
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: Record<string, unknown> }) {
  const options = Array.isArray(issue.options) ? issue.options : [];
  const participants = Array.isArray(issue.participants) ? issue.participants : [];
  const turns = Array.isArray(issue.turns) ? issue.turns : [];
  const summary = asRecord(issue.chairSummary);
  const balancer = asRecord(issue.qualityBalancer);

  return (
    <article className="rounded border border-stone-800 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            論点カード
          </div>
          <h4 className="mt-1 text-base font-semibold text-stone-900">
            {String(issue.title ?? "")}
          </h4>
        </div>
        <div className="text-xs text-stone-600">
          {participants
            .map((p) => asRecord(p).title)
            .filter(Boolean)
            .join(" × ")}
        </div>
      </div>

      {typeof issue.conflictSummary === "string" ? (
        <p className="mt-2 text-sm text-stone-700">{issue.conflictSummary}</p>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((opt, index) => {
          const row = asRecord(opt);
          return (
            <div
              key={`${String(row.key ?? index)}-${String(row.label ?? "")}`}
              className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
            >
              <span className="font-semibold text-stone-800">
                選択肢{String(row.key ?? ["A", "B", "C"][index])}
              </span>
              <p className="mt-1 text-stone-700">{String(row.label ?? "")}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-xs font-semibold text-stone-500">討論（最大2往復）</div>
        {turns.map((turn, index) => {
          const row = asRecord(turn);
          return (
            <div
              key={`${String(row.speakerTitle)}-${index}`}
              className="rounded border border-stone-200 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <span className="font-semibold text-stone-800">
                  {String(row.speakerTitle ?? "")}
                </span>
                <span>
                  {TURN_LABELS[String(row.turnType)] ?? String(row.turnType)}
                </span>
                {typeof row.preferredOptionKey === "string" ? (
                  <span>希望: 選択肢{row.preferredOptionKey}</span>
                ) : null}
              </div>
              {typeof row.claim === "string" ? (
                <p className="mt-1 text-sm text-stone-800">主張: {row.claim}</p>
              ) : null}
              {typeof row.counterToOpponent === "string" &&
              row.counterToOpponent.trim() ? (
                <p className="mt-1 text-sm text-stone-800">
                  反論: {row.counterToOpponent}
                </p>
              ) : null}
              {typeof row.alternative === "string" ? (
                <p className="mt-1 text-sm text-stone-700">
                  代替案: {row.alternative}
                </p>
              ) : null}
              {typeof row.judgmentCondition === "string" ? (
                <p className="mt-1 text-sm text-stone-700">
                  判断条件: {row.judgmentCondition}
                </p>
              ) : null}
              <VoteChangeLine turn={row} />
            </div>
          );
        })}
      </div>

      {summary.conflictPoint ? (
        <div className="mt-4 space-y-2 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            議長整理
          </div>
          <p>
            <span className="font-medium">対立点:</span>{" "}
            {String(summary.conflictPoint)}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <div className="font-medium">選択肢A: {String(summary.optionA)}</div>
              <p className="mt-1 text-xs">利点: {asStringList(summary.optionAPros).join(" / ")}</p>
              <p className="text-xs">欠点: {asStringList(summary.optionACons).join(" / ")}</p>
            </div>
            <div>
              <div className="font-medium">選択肢B: {String(summary.optionB)}</div>
              <p className="mt-1 text-xs">利点: {asStringList(summary.optionBPros).join(" / ")}</p>
              <p className="text-xs">欠点: {asStringList(summary.optionBCons).join(" / ")}</p>
            </div>
          </div>
          <p>
            <span className="font-medium">推奨案:</span>{" "}
            {String(summary.recommendation)}
          </p>
          <p>
            <span className="font-medium">企画者が決めるべきこと:</span>{" "}
            {String(summary.proposerMustDecide)}
          </p>
        </div>
      ) : null}

      {balancer.simplyNote ? (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Quality Balancer
          </div>
          <p className="mt-1">残す: {asStringList(balancer.keptChoices).join(" / ")}</p>
          {Array.isArray(balancer.cutItems) && balancer.cutItems.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {balancer.cutItems.map((item, index) => {
                const row = asRecord(item);
                return (
                  <li key={`${String(row.item)}-${index}`}>
                    削る: {String(row.item)}（
                    {CUT_REASON_LABELS[String(row.reason)] ?? String(row.reason)}）
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="mt-1">{String(balancer.simplyNote)}</p>
        </div>
      ) : null}
    </article>
  );
}

export function IssueCards({ summary }: { summary: unknown }) {
  const data = asRecord(summary);
  if (data.format !== "issue_cards" || !Array.isArray(data.issues)) {
    return null;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        相互レビューは論点カード（最大3件）です。全役員の再要約ではありません。
      </p>
      {data.issues.slice(0, 3).map((issue, index) => (
        <IssueCard
          key={String(asRecord(issue).id ?? index)}
          issue={asRecord(issue)}
        />
      ))}
    </div>
  );
}
