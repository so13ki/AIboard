"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  startTransition,
} from "react";

const ROLE_STYLES: Record<string, string> = {
  ceo: "bg-stone-800 text-white",
  cfo: "bg-emerald-800 text-white",
  marketing: "bg-sky-800 text-white",
  operations: "bg-amber-800 text-white",
  cto: "bg-indigo-800 text-white",
  customer: "bg-rose-800 text-white",
  redteam: "bg-red-900 text-white",
  quality_balancer: "bg-teal-800 text-white",
  proposer: "bg-orange-600 text-white",
  chair: "bg-stone-600 text-white",
  system: "bg-stone-200 text-stone-700",
};

const MOVE_LABELS: Record<string, string> = {
  question: "質問",
  counter: "反論",
  alternative: "別案",
  challenge_premise: "前提疑い",
  expand: "拡張",
  brake: "ブレーキ",
};

const TARGET_OPTIONS = [
  { value: "all", label: "全員" },
  { value: "ceo", label: "議長" },
  { value: "cfo", label: "CFO" },
  { value: "marketing", label: "マーケティング責任者" },
  { value: "operations", label: "現場責任者" },
  { value: "cto", label: "CTO" },
  { value: "customer", label: "顧客代表" },
  { value: "redteam", label: "レッドチーム" },
  { value: "quality_balancer", label: "Quality Balancer" },
] as const;

const MESSAGE_TYPES = [
  { value: "", label: "自動判定" },
  { value: "question", label: "質問" },
  { value: "objection", label: "反論" },
  { value: "clarification", label: "補足" },
  { value: "proposal_change", label: "新しい案 / 企画変更" },
  { value: "summary_request", label: "一度整理" },
  { value: "end_request", label: "会議終了" },
] as const;

type ChatMessage = {
  id?: string;
  speakerType?: string;
  roleKey?: string | null;
  title?: string;
  text?: string;
  content?: string;
  addressTo?: string;
  addressRoleKey?: string | null;
  moveType?: string;
  kind?: string;
  messageType?: string | null;
  planUpdate?: {
    version?: number;
    changes?: string[];
    summary?: string;
  };
};

type PlanVersion = {
  version?: number;
  summary?: string;
  changes?: string[];
};

type PendingPlanUpdate = {
  version: number;
  changes: string[];
  summary: string;
  chairNote?: string | null;
};

type OpenTopic = {
  id: string;
  label: string;
  status: "unresolved" | "discussing" | "resolved";
  note?: string | null;
};

type WallSummary = {
  format?: string;
  messages?: ChatMessage[];
  planVersions?: PlanVersion[];
  currentVersion?: number;
  ended?: boolean;
  paused?: boolean;
  awaitingEndConfirm?: boolean;
  pendingPlanUpdate?: PendingPlanUpdate | null;
  openTopics?: OpenTopic[];
  priorityIssues?: string[];
  decisions?: string[];
  rejectedItems?: string[];
};

type ThinkingState = {
  title: string;
  line: string;
  roleKey: string;
} | null;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function messageText(msg: ChatMessage): string {
  return msg.text ?? msg.content ?? "";
}

function isProposerMsg(msg: ChatMessage): boolean {
  return msg.speakerType === "proposer" || msg.speakerType === "user";
}

function PlanUpdateCard({ msg }: { msg: ChatMessage }) {
  const version = msg.planUpdate?.version ?? 0;
  const changes = Array.isArray(msg.planUpdate?.changes)
    ? msg.planUpdate.changes
    : [];

  return (
    <div className="mx-auto w-full max-w-xl rounded border-2 border-dashed border-stone-800 bg-stone-100 px-4 py-3 font-mono text-sm text-stone-900">
      <div className="text-center text-base font-semibold">📌企画更新</div>
      <div className="mt-1 text-center text-lg font-bold">Version{version}</div>
      <div className="mt-3 font-semibold">変更内容</div>
      <ul className="mt-1 space-y-1">
        {changes.map((change) => (
          <li key={change}>・{change.replace(/^・/, "")}</li>
        ))}
      </ul>
      <p className="mt-2 text-center text-xs text-stone-700">
        これ以降は Version{version} を前提に議論します。
      </p>
    </div>
  );
}

