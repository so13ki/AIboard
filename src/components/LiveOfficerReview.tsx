"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  startTransition,
} from "react";
import { StatementCard } from "@/components/StatementCard";
import { StanceBadge } from "@/components/StanceBadge";
import { pickThinkingLine, thinkingTitle } from "@/lib/meeting/thinking-messages";
import { MEETING_STEP } from "@/lib/meeting/constants";

const ROLE_ACCENT: Record<string, string> = {
  cfo: "border-l-emerald-600",
  marketing: "border-l-sky-600",
  operations: "border-l-amber-600",
  cto: "border-l-indigo-600",
  customer: "border-l-rose-600",
  redteam: "border-l-red-700",
  quality_balancer: "border-l-teal-600",
};

type OfficerStatus =
  | "pending"
  | "generating"
  | "completed"
  | "failed"
  | "timed_out";

type OfficerCard = {
  id: string;
  title: string;
  roleKey: string;
  status: OfficerStatus;
  thinkingLine: string;
  stance?: string | null;
  content?: unknown;
  error?: string;
  arrivalOrder?: number;
  /** Manual retries after auto-retry exhausted (max 2 UI retries). */
  manualRetries: number;
  requestId?: string;
};

type StartResponse = {
  error?: string;
  roundId?: string;
  alreadyComplete?: boolean;
  reviewers?: Array<{
    id: string;
    title: string;
    roleKey: string;
    status: OfficerStatus;
    stance?: string | null;
    content?: unknown;
    statementId?: string;
    error?: string;
  }>;
};

type GenerateResponse = {
  status: "completed" | "failed" | "timed_out" | "skipped";
  requestId: string;
  memberId: string;
  roleKey?: string;
  title?: string;
  stance?: string;
  content?: unknown;
  statementId?: string;
  error?: string;
};

function statusLabel(card: OfficerCard): string {
  switch (card.status) {
    case "pending":
      return "待機中…";
    case "generating":
      return thinkingTitle(card.title);
    case "completed":
      return "レビュー完了";
    case "failed":
      return "失敗";
    case "timed_out":
      return "タイムアウト";
    default:
      return "";
  }
}

function isTerminal(status: OfficerStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "timed_out"
  );
}

/**
 * Step2 live officer reviews — client fans out one request per officer so
 * streaming buffer / StrictMode abort cannot freeze the whole step.
 */
