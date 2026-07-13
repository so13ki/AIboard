"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MEETING_STATUS } from "@/lib/meeting/constants";

const ADVANCEABLE = new Set<string>([
  MEETING_STATUS.AGENDA,
  // INITIAL_REVIEW is driven by LiveOfficerReview stream — not blank "AI実行中"
  MEETING_STATUS.DISCUSSION,
  MEETING_STATUS.REBUTTAL,
  MEETING_STATUS.PRODUCT_COACH,
  MEETING_STATUS.INTERIM,
  MEETING_STATUS.CEO_EDIT,
  MEETING_STATUS.GROWTH_SUMMARY,
  MEETING_STATUS.DECISION,
  MEETING_STATUS.RE_REVIEW,
  MEETING_STATUS.PRODUCT_COACH_FOLLOWUP,
]);

export function MeetingControls({
  meetingId,
  status,
}: {
  meetingId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState({
    rebuttal: "",
    additionalInfo: "",
    revisedPlan: "",
  });

  const canAdvance =
    ADVANCEABLE.has(status) &&
    status !== MEETING_STATUS.AWAITING_DISCUSSION &&
    status !== MEETING_STATUS.DISCUSSION &&
    status !== MEETING_STATUS.REBUTTAL;
  const awaitingAnswer =
    status === MEETING_STATUS.AWAITING_ANSWER ||
    status === MEETING_STATUS.AWAITING_ANSWER_2;
  const failed = status === MEETING_STATUS.FAILED;
  const decided = status === MEETING_STATUS.DECIDED;

  async function advance(retry = false) {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/meetings/${meetingId}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retry }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "進行に失敗しました。");
      router.refresh();
      return;
    }
    router.refresh();
  }

  async function submitAnswer() {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/meetings/${meetingId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answer),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "回答の送信に失敗しました。");
      router.refresh();
      return;
    }
    setAnswer({ rebuttal: "", additionalInfo: "", revisedPlan: "" });
    router.refresh();
  }

  async function skipAnswer() {
    setLoading(true);
    setError("");
    const res = await fetch(`/api/meetings/${meetingId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skip: true }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "スキップに失敗しました。");
      router.refresh();
      return;
    }
    router.refresh();
  }

  if (decided) {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        育成レビューが完了しています。上の Before → After
        と下の履歴を確認してください。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {awaitingAnswer ? (
        <section className="rounded border-2 border-amber-400 bg-amber-50 p-5">
          <h2 className="text-lg font-semibold text-amber-950">企画者ターン</h2>
          <p className="mt-1 text-sm text-amber-900">
            企画推進役の整理を受け、必要なときだけ回答・修正・反論してください。宿題がなければスキップしてCEO編集へ進めます。
          </p>
          <div className="mt-4 space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">回答・反論</span>
              <textarea
                className="min-h-28 w-full rounded border border-amber-300 bg-white px-3 py-2 text-sm"
                value={answer.rebuttal}
                onChange={(e) => setAnswer({ ...answer, rebuttal: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">追加情報</span>
              <textarea
                className="min-h-24 w-full rounded border border-amber-300 bg-white px-3 py-2 text-sm"
                value={answer.additionalInfo}
                onChange={(e) =>
                  setAnswer({ ...answer, additionalInfo: e.target.value })
                }
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">企画の修正版</span>
              <textarea
                className="min-h-32 w-full rounded border border-amber-300 bg-white px-3 py-2 text-sm"
                value={answer.revisedPlan}
                onChange={(e) =>
                  setAnswer({ ...answer, revisedPlan: e.target.value })
                }
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading || !answer.rebuttal.trim()}
                onClick={() => void submitAnswer()}
                className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60"
              >
                {loading ? "送信中..." : "回答を送信してCEO編集へ"}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void skipAnswer()}
                className="rounded border border-amber-700 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              >
                回答をスキップしてCEO編集へ
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {canAdvance ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void advance(false)}
            className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
          >
            {loading ? "AI実行中..." : "次のステップへ"}
          </button>
        ) : null}
        {failed ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void advance(true)}
            className="rounded border border-rose-400 bg-white px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-60"
          >
            {loading ? "再試行中..." : "失敗したステップを再試行"}
          </button>
        ) : null}
        {error ? <span className="text-sm text-rose-700">{error}</span> : null}
      </div>
    </div>
  );
}