function PendingPlanUpdateBanner({
  pending,
  onApprove,
  onReject,
  onEdit,
  busy,
}: {
  pending: PendingPlanUpdate;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded border-2 border-amber-500 bg-amber-50 p-4">
      <div className="font-semibold text-amber-950">
        企画更新候補 Version{pending.version}
      </div>
      <div className="mt-2 text-sm font-medium text-amber-900">変更点:</div>
      <ul className="mt-1 space-y-1 text-sm text-amber-950">
        {pending.changes.map((c) => (
          <li key={c}>・{c.replace(/^・/, "")}</li>
        ))}
      </ul>
      {pending.chairNote ? (
        <p className="mt-2 text-xs text-amber-800">{pending.chairNote}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="rounded bg-amber-800 px-3 py-1.5 text-sm text-white hover:bg-amber-900 disabled:opacity-60"
        >
          この内容で企画を更新
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="rounded border border-amber-700 bg-white px-3 py-1.5 text-sm text-amber-900 disabled:opacity-60"
        >
          編集して更新
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="rounded border border-stone-400 bg-white px-3 py-1.5 text-sm text-stone-700 disabled:opacity-60"
        >
          更新しない
        </button>
      </div>
    </div>
  );
}

function ThinkingBubble({ thinking }: { thinking: ThinkingState }) {
  if (!thinking) return null;
  const bubble =
    ROLE_STYLES[thinking.roleKey] ?? "bg-stone-500 text-white";
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 opacity-90 ${bubble}`}
      >
        <div className="text-[11px] font-semibold opacity-90">
          {thinking.title}
        </div>
        <p className="mt-1 animate-pulse text-sm leading-relaxed">
          {thinking.line}
        </p>
      </div>
    </div>
  );
}

function parseSummary(raw: unknown): WallSummary {
  const data = asRecord(raw);
  return {
    format: typeof data.format === "string" ? data.format : "wall_chat",
    messages: Array.isArray(data.messages)
      ? (data.messages as ChatMessage[])
      : [],
    planVersions: Array.isArray(data.planVersions)
      ? (data.planVersions as PlanVersion[])
      : [],
    currentVersion:
      typeof data.currentVersion === "number" ? data.currentVersion : 1,
    ended: Boolean(data.ended),
    paused: Boolean(data.paused),
    awaitingEndConfirm: Boolean(data.awaitingEndConfirm),
    pendingPlanUpdate:
      data.pendingPlanUpdate && typeof data.pendingPlanUpdate === "object"
        ? (data.pendingPlanUpdate as PendingPlanUpdate)
        : null,
    openTopics: Array.isArray(data.openTopics)
      ? (data.openTopics as OpenTopic[]).filter(
          (t) =>
            t &&
            typeof t.id === "string" &&
            typeof t.label === "string" &&
            (t.status === "unresolved" ||
              t.status === "discussing" ||
              t.status === "resolved"),
        )
      : [],
    priorityIssues: Array.isArray(data.priorityIssues)
      ? (data.priorityIssues as unknown[])
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.slice(0, 80))
          .slice(0, 4)
      : [],
    decisions: Array.isArray(data.decisions)
      ? (data.decisions as unknown[])
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.slice(0, 80))
      : [],
    rejectedItems: Array.isArray(data.rejectedItems)
      ? (data.rejectedItems as unknown[])
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.slice(0, 80))
      : [],
  };
}

export function DiscussionChat({
  summary,
  meetingId,
  awaitingProposer,
  canContinue,
}: {
  summary: unknown;
  meetingId: string;
  awaitingProposer: boolean;
  canContinue: boolean;
}) {
  const router = useRouter();
  const live = canContinue || awaitingProposer;

  const [wall, setWall] = useState<WallSummary>(() => parseSummary(summary));
  const [thinking, setThinking] = useState<ThinkingState>(null);
  const [apiWaiting, setApiWaiting] = useState(false);
  const [message, setMessage] = useState("");
  const [targetRoleKey, setTargetRoleKey] = useState("all");
  const [messageType, setMessageType] = useState("");
  const [error, setError] = useState("");
  const [busyInterrupt, setBusyInterrupt] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editChanges, setEditChanges] = useState("");
  const [editSummary, setEditSummary] = useState("");

  const speakAbortRef = useRef<AbortController | null>(null);
  const prepareAbortRef = useRef<AbortController | null>(null);
  const loopGenerationRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoRunningRef = useRef(false);

  const applySummary = useCallback((next: unknown) => {
    if (!next) return;
    setWall(parseSummary(next));
  }, []);

  useEffect(() => {
    setWall(parseSummary(summary));
  }, [summary]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [wall.messages, thinking, apiWaiting]);

  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const t = window.setTimeout(() => resolve(), ms);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });

  const runLiveTurn = useEffectEvent(async (loopId: number) => {
    if (!live || wall.ended || wall.paused || wall.awaitingEndConfirm) return;

    setApiWaiting(true);
    setThinking({
      title: "司会が考えています…",
      line: "次に振る役員を選んでいます…",
      roleKey: "chair",
    });

    const prepareAbort = new AbortController();
    prepareAbortRef.current = prepareAbort;

    try {
      const prepRes = await fetch(
        `/api/meetings/${meetingId}/discuss/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: prepareAbort.signal,
        },
      );
      if (loopId !== loopGenerationRef.current) return;

      const prep = (await prepRes.json()) as {
        error?: string;
        status?: string;
        generationId?: string | null;
        speaker?: { roleKey: string; title: string } | null;
        thinkingTitle?: string | null;
        thinkingLine?: string | null;
        summary?: unknown;
      };

      if (!prepRes.ok) {
        setError(prep.error ?? "進行に失敗しました。");
        setThinking(null);
        setApiWaiting(false);
        return;
      }

      applySummary(prep.summary);

      if (
        prep.status === "paused" ||
        prep.status === "ended" ||
        prep.status === "awaiting_end_confirm" ||
        prep.status === "awaiting_proposer"
      ) {
        setThinking(null);
        setApiWaiting(false);
        autoRunningRef.current = false;
        startTransition(() => router.refresh());
        return;
      }

      if (prep.status === "chair_only") {
        setThinking(null);
        setApiWaiting(false);
        // Continue after a short beat
        await sleep(900);
        if (loopId !== loopGenerationRef.current) return;
        void runLiveTurn(loopId);
        return;
      }

      if (
        prep.status !== "ready" ||
        !prep.generationId ||
        !prep.speaker
      ) {
        setThinking(null);
        setApiWaiting(false);
        return;
      }

      setThinking({
        title: prep.thinkingTitle ?? `${prep.speaker.title}が考えています…`,
        line: prep.thinkingLine ?? "考えています…",
        roleKey: prep.speaker.roleKey,
      });

      // Dramatic pause before / during generation
      const thinkMs = 1800 + Math.floor(Math.random() * 1800);
      const speakAbort = new AbortController();
      speakAbortRef.current = speakAbort;

      try {
        await sleep(thinkMs, speakAbort.signal);
      } catch {
        setThinking(null);
        setApiWaiting(false);
        return;
      }

      const speakRes = await fetch(
        `/api/meetings/${meetingId}/discuss/speak`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: prep.generationId }),
          signal: speakAbort.signal,
        },
      );

      if (loopId !== loopGenerationRef.current) return;

      const spoken = (await speakRes.json()) as {
        error?: string;
        status?: string;
        summary?: unknown;
      };

      if (!speakRes.ok && spoken.status !== "aborted") {
        setError(spoken.error ?? "発言生成に失敗しました。");
        setThinking(null);
        setApiWaiting(false);
        return;
      }

      if (spoken.status === "stale" || spoken.status === "aborted") {
        setThinking(null);
        setApiWaiting(false);
        return;
      }

      applySummary(spoken.summary);
      setThinking(null);
      setApiWaiting(false);

      const nextWall = parseSummary(spoken.summary);
      await sleep(700);
      if (loopId !== loopGenerationRef.current) return;
      if (
        !nextWall.paused &&
        !nextWall.ended &&
        !nextWall.awaitingEndConfirm
      ) {
        void runLiveTurn(loopId);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setThinking(null);
        setApiWaiting(false);
        return;
      }
      setError(err instanceof Error ? err.message : "会議進行エラー");
      setThinking(null);
      setApiWaiting(false);
    }
  });

  // Auto-start live loop (only while DISCUSSION, not while awaiting proposer)
  useEffect(() => {
    if (
      !canContinue ||
      wall.ended ||
      wall.paused ||
      wall.awaitingEndConfirm
    ) {
      autoRunningRef.current = false;
      return;
    }
    if (autoRunningRef.current) return;
    autoRunningRef.current = true;
    const id = ++loopGenerationRef.current;
    void runLiveTurn(id);
    return () => {
      autoRunningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canContinue, wall.ended, wall.paused, wall.awaitingEndConfirm, meetingId]);

  function abortInFlight() {
    speakAbortRef.current?.abort();
    prepareAbortRef.current?.abort();
    speakAbortRef.current = null;
    prepareAbortRef.current = null;
    loopGenerationRef.current += 1;
    autoRunningRef.current = false;
    setThinking(null);
    setApiWaiting(false);
  }

  async function sendInterrupt(opts?: {
    controlAction?: string;
    asMessage?: string;
  }) {
    const text = (opts?.asMessage ?? message).trim();
    if (!text && !opts?.controlAction) return;

    setBusyInterrupt(true);
    setError("");
    abortInFlight();

    try {
      const res = await fetch(`/api/meetings/${meetingId}/discuss/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text || opts?.controlAction || "（会議制御）",
          targetRoleKey: targetRoleKey === "all" ? null : targetRoleKey,
          messageType: messageType || null,
          controlAction: opts?.controlAction ?? null,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        summary?: unknown;
      };
      if (!res.ok) {
        setError(data.error ?? "割り込みに失敗しました。");
        setBusyInterrupt(false);
        return;
      }
      applySummary(data.summary);
      setMessage("");
      setBusyInterrupt(false);
      startTransition(() => router.refresh());

      const next = parseSummary(data.summary);
      if (!next.paused && !next.ended && !next.awaitingEndConfirm) {
        const id = ++loopGenerationRef.current;
        autoRunningRef.current = true;
        window.setTimeout(() => void runLiveTurn(id), 600);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "割り込みエラー");
      setBusyInterrupt(false);
    }
  }

  async function runControl(
    action:
      | "pause"
      | "resume"
      | "summarize"
      | "close_topic"
      | "change_topic"
      | "proceed"
      | "confirm_end"
      | "cancel_end",
  ) {
    setBusyInterrupt(true);
    setError("");
    if (action === "pause") abortInFlight();

    const res = await fetch(`/api/meetings/${meetingId}/discuss/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json()) as {
      error?: string;
      summary?: unknown;
      ended?: boolean;
    };
    setBusyInterrupt(false);
    if (!res.ok) {
      setError(data.error ?? "操作に失敗しました。");
      return;
    }
    applySummary(data.summary);
    startTransition(() => router.refresh());

    if (action === "resume" && live) {
      const id = ++loopGenerationRef.current;
      autoRunningRef.current = true;
      void runLiveTurn(id);
    }
  }

  async function resolvePlan(
    action: "approve" | "reject" | "edit",
    extra?: { editedChanges?: string[]; editedSummary?: string },
  ) {
    setBusyInterrupt(true);
    const res = await fetch(`/api/meetings/${meetingId}/discuss/plan-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = (await res.json()) as { error?: string; summary?: unknown };
    setBusyInterrupt(false);
    if (!res.ok) {
      setError(data.error ?? "企画更新に失敗しました。");
      return;
    }
    applySummary(data.summary);
    setEditOpen(false);
    startTransition(() => router.refresh());
    if (live && !wall.paused) {
      const id = ++loopGenerationRef.current;
      autoRunningRef.current = true;
      void runLiveTurn(id);
    }
  }

  const messages = wall.messages ?? [];
  const planVersions = wall.planVersions ?? [];
  const currentVersion = wall.currentVersion ?? 1;
  const currentPlan = planVersions.find((v) => v.version === currentVersion);

  return (
    <div className="flex min-h-[32rem] flex-col rounded border border-stone-300 bg-stone-50">
      <div className="border-b border-stone-300 bg-white px-4 py-3">
        <div className="text-sm font-semibold text-stone-900">
          AI壁打ち会議 — ライブ役員会
        </div>
        <p className="mt-1 text-xs text-stone-600">
          役員は会議メモリ（決定・却下・論点）を前提に発言します。同じ提案の繰り返しは禁止。いつでも下の入力から割り込めます。
          {wall.ended ? (
            <span className="ml-2 font-medium text-emerald-800">（終了）</span>
          ) : null}
          {wall.paused ? (
            <span className="ml-2 font-medium text-amber-800">（一時停止中）</span>
          ) : null}
        </p>
        {(wall.decisions && wall.decisions.length > 0) ||
        (wall.rejectedItems && wall.rejectedItems.length > 0) ||
        (wall.priorityIssues && wall.priorityIssues.length > 0) ||
        (wall.openTopics && wall.openTopics.length > 0) ? (
          <div className="mt-3 space-y-2 rounded border border-stone-200 bg-stone-50 px-3 py-2">
            <div className="text-[11px] font-semibold tracking-wide text-stone-500">
              会議メモリ（CEOが毎ターン更新）
            </div>
            {wall.decisions && wall.decisions.length > 0 ? (
              <div>
                <div className="text-[11px] font-medium text-emerald-800">
                  決定事項（前提）
                </div>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {wall.decisions.map((item) => (
                    <li
                      key={item}
                      className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-950"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {wall.rejectedItems && wall.rejectedItems.length > 0 ? (
              <div>
                <div className="text-[11px] font-medium text-rose-800">
                  却下事項（再提案禁止）
                </div>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {wall.rejectedItems.map((item) => (
                    <li
                      key={item}
                      className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-950 line-through decoration-rose-400/80"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(() => {
              const unresolved = (wall.openTopics ?? []).filter(
                (t) => t.status !== "resolved",
              );
              const priorities =
                wall.priorityIssues && wall.priorityIssues.length > 0
                  ? wall.priorityIssues
                  : unresolved.map((t) => t.label).slice(0, 4);
              const extraCount = Math.max(0, unresolved.length - priorities.length);
              if (priorities.length === 0 && unresolved.length === 0) return null;
              return (
                <div>
                  <div className="text-[11px] font-medium text-amber-900">
                    重要論点（優先度順）
                    {unresolved.length > 0 ? (
                      <span className="ml-1 font-normal text-stone-500">
                        — 未解決は全体で{unresolved.length}件
                        {extraCount > 0 ? `（他${extraCount}件は裏で保持）` : ""}
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-1.5 flex flex-wrap gap-2">
                    {priorities.map((label, index) => {
                      const topic = unresolved.find(
                        (t) => t.label === label || t.id === label,
                      );
                      const style =
                        topic?.status === "discussing"
                          ? "border-sky-300 bg-sky-50 text-sky-950"
                          : "border-amber-300 bg-amber-50 text-amber-950";
                      return (
                        <li
                          key={`${label}-${index}`}
                          className={`rounded border px-2 py-1 text-xs ${style}`}
                          title={topic?.note ?? undefined}
                        >
                          <span className="mr-1 opacity-60">{index + 1}.</span>
                          {label}
                          {topic?.status === "discussing" ? (
                            <span className="ml-1 opacity-70">（議論中）</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span className="font-medium text-stone-800">
            企画 Version{currentVersion}
          </span>
          {planVersions.length > 1 ? (
            <span>
              履歴: {planVersions.map((v) => `V${v.version}`).join(" → ")}
            </span>
          ) : null}
        </div>
        {currentPlan?.summary ? (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-stone-600">
              現在の企画を見る
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-stone-700">
              {currentPlan.summary}
            </p>
          </details>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && !thinking ? (
          <p className="text-sm text-stone-500">
            {live
              ? "会議を開始しています…"
              : "まだ発言がありません。"}
          </p>
        ) : null}

        {messages.map((msg, index) => {
          if (msg.kind === "plan_update") {
            return (
              <PlanUpdateCard
                key={msg.id ?? `plan-${msg.planUpdate?.version ?? index}`}
                msg={msg}
              />
            );
          }

          const proposer = isProposerMsg(msg);
          const isSystem = msg.speakerType === "system";
          const roleKey =
            msg.speakerType === "chair"
              ? "chair"
              : proposer
                ? "proposer"
                : isSystem
                  ? "system"
                  : (msg.roleKey ?? "ceo");
          const bubble =
            ROLE_STYLES[roleKey] ?? "bg-stone-700 text-white";
          const text = messageText(msg);

          return (
            <div
              key={msg.id ?? `${msg.title}-${index}-${text.slice(0, 12)}`}
              className={`flex ${proposer ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 ${bubble} ${
                  proposer ? "ring-2 ring-orange-300 ring-offset-1" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] opacity-90">
                  <span className="font-semibold">
                    {msg.title ?? (proposer ? "企画者" : "不明")}
                  </span>
                  {msg.moveType ? (
                    <span>{MOVE_LABELS[msg.moveType] ?? msg.moveType}</span>
                  ) : null}
                  {msg.addressTo === "officer" && msg.addressRoleKey ? (
                    <span>→ {msg.addressRoleKey}</span>
                  ) : msg.addressTo === "proposer" ? (
                    <span>→ 企画者</span>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                  {text}
                </p>
              </div>
            </div>
          );
        })}

        <ThinkingBubble thinking={thinking} />
        {apiWaiting && !thinking ? (
          <p className="animate-pulse text-sm text-stone-500">
            会議を進行しています…
          </p>
        ) : null}
      </div>

      {wall.pendingPlanUpdate ? (
        <div className="border-t border-amber-300 px-4 py-3">
          <PendingPlanUpdateBanner
            pending={wall.pendingPlanUpdate}
            busy={busyInterrupt}
            onApprove={() => void resolvePlan("approve")}
            onReject={() => void resolvePlan("reject")}
            onEdit={() => {
              setEditChanges(wall.pendingPlanUpdate!.changes.join("\n"));
              setEditSummary(wall.pendingPlanUpdate!.summary);
              setEditOpen(true);
            }}
          />
          {editOpen ? (
            <div className="mt-3 space-y-2 rounded border border-amber-300 bg-white p-3">
              <label className="block text-xs font-medium text-stone-700">
                変更点（1行1件）
                <textarea
                  className="mt-1 min-h-20 w-full rounded border border-stone-300 px-2 py-1 text-sm"
                  value={editChanges}
                  onChange={(e) => setEditChanges(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium text-stone-700">
                企画要約
                <textarea
                  className="mt-1 min-h-24 w-full rounded border border-stone-300 px-2 py-1 text-sm"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busyInterrupt}
                onClick={() =>
                  void resolvePlan("edit", {
                    editedChanges: editChanges
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    editedSummary: editSummary,
                  })
                }
                className="rounded bg-amber-800 px-3 py-1.5 text-sm text-white disabled:opacity-60"
              >
                編集内容で更新
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {wall.awaitingEndConfirm && live ? (
        <div className="border-t border-stone-300 bg-stone-100 px-4 py-3">
          <p className="text-sm text-stone-800">
            議長が終了を提案しています。最終決定は企画者です。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() => void runControl("confirm_end")}
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            >
              会議を終了する
            </button>
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() => void runControl("proceed")}
              className="rounded bg-emerald-800 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            >
              この方向で進める
            </button>
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() => void runControl("cancel_end")}
              className="rounded border border-stone-400 bg-white px-3 py-1.5 text-sm disabled:opacity-60"
            >
              まだ続ける
            </button>
          </div>
        </div>
      ) : null}

      {live && !wall.ended ? (
        <div className="sticky bottom-0 border-t border-stone-400 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyInterrupt || wall.paused}
              onClick={() => void runControl("pause")}
              className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              一時停止
            </button>
            <button
              type="button"
              disabled={busyInterrupt || !wall.paused}
              onClick={() => void runControl("resume")}
              className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              再開
            </button>
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() => void runControl("summarize")}
              className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              一度整理
            </button>
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() => void runControl("close_topic")}
              className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              この論点を終了
            </button>
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() => void runControl("change_topic")}
              className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              別の論点へ
            </button>
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() => void runControl("proceed")}
              className="rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              この方向で進める
            </button>
            <button
              type="button"
              disabled={busyInterrupt}
              onClick={() =>
                void sendInterrupt({
                  controlAction: "end_request",
                  asMessage: "会議を終了したいです",
                })
              }
              className="rounded border border-rose-400 px-2 py-1 text-xs text-rose-800 hover:bg-rose-50 disabled:opacity-50"
            >
              会議を止める
            </button>
          </div>

          <div className="mb-2 flex flex-wrap gap-2">
            <label className="flex items-center gap-1 text-xs text-stone-600">
              発言先
              <select
                className="rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                value={targetRoleKey}
                onChange={(e) => setTargetRoleKey(e.target.value)}
              >
                {TARGET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs text-stone-600">
              タイプ
              <select
                className="rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                value={messageType}
                onChange={(e) => setMessageType(e.target.value)}
              >
                {MESSAGE_TYPES.map((o) => (
                  <option key={o.value || "auto"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <textarea
            className="min-h-16 w-full rounded border border-orange-300 bg-orange-50/40 px-3 py-2 text-sm"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="例: ちょっと待って。無料にするつもりはない / CFO、この場合の採算はどう？"
            disabled={false}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyInterrupt || !message.trim()}
              onClick={() => void sendInterrupt()}
              className="rounded bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60"
            >
              {busyInterrupt ? "送信中…" : "発言する"}
            </button>
            <button
              type="button"
              disabled={busyInterrupt || !message.trim()}
              onClick={() => void sendInterrupt()}
              className="rounded border border-orange-600 bg-white px-4 py-2 text-sm font-medium text-orange-800 hover:bg-orange-50 disabled:opacity-60"
            >
              割り込む
            </button>
          </div>
          {awaitingProposer ? (
            <p className="mt-2 text-xs text-orange-800">
              議長が企画者の返答を待っています。上の入力からいつでも発言できます。
            </p>
          ) : null}
          {thinking || apiWaiting ? (
            <p className="mt-1 text-xs text-stone-500">
              AI生成中でも割り込みできます。未完成の発言は破棄されます。
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="border-t border-rose-200 px-4 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