export function LiveOfficerReview({
  meetingId,
  autoStart = true,
}: {
  meetingId: string;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState<OfficerCard[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [fatal, setFatal] = useState("");
  const [finished, setFinished] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  const arrivalRef = useRef(0);
  const inFlightRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef(0);
  const finalizedRef = useRef(false);
  const mountedRef = useRef(true);

  const completedCount = cards.filter((c) => c.status === "completed").length;
  const failedCount = cards.filter(
    (c) => c.status === "failed" || c.status === "timed_out",
  ).length;
  const total = cards.length;

  const tryFinalize = useEffectEvent(async (snapshot: OfficerCard[]) => {
    if (finalizedRef.current) return;
    if (snapshot.length === 0) return;
    if (!snapshot.every((c) => isTerminal(c.status))) return;

    const completed = snapshot.filter((c) => c.status === "completed");
    if (completed.length === 0) {
      setAllFailed(true);
      setFatal(
        "全員のレビュー取得に失敗しました。各役員の再試行、または全体再実行をしてください。",
      );
      return;
    }

    finalizedRef.current = true;
    const failedMemberIds = snapshot
      .filter((c) => c.status === "failed" || c.status === "timed_out")
      .map((c) => c.id);
    const terminalMemberIds = snapshot.map((c) => c.id);

    try {
      const res = await fetch(`/api/meetings/${meetingId}/reviews/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminalMemberIds, failedMemberIds }),
      });
      const data = (await res.json()) as {
        finalized?: boolean;
        error?: string;
        reason?: string;
      };
      if (!res.ok || !data.finalized) {
        finalizedRef.current = false;
        if (data.reason === "all_failed" || data.error) {
          setAllFailed(true);
          setFatal(data.error ?? "完了処理に失敗しました。");
        }
        return;
      }
      setFinished(true);
      startTransition(() => router.refresh());
    } catch (err) {
      finalizedRef.current = false;
      setFatal(err instanceof Error ? err.message : "完了処理エラー");
    }
  });

  const generateOne = useEffectEvent(
    async (memberId: string, session: number, isManualRetry = false) => {
      if (!mountedRef.current || session !== sessionRef.current) return;
      if (inFlightRef.current.has(memberId)) return;
      inFlightRef.current.add(memberId);

      const requestId = crypto.randomUUID();
      setCards((prev) =>
        prev.map((c) =>
          c.id === memberId
            ? {
                ...c,
                status: "generating",
                error: undefined,
                requestId,
                thinkingLine: pickThinkingLine(c.roleKey),
                manualRetries: isManualRetry
                  ? c.manualRetries + 1
                  : c.manualRetries,
              }
            : c,
        ),
      );

      try {
        const res = await fetch(
          `/api/meetings/${meetingId}/reviews/${memberId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId }),
          },
        );
        const data = (await res.json()) as GenerateResponse;
        if (!mountedRef.current || session !== sessionRef.current) return;

        // Ignore stale responses if a newer requestId is active
        setCards((prev) => {
          const current = prev.find((c) => c.id === memberId);
          if (current?.requestId && current.requestId !== requestId) {
            return prev;
          }

          let next: OfficerCard[];
          if (data.status === "completed" || data.status === "skipped") {
            arrivalRef.current += 1;
            const order = arrivalRef.current;
            next = prev.map((c) =>
              c.id === memberId
                ? {
                    ...c,
                    status: "completed",
                    stance: data.stance ?? c.stance,
                    content: data.content ?? c.content,
                    title: data.title ?? c.title,
                    roleKey: data.roleKey ?? c.roleKey,
                    arrivalOrder: c.arrivalOrder ?? order,
                    error: undefined,
                  }
                : c,
            );
          } else if (data.status === "timed_out") {
            next = prev.map((c) =>
              c.id === memberId
                ? {
                    ...c,
                    status: "timed_out",
                    error: data.error ?? "タイムアウトしました",
                  }
                : c,
            );
          } else {
            next = prev.map((c) =>
              c.id === memberId
                ? {
                    ...c,
                    status: "failed",
                    error: data.error ?? "レビュー生成に失敗しました",
                  }
                : c,
            );
          }
          queueMicrotask(() => void tryFinalize(next));
          return next;
        });
      } catch (err) {
        if (!mountedRef.current || session !== sessionRef.current) return;
        setCards((prev) => {
          const next = prev.map((c) =>
            c.id === memberId
              ? {
                  ...c,
                  status: "failed" as const,
                  error:
                    err instanceof Error
                      ? err.message
                      : "レビュー生成に失敗しました",
                }
              : c,
          );
          queueMicrotask(() => void tryFinalize(next));
          return next;
        });
      } finally {
        inFlightRef.current.delete(memberId);
      }
    },
  );

  const bootstrap = useEffectEvent(async () => {
    const session = ++sessionRef.current;
    finalizedRef.current = false;
    inFlightRef.current.clear();
    arrivalRef.current = 0;
    setBootstrapping(true);
    setFatal("");
    setFinished(false);
    setAllFailed(false);

    try {
      const res = await fetch(`/api/meetings/${meetingId}/reviews/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as StartResponse;
      if (!mountedRef.current || session !== sessionRef.current) return;

      if (!res.ok || !data.reviewers) {
        setFatal(data.error ?? "役員レビューを開始できませんでした。");
        setBootstrapping(false);
        return;
      }

      const nextCards: OfficerCard[] = data.reviewers.map((r) => ({
        id: r.id,
        title: r.title,
        roleKey: r.roleKey,
        status: r.status === "completed" ? "completed" : "pending",
        thinkingLine: pickThinkingLine(r.roleKey),
        stance: r.stance,
        content: r.content,
        error: r.error,
        arrivalOrder: r.status === "completed" ? undefined : undefined,
        manualRetries: 0,
      }));

      // Assign arrival for already-completed (resume)
      nextCards.forEach((c) => {
        if (c.status === "completed") {
          arrivalRef.current += 1;
          c.arrivalOrder = arrivalRef.current;
        }
      });

      setCards(nextCards);
      setBootstrapping(false);

      if (data.alreadyComplete) {
        setFinished(true);
        startTransition(() => router.refresh());
        return;
      }

      const pending = nextCards.filter((c) => c.status !== "completed");
      // Fan-out in parallel — independent of each other
      await Promise.allSettled(
        pending.map((c) => generateOne(c.id, session, false)),
      );
    } catch (err) {
      if (!mountedRef.current || session !== sessionRef.current) return;
      setFatal(err instanceof Error ? err.message : "開始エラー");
      setBootstrapping(false);
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) {
      void bootstrap();
    } else {
      setBootstrapping(false);
    }
    return () => {
      mountedRef.current = false;
      // Bump session so in-flight handlers ignore results; do NOT block remount
      sessionRef.current += 1;
      inFlightRef.current.clear();
    };
  }, [autoStart, meetingId]);

  function retryOne(memberId: string) {
    const card = cards.find((c) => c.id === memberId);
    if (!card) return;
    if (card.manualRetries >= 2) return;
    if (card.status !== "failed" && card.status !== "timed_out") return;
    finalizedRef.current = false;
    setAllFailed(false);
    setFatal("");
    void generateOne(memberId, sessionRef.current, true);
  }

  return (
    <section className="rounded border border-stone-400 bg-stone-50">
      <div className="border-b border-stone-300 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              役員レビュー（ライブ）
            </h2>
            <p className="mt-1 text-xs text-stone-600">
              全員へ同時に依頼し、返ってきた役員から順に表示します。1人失敗しても他は続行します。
            </p>
          </div>
          <div className="text-xs text-stone-600">
            {total > 0 ? (
              <span>
                役員レビュー {completedCount} / {total} 完了
                {failedCount > 0 ? `（失敗 ${failedCount}）` : ""}
              </span>
            ) : bootstrapping ? (
              <span className="animate-pulse">役員名簿を読み込み中…</span>
            ) : (
              <span>役員がいません</span>
            )}
          </div>
        </div>
        {finished ? (
          <p className="mt-2 text-sm font-medium text-emerald-800">
            レビューが揃いました。AIディスカッションへ進みます…
          </p>
        ) : null}
        {allFailed ? (
          <p className="mt-2 text-sm font-medium text-rose-800">
            Step2を完了できません。少なくとも1名のレビューが必要です。
          </p>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        {bootstrapping && cards.length === 0 ? (
          <p className="animate-pulse text-sm text-stone-500">
            役員を召集しています…
          </p>
        ) : null}

        {cards.map((card) => {
          const accent = ROLE_ACCENT[card.roleKey] ?? "border-l-stone-500";
          const canRetry =
            (card.status === "failed" || card.status === "timed_out") &&
            card.manualRetries < 2;

          return (
            <article
              key={card.id}
              className={`overflow-hidden rounded border border-stone-300 border-l-4 bg-white shadow-sm ${accent}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-stone-900">
                    {card.title}
                  </span>
                  {card.status === "completed" ? (
                    <StanceBadge stance={card.stance} />
                  ) : null}
                  {card.arrivalOrder ? (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
                      {card.arrivalOrder}番目に到着
                    </span>
                  ) : null}
                </div>
                <span
                  className={`text-xs ${
                    card.status === "completed"
                      ? "text-emerald-700"
                      : card.status === "failed" || card.status === "timed_out"
                        ? "text-rose-700"
                        : "animate-pulse text-stone-500"
                  }`}
                >
                  {statusLabel(card)}
                </span>
              </div>

              {card.status === "pending" ? (
                <div className="px-4 py-3 text-sm text-stone-400">
                  まもなくレビューを開始します…
                </div>
              ) : null}

              {card.status === "generating" ? (
                <div className="px-4 py-3">
                  <p className="text-sm text-stone-600">{card.thinkingLine}</p>
                  <div className="mt-2 flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:300ms]" />
                  </div>
                </div>
              ) : null}

              {(card.status === "failed" || card.status === "timed_out") && (
                <div className="px-4 py-3">
                  <p className="text-sm text-rose-700">
                    {card.error ?? "応答取得に失敗しました"}
                  </p>
                  {canRetry ? (
                    <button
                      type="button"
                      onClick={() => retryOne(card.id)}
                      className="mt-2 rounded border border-rose-400 bg-white px-3 py-1 text-xs text-rose-900 hover:bg-rose-50"
                    >
                      再試行
                    </button>
                  ) : (
                    <p className="mt-1 text-xs text-stone-500">
                      再試行上限に達しました
                    </p>
                  )}
                </div>
              )}

              {card.status === "completed" && card.content ? (
                <div className="border-t border-stone-100 p-2">
                  <StatementCard
                    step={MEETING_STEP.INITIAL_REVIEW}
                    title={card.title}
                    stance={card.stance}
                    speakerType="board_member"
                    content={card.content}
                    embedded
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {fatal ? (
        <div className="border-t border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm text-rose-800">{fatal}</p>
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="mt-2 rounded border border-rose-400 bg-white px-3 py-1.5 text-sm text-rose-900 hover:bg-rose-100"
          >
            Step2を再実行
          </button>
        </div>
      ) : null}

      {!autoStart && cards.length === 0 ? (
        <div className="border-t border-stone-200 px-4 py-3">
          <button
            type="button"
            onClick={() => void bootstrap()}
            className="rounded bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700"
          >
            役員レビューを開始
          </button>
        </div>
      ) : null}
    </section>
  );
}
