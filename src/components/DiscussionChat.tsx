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
import { addressArrowLabel } from "@/lib/meeting/speaker-routing";

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
  accept: "納得",
  advance: "前進",
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
  targetType?: string | null;
  targetParticipantId?: string | null;
  moveType?: string;
  kind?: string;
  messageType?: string | null;
  planUpdate?: {
    version?: number;
    changes?: string[];
    summary?: string;
  };
  diagnostic?: DebuggerFindingView;
  metadata?: Record<string, unknown>;
};

type DebuggerFindingView = {
  id: string;
  ruleId: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detection: string;
  expectedState?: string;
  currentState?: string;
  estimatedCauses?: Array<{ label: string; confidence: number }>;
  improvements?: string[];
  fixTargets?: string[];
  cursorPrompt?: string;
  autoRepairLabel?: string | null;
  causes: string[];
  impact: string;
  recommendations: string[];
  relatedMessageIds: string[];
  relatedIssueIds: string[];
  relatedPlanVersion: number | null;
  autoRepairable: boolean;
  repairKind: string | null;
  status: string;
  createdAt: string;
  repairedAt?: string | null;
};

type DebuggerPublic = {
  mode?: "OFF" | "PASSIVE" | "ACTIVE";
  findings?: DebuggerFindingView[];
  repairLog?: Array<{
    at: string;
    findingId: string;
    action: string;
    note: string;
  }>;
  scores?: {
    duplicateRate?: number;
    advanceRate?: number;
    misrouteCount?: number;
    proposerOverAskCount?: number;
    autoRepairCount?: number;
    openFindings?: number;
  };
  openCount?: number;
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

type CeoQuestion = {
  id: string;
  text: string;
  status: "OPEN" | "ANSWERED" | "RESOLVED" | "PARKED";
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
  activeTheme?: string;
  activeThemeLabel?: string;
  unresolvedIssues?: string[];
  resolvedIssues?: string[];
  ceoQuestions?: CeoQuestion[];
  decisions?: string[];
  rejectedItems?: string[];
  debugger?: DebuggerPublic;
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
      <div className="text-center text-base font-semibold">企画更新</div>
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

function DiagnosticCard({
  msg,
  onRepair,
  busy,
}: {
  msg: ChatMessage;
  onRepair: (
    findingId: string,
    action: "auto" | "confirm" | "ignore",
  ) => void;
  busy: boolean;
}) {
  const [showCursor, setShowCursor] = useState(false);
  const [copied, setCopied] = useState(false);
  const d = msg.diagnostic;
  const severity = d?.severity ?? "info";
  const border =
    severity === "critical"
      ? "border-rose-500 bg-rose-50/90"
      : severity === "warning"
        ? "border-amber-500 bg-amber-50/90"
        : "border-slate-500 bg-slate-50/90";
  const label =
    severity === "critical"
      ? "Critical"
      : severity === "warning"
        ? "Warning"
        : "Info";
  const emoji =
    severity === "critical" ? "⛔" : severity === "warning" ? "⚠" : "ℹ";
  const status = d?.status ?? "open";
  const ignored = status === "ignored" || Boolean(msg.metadata?.ignored);
  const causes =
    d?.estimatedCauses && d.estimatedCauses.length > 0
      ? d.estimatedCauses
      : (d?.causes ?? []).map((labelText, i) => ({
          label: labelText,
          confidence: Math.max(40, 90 - i * 12),
        }));
  const improvements =
    d?.improvements && d.improvements.length > 0
      ? d.improvements
      : (d?.recommendations ?? []);
  const fixTargets = d?.fixTargets ?? [];
  const cursorPrompt = d?.cursorPrompt ?? "";

  if (msg.messageType === "debug_summary") {
    return (
      <div className="my-2 border-y border-dashed border-slate-400 py-3">
        <div className="text-[11px] font-semibold tracking-wide text-slate-500">
          AIデバッガー · 会議品質
        </div>
        <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">
          {messageText(msg)}
        </pre>
      </div>
    );
  }

  async function copyCursorPrompt() {
    if (!cursorPrompt) return;
    try {
      await navigator.clipboard.writeText(cursorPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowCursor(true);
    }
  }

  return (
    <div
      className={`my-3 rounded-none border-y-2 border-x-0 border-dashed px-0 py-0 ${border}`}
    >
      <div className={`border-x-2 border-dashed px-3 py-3 ${border}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-600">
            AIデバッガー
          </div>
          {ignored ? (
            <span className="text-[10px] text-slate-500">無視済</span>
          ) : status.includes("repair") ? (
            <span className="text-[10px] text-emerald-700">改善済み</span>
          ) : (
            <span className="text-[10px] text-amber-800">未対応</span>
          )}
        </div>
        <div className="mt-1 text-sm font-semibold text-slate-900">
          {emoji} {label}
        </div>
        <div className="mt-2 text-[11px] font-medium text-slate-500">検知</div>
        <p className="text-xs leading-relaxed text-slate-800">
          {d?.detection ?? messageText(msg)}
        </p>
        {d?.expectedState ? (
          <>
            <div className="mt-2 text-[11px] font-medium text-slate-500">
              期待する状態
            </div>
            <p className="text-xs leading-relaxed text-slate-800">
              {d.expectedState}
            </p>
          </>
        ) : null}
        {d?.currentState ? (
          <>
            <div className="mt-2 text-[11px] font-medium text-slate-500">
              現在の状態
            </div>
            <p className="text-xs leading-relaxed text-slate-800">
              {d.currentState}
            </p>
          </>
        ) : null}
        {causes.length > 0 ? (
          <>
            <div className="mt-2 text-[11px] font-medium text-slate-500">
              推定原因
            </div>
            <ul className="mt-0.5 space-y-1">
              {causes.map((c) => (
                <li
                  key={c.label}
                  className="flex items-baseline justify-between gap-2 text-xs text-slate-800"
                >
                  <span>{c.label}</span>
                  <span className="shrink-0 font-medium text-slate-600">
                    信頼度 {c.confidence}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {improvements.length > 0 ? (
          <>
            <div className="mt-2 text-[11px] font-medium text-slate-500">
              改善案
            </div>
            <ul className="mt-0.5 list-disc space-y-1 pl-4 text-xs text-slate-800">
              {improvements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        ) : null}
        {fixTargets.length > 0 ? (
          <>
            <div className="mt-2 text-[11px] font-medium text-slate-500">
              修正対象
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {fixTargets.map((t) => (
                <span
                  key={t}
                  className="rounded border border-slate-400 bg-white px-1.5 py-0.5 text-[10px] text-slate-800"
                >
                  {t}
                </span>
              ))}
            </div>
          </>
        ) : null}
        <div className="mt-2 text-[11px] font-medium text-slate-500">
          自動修復
        </div>
        <p className="text-xs text-slate-800">
          {d?.autoRepairable
            ? `可能 — ${d.autoRepairLabel ?? d.repairKind ?? "安全な修復"}`
            : "不可 — Role Prompt / Schema / プロンプト変更は手動（Cursor修正案を使用）"}
        </p>
        {showCursor && cursorPrompt ? (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-slate-300 bg-white p-2 font-mono text-[10px] leading-relaxed text-slate-800">
            {cursorPrompt}
          </pre>
        ) : null}
        {!ignored && status === "open" ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {cursorPrompt ? (
              <>
                <button
                  type="button"
                  className="rounded border border-indigo-600 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-950"
                  onClick={() => setShowCursor((v) => !v)}
                >
                  {showCursor ? "修正候補を閉じる" : "修正候補を見る"}
                </button>
                <button
                  type="button"
                  className="rounded border border-indigo-700 bg-indigo-700 px-2 py-0.5 text-[11px] text-white"
                  onClick={() => void copyCursorPrompt()}
                >
                  {copied ? "コピー済" : "Cursor修正案をコピー"}
                </button>
              </>
            ) : null}
            {d?.autoRepairable ? (
              <button
                type="button"
                disabled={busy || !d}
                className="rounded border border-emerald-700 bg-emerald-700 px-2 py-0.5 text-[11px] text-white disabled:opacity-50"
                onClick={() => d && onRepair(d.id, "confirm")}
              >
                自動修復
                {d.autoRepairLabel ? `（${d.autoRepairLabel}）` : ""}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || !d}
              className="rounded border border-stone-400 bg-white px-2 py-0.5 text-[11px] text-stone-700 disabled:opacity-50"
              onClick={() => d && onRepair(d.id, "ignore")}
            >
              無視
            </button>
          </div>
        ) : null}
      </div>
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
    activeTheme:
      typeof data.activeTheme === "string" ? data.activeTheme : undefined,
    activeThemeLabel:
      typeof data.activeThemeLabel === "string"
        ? data.activeThemeLabel
        : undefined,
    unresolvedIssues: Array.isArray(data.unresolvedIssues)
      ? (data.unresolvedIssues as unknown[])
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.slice(0, 80))
          .slice(0, 12)
      : [],
    resolvedIssues: Array.isArray(data.resolvedIssues)
      ? (data.resolvedIssues as unknown[])
          .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
          .map((d) => d.slice(0, 80))
          .slice(0, 12)
      : [],
    ceoQuestions: Array.isArray(data.ceoQuestions)
      ? (data.ceoQuestions as CeoQuestion[]).filter(
          (q) =>
            q &&
            typeof q.id === "string" &&
            typeof q.text === "string" &&
            (q.status === "OPEN" ||
              q.status === "ANSWERED" ||
              q.status === "RESOLVED" ||
              q.status === "PARKED"),
        )
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
    debugger:
      data.debugger && typeof data.debugger === "object"
        ? (data.debugger as DebuggerPublic)
        : { mode: "PASSIVE", findings: [], repairLog: [], openCount: 0 },
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
  const [debugLogOpen, setDebugLogOpen] = useState(false);

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
      | "cancel_end"
      | "set_debugger_mode"
      | "debugger_repair"
      | "debugger_ignore",
    extra?: {
      debuggerMode?: "OFF" | "PASSIVE" | "ACTIVE";
      findingId?: string;
      repairAction?: "auto" | "confirm" | "ignore";
    },
  ) {
    setBusyInterrupt(true);
    setError("");
    if (action === "pause") abortInFlight();

    const res = await fetch(`/api/meetings/${meetingId}/discuss/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
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

  function handleDebuggerRepair(
    findingId: string,
    repairAction: "auto" | "confirm" | "ignore",
  ) {
    void runControl(
      repairAction === "ignore" ? "debugger_ignore" : "debugger_repair",
      { findingId, repairAction },
    );
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
  const debuggerMode = wall.debugger?.mode ?? "PASSIVE";
  const showDebugHistory =
    debugLogOpen && debuggerMode !== "OFF";

  return (
    <div className="flex min-h-[32rem] flex-col rounded border border-stone-300 bg-stone-50 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-stone-300 bg-white px-4 py-3">
        <div className="text-sm font-semibold text-stone-900">
          AI壁打ち会議 — ライブ役員会
        </div>
        <p className="mt-1 text-xs text-stone-600">
          役員同士の議論を深めます。企画者は必要なときだけ。同じ提案の繰り返しは禁止。いつでも下の入力から割り込めます。
          {wall.ended ? (
            <span className="ml-2 font-medium text-emerald-800">（終了）</span>
          ) : null}
          {wall.paused ? (
            <span className="ml-2 font-medium text-amber-800">（一時停止中）</span>
          ) : null}
        </p>
        {wall.activeThemeLabel || wall.activeTheme ? (
          <div className="mt-3 rounded border border-stone-800 bg-stone-900 px-3 py-2 text-stone-50">
            <div className="text-[11px] font-semibold tracking-wide text-stone-300">
              現在のテーマ
            </div>
            <div className="mt-1 text-base font-semibold">
              {wall.activeThemeLabel ?? wall.activeTheme}
            </div>
            <p className="mt-1 text-[11px] text-stone-400">
              テーマは1つ。視点は複数。全員が専門から発言。議論に固定順序はありません。
            </p>
          </div>
        ) : null}
        {(() => {
          const unresolved =
            wall.unresolvedIssues && wall.unresolvedIssues.length > 0
              ? wall.unresolvedIssues
              : (wall.openTopics ?? [])
                  .filter((t) => t.status !== "resolved")
                  .map((t) => t.label);
          const resolved =
            wall.resolvedIssues && wall.resolvedIssues.length > 0
              ? wall.resolvedIssues
              : (wall.openTopics ?? [])
                  .filter((t) => t.status === "resolved")
                  .map((t) => t.label);
          const hasMemory =
            unresolved.length > 0 ||
            resolved.length > 0 ||
            (wall.decisions && wall.decisions.length > 0) ||
            (wall.rejectedItems && wall.rejectedItems.length > 0);
          if (!hasMemory) return null;
          return (
          <div className="mt-3 space-y-2 rounded border border-stone-200 bg-stone-50 px-3 py-2">
            <div className="text-[11px] font-semibold tracking-wide text-stone-500">
              会議メモリ（CEOが毎ターン更新）
            </div>
            {unresolved.length > 0 ? (
              <div>
                <div className="text-[11px] font-medium text-amber-900">
                  未解決Issue
                </div>
                <ul className="mt-1.5 flex flex-wrap gap-2">
                  {unresolved.map((label, index) => (
                    <li
                      key={`u-${label}-${index}`}
                      className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950"
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {resolved.length > 0 ? (
              <div>
                <div className="text-[11px] font-medium text-emerald-800">
                  解決済みIssue
                </div>
                <ul className="mt-1.5 flex flex-wrap gap-2">
                  {resolved.map((label, index) => (
                    <li
                      key={`r-${label}-${index}`}
                      className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-950"
                    >
                      ✓ {label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {wall.decisions && wall.decisions.length > 0 ? (
              <div>
                <div className="text-[11px] font-medium text-stone-700">
                  決定事項（前提）
                </div>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {wall.decisions.map((item) => (
                    <li
                      key={item}
                      className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-800"
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
          </div>
          );
        })()}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span className="font-medium text-stone-800">
            企画 Version{currentVersion}
          </span>
          {planVersions.length > 1 ? (
            <span>
              履歴: {planVersions.map((v) => `V${v.version}`).join(" → ")}
            </span>
          ) : null}
          <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-600">
            AIデバッガー
            <select
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
              value={wall.debugger?.mode ?? "PASSIVE"}
              disabled={busyInterrupt}
              onChange={(e) =>
                void runControl("set_debugger_mode", {
                  debuggerMode: e.target.value as "OFF" | "PASSIVE" | "ACTIVE",
                })
              }
            >
              <option value="OFF">OFF</option>
              <option value="PASSIVE">PASSIVE</option>
              <option value="ACTIVE">ACTIVE</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
            onClick={() => setDebugLogOpen((v) => !v)}
          >
            デバッグ履歴
            {(wall.debugger?.openCount ?? 0) > 0
              ? ` (${wall.debugger?.openCount})`
              : ""}
          </button>
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

          if (
            msg.kind === "diagnostic" ||
            msg.messageType === "ai_debugger" ||
            msg.messageType === "debug_summary"
          ) {
            if ((wall.debugger?.mode ?? "PASSIVE") === "OFF") return null;
            return (
              <DiagnosticCard
                key={msg.id ?? `dbg-${index}`}
                msg={msg}
                busy={busyInterrupt}
                onRepair={handleDebuggerRepair}
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
                  {(() => {
                    const arrow = addressArrowLabel({
                      targetType: msg.targetType,
                      targetParticipantId: msg.targetParticipantId,
                      addressTo: msg.addressTo,
                      addressRoleKey: msg.addressRoleKey,
                    });
                    return arrow ? <span>{arrow}</span> : null;
                  })()}
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

      {showDebugHistory ? (
        <aside className="flex max-h-[40rem] w-full shrink-0 flex-col border-t border-slate-300 bg-slate-50 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
          <div className="border-b border-slate-300 px-3 py-2">
            <div className="text-[11px] font-semibold tracking-wide text-slate-600">
              デバッグ履歴
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              未対応 {wall.debugger?.openCount ?? 0}件 · {debuggerMode}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 text-[11px] text-slate-800">
            {(wall.debugger?.findings ?? []).length === 0 ? (
              <p className="px-1 text-slate-500">まだ検知はありません。</p>
            ) : (
              (wall.debugger?.findings ?? [])
                .slice()
                .reverse()
                .map((f) => {
                  const topCause =
                    f.estimatedCauses?.[0]?.label ?? f.causes?.[0] ?? f.ruleId;
                  const done =
                    f.status.includes("repair") || f.status === "ignored";
                  return (
                    <div
                      key={f.id}
                      className="mb-2 rounded border border-slate-200 bg-white px-2 py-1.5"
                    >
                      <div className="text-[10px] text-slate-500">
                        {f.createdAt?.slice(11, 19) ?? "--:--:--"} ·{" "}
                        {f.severity}
                      </div>
                      <div className="mt-0.5 font-medium text-slate-900">
                        {f.title}
                      </div>
                      <div className="mt-0.5 text-slate-700">原因: {topCause}</div>
                      <div className="mt-0.5">
                        {done ? (
                          <span className="text-emerald-700">
                            {f.status === "ignored" ? "無視" : "改善済み"}
                          </span>
                        ) : (
                          <span className="text-amber-800">未対応</span>
                        )}
                      </div>
                      {(f.fixTargets ?? []).length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-0.5">
                          {f.fixTargets!.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              className="rounded bg-slate-100 px-1 text-[9px] text-slate-700"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
