/**
 * AI Debugger — internal audit agent for wall-chat meetings.
 * Not a participant; emits diagnostic cards only when anomalies are detected.
 */

import { isSimilarPoint, normalizeText, similarityScore } from "@/lib/ai/dedupe";
import type { ReviewLevel } from "@/lib/ai/role-focus";
import type { CeoQuestion, DiscussionTopic } from "@/lib/ai/schemas";
import { pickPerspectiveOfficer } from "@/lib/meeting/discussion-themes";
import { randomUUID } from "crypto";

export type DebuggerMode = "OFF" | "PASSIVE" | "ACTIVE";
export type DebuggerSeverity = "info" | "warning" | "critical";

export type RepairKind =
  | "suppress_duplicate_chair"
  | "discard_stale_response"
  | "block_reopen_resolved"
  | "refresh_plan_version"
  | "reselect_next_speaker"
  | "block_repeat_question"
  | "rebuild_meeting_memory"
  | "park_numeric_questions";

export type FixTarget =
  | "CEO Prompt"
  | "Role Prompt"
  | "Issue Manager"
  | "Meeting Memory"
  | "Speaker Router"
  | "JSON Schema"
  | "Validator"
  | "Theme Manager"
  | "Abort / Generation"
  | "Plan Version";

export type CauseEstimate = {
  label: string;
  confidence: number;
};

export type FindingStatus =
  | "open"
  | "auto_repaired"
  | "confirmed_repaired"
  | "ignored";

export type DebuggerFinding = {
  id: string;
  ruleId: string;
  severity: DebuggerSeverity;
  title: string;
  detection: string;
  /** Expected healthy meeting behavior */
  expectedState: string;
  /** What is actually happening now */
  currentState: string;
  /** Ranked root-cause hypotheses with confidence 0–100 */
  estimatedCauses: CauseEstimate[];
  /** Developer-actionable improvement steps */
  improvements: string[];
  /** Where to change code / prompts */
  fixTargets: FixTarget[];
  /** Paste-ready prompt for Cursor */
  cursorPrompt: string;
  /** Human label for safe auto-repair, or null if not auto-fixable */
  autoRepairLabel: string | null;
  /** @deprecated prefer estimatedCauses */
  causes: string[];
  impact: string;
  /** @deprecated prefer improvements */
  recommendations: string[];
  relatedMessageIds: string[];
  relatedIssueIds: string[];
  relatedPlanVersion: number | null;
  autoRepairable: boolean;
  repairKind: RepairKind | null;
  status: FindingStatus;
  createdAt: string;
  repairedAt?: string | null;
  fingerprint: string;
};

export type RepairLogEntry = {
  at: string;
  findingId: string;
  action: "auto" | "confirm" | "ignore";
  note: string;
  repairKind?: RepairKind | null;
};

export type QualityScores = {
  duplicateRate: number;
  advanceRate: number;
  proposerDependencyRate: number;
  issueResolutionRate: number;
  misrouteCount: number;
  reviewToneRate: number;
  staleVersionRate: number;
  avgLoopLength: number;
  autoRepairCount: number;
  proposerOverAskCount: number;
  totalFindings: number;
  openFindings: number;
};

export type DebuggerState = {
  mode: DebuggerMode;
  findings: DebuggerFinding[];
  repairLog: RepairLogEntry[];
  scores: QualityScores;
  lastAnalyzedMessageCount: number;
  seenFingerprints: string[];
};

export type DebuggerMessageLike = {
  id?: string;
  speakerType?: string;
  roleKey?: string | null;
  title?: string;
  text?: string;
  content?: string;
  kind?: string;
  moveType?: string;
  messageType?: string | null;
  nominateReason?: string;
  addressTo?: string;
  addressRoleKey?: string | null;
  proposalVersion?: number | null;
  createdAt?: string;
};

export type AnalyzeContext = {
  messages: DebuggerMessageLike[];
  activeTheme: string;
  unresolvedIssues: string[];
  resolvedIssues: string[];
  openTopics: DiscussionTopic[];
  ceoQuestions: CeoQuestion[];
  decisions: string[];
  rejectedItems: string[];
  currentVersion: number;
  reviewLevel: ReviewLevel;
  lastFacilitatorAction?: string | null;
  lastRoutedRole?: string | null;
  lastAskerRole?: string | null;
  facilitatorJsonFailed?: boolean;
  staleResponseDiscarded?: boolean;
  apiTimeout?: boolean;
  duplicateResponseDetected?: boolean;
};

const REVIEW_TONE =
  /(良い点|懸念点|改善案|期待効果|まとめ|検討が必要|重要な論点|比較実験)/;
const ROI_NUMERIC =
  /(ROI|利益率|回収期間|IRR|NPV|投資対効果|円の利益|％の利益|パーセントの利益)/i;
const ROLE_HINTS: Record<string, RegExp> = {
  cfo: /(費用|コスト|利益|収益|損失|予算|回収|ROI|売上)/i,
  marketing: /(訴求|獲得|購入|マーケ|認知|ブランド|チャネル)/i,
  customer: /(顧客|利用者|払|分かり|体験|心理)/i,
  cto: /(開発|実装|技術|システム|API|工数)/i,
  operations: /(運用|現場|負荷|スタッフ|オペ)/i,
};

export function emptyQualityScores(): QualityScores {
  return {
    duplicateRate: 0,
    advanceRate: 0,
    proposerDependencyRate: 0,
    issueResolutionRate: 0,
    misrouteCount: 0,
    reviewToneRate: 0,
    staleVersionRate: 0,
    avgLoopLength: 0,
    autoRepairCount: 0,
    proposerOverAskCount: 0,
    totalFindings: 0,
    openFindings: 0,
  };
}

export function createDebuggerState(
  mode: DebuggerMode = "PASSIVE",
): DebuggerState {
  return {
    mode,
    findings: [],
    repairLog: [],
    scores: emptyQualityScores(),
    lastAnalyzedMessageCount: 0,
    seenFingerprints: [],
  };
}

export function parseDebuggerState(raw: unknown): DebuggerState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createDebuggerState("PASSIVE");
  }
  const data = raw as Record<string, unknown>;
  const mode =
    data.mode === "OFF" || data.mode === "PASSIVE" || data.mode === "ACTIVE"
      ? data.mode
      : "PASSIVE";
  const base = createDebuggerState(mode);
  if (Array.isArray(data.findings)) {
    base.findings = data.findings
      .filter(
        (f): f is DebuggerFinding =>
          Boolean(f) &&
          typeof f === "object" &&
          typeof (f as DebuggerFinding).id === "string" &&
          typeof (f as DebuggerFinding).ruleId === "string",
      )
      .map((f) => hydrateFinding(f as DebuggerFinding));
  }
  if (Array.isArray(data.repairLog)) {
    base.repairLog = data.repairLog as RepairLogEntry[];
  }
  if (data.scores && typeof data.scores === "object") {
    base.scores = { ...emptyQualityScores(), ...(data.scores as QualityScores) };
  }
  if (typeof data.lastAnalyzedMessageCount === "number") {
    base.lastAnalyzedMessageCount = data.lastAnalyzedMessageCount;
  }
  if (Array.isArray(data.seenFingerprints)) {
    base.seenFingerprints = data.seenFingerprints.filter(
      (s): s is string => typeof s === "string",
    );
  }
  return base;
}

function msgText(m: DebuggerMessageLike): string {
  return (m.text ?? m.content ?? "").trim();
}

function isChat(m: DebuggerMessageLike): boolean {
  return (
    m.kind !== "diagnostic" &&
    m.kind !== "plan_update" &&
    m.kind !== "thinking" &&
    m.kind !== "brief_summary" &&
    m.speakerType !== "system"
  );
}

function chatOnly(messages: DebuggerMessageLike[]): DebuggerMessageLike[] {
  return messages.filter(isChat);
}

type RulePlaybook = {
  expectedState: string;
  estimatedCauses: CauseEstimate[];
  improvements: string[];
  fixTargets: FixTarget[];
  impact: string;
  autoRepairLabel: string | null;
  repairKind: RepairKind | null;
  cursorPrompt: (args: {
    detection: string;
    title: string;
    theme?: string;
    extra?: string;
  }) => string;
};

const REPAIR_LABELS: Record<RepairKind, string> = {
  suppress_duplicate_chair: "重複CEO発言の抑止",
  discard_stale_response: "古いAPI応答の破棄",
  block_reopen_resolved: "解決済みIssueの再オープン防止",
  refresh_plan_version: "企画Versionの最新化",
  reselect_next_speaker: "Speaker再選定",
  block_repeat_question: "同一質問の再送禁止 / Issue状態更新",
  rebuild_meeting_memory: "会議メモリ再構築",
  park_numeric_questions: "数値論点をPARKEDへ移動",
};

export function repairKindLabel(kind: RepairKind | null | undefined): string | null {
  if (!kind) return null;
  return REPAIR_LABELS[kind] ?? kind;
}

function cursorBlock(args: {
  title: string;
  detection: string;
  expected: string;
  improvements: string[];
  targets: FixTarget[];
}): string {
  return [
    "【Cursor修正プロンプト — AI壁打ち会議】",
    "",
    `問題: ${args.title}`,
    `検知: ${args.detection}`,
    "",
    "期待する状態:",
    args.expected,
    "",
    "以下へ修正してください。",
    ...args.improvements.map((s, i) => `${i + 1}. ${s}`),
    "",
    `修正対象: ${args.targets.join(" / ")}`,
    "",
    "制約:",
    "- 企画内容・役員意見の削除はしない",
    "- Issueの強制RESOLVEDはしない",
    "- 会議を長くする変更は避ける",
    "- 既存の会議メモリ構造（activeTheme / unresolvedIssues / resolvedIssues）を壊さない",
  ].join("\n");
}

const RULE_PLAYBOOKS: Record<string, RulePlaybook> = {
  api_timeout: {
    expectedState: "API応答は generationId と整合し、タイムアウト時は進行が安全に再開できる。",
    estimatedCauses: [
      { label: "モデル応答遅延 / ネットワーク", confidence: 88 },
      { label: "AbortSignal 未処理パス", confidence: 72 },
      { label: "maxDuration 不足", confidence: 54 },
    ],
    improvements: [
      "`speakDiscussionTurn` / `prepareDiscussionTurn` で AbortError 時に debugger の discard_stale を確実に呼ぶ。",
      "クライアントの AbortController と loopGenerationRef の破棄条件を見直す（`DiscussionChat.tsx`）。",
      "必要なら route の maxDuration を延長し、タイムアウト時は短いシステムメッセージのみ出す。",
    ],
    fixTargets: ["Abort / Generation", "Validator"],
    impact: "ターン欠落で会議が止まる",
    autoRepairLabel: REPAIR_LABELS.discard_stale_response,
    repairKind: "discard_stale_response",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "タイムアウト時は stale を破棄し、次ターンを再開できる。",
        improvements: [
          "AbortError 経路で activeGenerationId / pendingSpeak を必ずクリアする。",
          "DiscussionChat で aborted/stale 時にループを止めず、ユーザー操作で再開可能にする。",
        ],
        targets: ["Abort / Generation", "Validator"],
      }),
  },
  schema_violation_hint: {
    expectedState: "司会JSONは discussionFacilitatorSchema を満たし、失敗してもメモリを壊さない。",
    estimatedCauses: [
      { label: "JSON Schema とプロンプト出力例の不一致", confidence: 90 },
      { label: "配列が soft-cap を超えパース失敗", confidence: 74 },
      { label: "モデル不安定による不正フィールド", confidence: 61 },
    ],
    improvements: [
      "`discussionFacilitatorSchema` と `prompts.discussionFacilitatorUser` の JSON例を完全一致させる。",
      "`unresolvedIssues` / `resolvedIssues` / `activeTheme` の preprocess を確認し、空文字を落とす。",
      "失敗時フォールバック後に `rebuild_meeting_memory` 相当の同期を入れる。",
    ],
    fixTargets: ["JSON Schema", "CEO Prompt", "Meeting Memory"],
    impact: "指名品質低下・ループ増加",
    autoRepairLabel: REPAIR_LABELS.rebuild_meeting_memory,
    repairKind: "rebuild_meeting_memory",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "司会JSONが毎ターンスキーマ通りに返り、失敗時も会議メモリが整合する。",
        improvements: [
          "src/lib/ai/schemas.ts の discussionFacilitatorSchema と prompts.ts の出力例を揃える。",
          "facilitator 失敗フォールバックで unresolvedIssues/resolvedIssues を openTopics から再構築する。",
        ],
        targets: ["JSON Schema", "CEO Prompt", "Meeting Memory"],
      }),
  },
  duplicate_response: {
    expectedState: "同一 generation の発言はタイムラインに1回だけ載る。",
    estimatedCauses: [
      { label: "stale 応答の二重反映", confidence: 86 },
      { label: "generationId 競合", confidence: 79 },
      { label: "speak の二重呼び出し", confidence: 63 },
    ],
    improvements: [
      "`speakDiscussionTurn` で直前発言と同一 text なら pushMessage せず discard する。",
      "クライアントで generationId 不一致レスポンスを summary にマージしない。",
      "pendingSpeak クリア後の再エントリをガードする。",
    ],
    fixTargets: ["Abort / Generation", "Validator"],
    impact: "ループ判定ノイズ・タイムライン汚染",
    autoRepairLabel: REPAIR_LABELS.discard_stale_response,
    repairKind: "discard_stale_response",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "同一レスポンスは1回だけ表示される。",
        improvements: [
          "speakDiscussionTurn で直前 board_member 発言と完全一致なら破棄する。",
          "DiscussionChat の stale/aborted で applySummary をスキップする条件を強化する。",
        ],
        targets: ["Abort / Generation", "Validator"],
      }),
  },
  stale_discarded: {
    expectedState: "割り込み後は古い応答が破棄され、最新 generation だけが残る。",
    estimatedCauses: [
      { label: "割り込みによる generation 更新（正常）", confidence: 92 },
      { label: "Abort 後の遅延レスポンス", confidence: 70 },
    ],
    improvements: [
      "対応不要。必要ならデバッグログに info として残すだけで十分。",
    ],
    fixTargets: ["Abort / Generation"],
    impact: "なし（正常な防御）",
    autoRepairLabel: null,
    repairKind: null,
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "古い応答は破棄され会議は継続する。",
        improvements: ["追加修正は不要。ログ品質だけ確認する。"],
        targets: ["Abort / Generation"],
      }),
  },
  repeat_question: {
    expectedState: "同一趣旨の質問は1回。回答後は ANSWERED/RESOLVED になり再送しない。",
    estimatedCauses: [
      { label: "Issue / ceoQuestions 状態未更新", confidence: 91 },
      { label: "企画者回答が会議メモリ未反映", confidence: 78 },
      { label: "CEO Prompt の再質問抑止不足", confidence: 66 },
    ],
    improvements: [
      "`CHAIR_FACILITATOR_RULES` に『RESOLVED/ANSWERED と同趣旨の再質問禁止』を再強調する。",
      "`guardRepeatedCeoQuestion` の類似度閾値と openTopics 同期を見直す。",
      "企画者回答後に関連 OPEN を ANSWERED へ更新する処理を強化する（`markOpenQuestionsAnswered`）。",
    ],
    fixTargets: ["CEO Prompt", "Issue Manager", "Meeting Memory", "Validator"],
    impact: "企画者疲弊・会話ループ",
    autoRepairLabel: REPAIR_LABELS.block_repeat_question,
    repairKind: "block_repeat_question",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "同じ質問を繰り返さず、回答を前提に次の視点へ進む。",
        improvements: [
          "src/lib/ai/role-focus.ts の CHAIR_FACILITATOR_RULES に再質問禁止を明記する。",
          "run-discussion.ts の guardRepeatedCeoQuestion で類似 OPEN/ANSWERED/RESOLVED を確実にブロックする。",
          "企画者発言後に ceoQuestions を ANSWERED へ更新する。",
        ],
        targets: ["CEO Prompt", "Issue Manager", "Meeting Memory"],
      }),
  },
  repeat_ceo_instruction: {
    expectedState: "CEOの指示は毎回新しい前進（別視点指名・テーマ整理）を含む。",
    estimatedCauses: [
      { label: "Meeting Memory 未更新", confidence: 84 },
      { label: "nominateReason 固定", confidence: 77 },
      { label: "ループ検知不足", confidence: 60 },
    ],
    improvements: [
      "CEOの chairUtterance 生成前に直前CEO発言との類似度チェックを入れ、類似なら発話を出さない。",
      "`applyThemeFacilitation` 停滞時は broadenPerspectiveUtterance で別役員へ振る。",
      "CEO Prompt に『同じ促しの連続禁止』を追加する。",
    ],
    fixTargets: ["CEO Prompt", "Speaker Router", "Meeting Memory"],
    impact: "議論が前進しない",
    autoRepairLabel: REPAIR_LABELS.suppress_duplicate_chair,
    repairKind: "suppress_duplicate_chair",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "CEOは重複指示を出さず、別視点へ広げる。",
        improvements: [
          "prepareDiscussionTurn で直前CEO発話と類似なら chairUtterance を空にする（既存抑止を強化）。",
          "CHAIR_FACILITATOR_RULES に同一指示連続禁止を追加する。",
        ],
        targets: ["CEO Prompt", "Speaker Router"],
      }),
  },
  repeat_proposal: {
    expectedState: "似た改善案は1回。accept/advance で次論点へ進む。",
    estimatedCauses: [
      { label: "rejectedItems / decisions 未参照", confidence: 85 },
      { label: "Role Prompt の前進指示不足", confidence: 73 },
      { label: "moveType accept/advance 誘導不足", confidence: 62 },
    ],
    improvements: [
      "`DISCUSSION_RULES` に『却下・決定を踏まえ同じ提案の言い換え禁止』を追加する。",
      "役員 utterance プロンプトで decisions/rejectedItems を強調表示する（既存を強化）。",
      "同じ alternative が続く場合、CEOが accept/advance を促すルールを追加する。",
    ],
    fixTargets: ["Role Prompt", "CEO Prompt", "Meeting Memory"],
    impact: "時間の浪費",
    autoRepairLabel: null,
    repairKind: null,
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "却下・決定を前提に新しい角度だけ出す。",
        improvements: [
          "DISCUSSION_RULES と conversationMemberSystem に再提案禁止を明記する。",
          "utterance ユーザープロンプトで rejectedItems を『再提案禁止リスト』として強調する。",
        ],
        targets: ["Role Prompt", "Meeting Memory"],
      }),
  },
  rediscuss_resolved: {
    expectedState: "解決済みIssueは閉じたまま。議論は未解決Issueのみ。",
    estimatedCauses: [
      { label: "Issue状態未更新 / resolvedIssues未参照", confidence: 89 },
      { label: "Theme管理ミス", confidence: 71 },
      { label: "Role Prompt のメモリ遵守不足", confidence: 58 },
    ],
    improvements: [
      "役員プロンプトに『resolvedIssues は再議論禁止』を明示する。",
      "`applyThemeFacilitation` / utterance 前に resolved 類似テキストを検知したらCEOが止める。",
      "Meeting Memory UI とプロンプト双方で解決済みを渡す（欠落がないか確認）。",
    ],
    fixTargets: ["Issue Manager", "Meeting Memory", "Role Prompt", "Theme Manager"],
    impact: "解決済み再オープン",
    autoRepairLabel: REPAIR_LABELS.block_reopen_resolved,
    repairKind: "block_reopen_resolved",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "解決済みIssueは再議論しない。",
        improvements: [
          "discussionUtteranceUser に resolvedIssues を渡し、再議論禁止を明記する。",
          "run-discussion で resolved 類似発言時に block_reopen_resolved を適用する。",
        ],
        targets: ["Issue Manager", "Meeting Memory", "Role Prompt"],
      }),
  },
  rereject_proposal: {
    expectedState: "rejectedItems は再提案禁止。別角度のみ許可。",
    estimatedCauses: [
      { label: "rejectedItems がプロンプト未到達", confidence: 90 },
      { label: "Role Prompt 弱化", confidence: 76 },
      { label: "類似度ガード不足", confidence: 64 },
    ],
    improvements: [
      "`DISCUSSION_RULES` の却下再提案禁止例を増やし、utterance 毎に rejectedItems を必ず渡す。",
      "発言後に rejected 類似ならCEOが『却下前提で別角度』と介入するルールを追加する。",
      "会議メモリ再構築で rejectedItems と openTopics の整合を取る。",
    ],
    fixTargets: ["Role Prompt", "Meeting Memory", "CEO Prompt"],
    impact: "却下決定の無効化",
    autoRepairLabel: REPAIR_LABELS.rebuild_meeting_memory,
    repairKind: "rebuild_meeting_memory",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "却下済み案は再提案されない。",
        improvements: [
          "DISCUSSION_RULES に具体例付きで再提案禁止を追加する。",
          "runDiscussionUtterance の入力に rejectedItems を必須表示する。",
        ],
        targets: ["Role Prompt", "Meeting Memory"],
      }),
  },
  ignore_proposer_answer: {
    expectedState: "企画者回答後は評価→accept/advance。同趣旨の再質問をしない。",
    estimatedCauses: [
      { label: "Issue状態が OPEN のまま", confidence: 88 },
      { label: "回答評価（accept）誘導不足", confidence: 80 },
      { label: "CEO の ask_proposer 連発", confidence: 67 },
    ],
    improvements: [
      "役員プロンプトに『企画者回答後はまず評価し、十分なら accept』を追加する。",
      "CEO Prompt で ask_proposer の連続を禁止し、ANSWERED 質問の再送を止める。",
      "`markOpenQuestionsAnswered` 後に関連 openTopics を discussing→resolved 候補にする。",
    ],
    fixTargets: ["Role Prompt", "CEO Prompt", "Issue Manager"],
    impact: "企画者依存率上昇",
    autoRepairLabel: REPAIR_LABELS.block_repeat_question,
    repairKind: "block_repeat_question",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "企画者の回答を受け入れ、次の論点へ進む。",
        improvements: [
          "DISCUSSION_RULES の『回答があったとき』を役員 utterance に再掲する。",
          "CEO が ANSWERED 質問を再送しないよう guard を強化する。",
        ],
        targets: ["Role Prompt", "CEO Prompt", "Issue Manager"],
      }),
  },
  misroute_to_proposer: {
    expectedState: "役員が答えられる内容は nominate。企画者は未提示事実のみ。",
    estimatedCauses: [
      { label: "Speaker Router が役職名依存", confidence: 87 },
      { label: "officer-first ルール未適用", confidence: 81 },
      { label: "CEO Prompt の ask_proposer 過多", confidence: 69 },
    ],
    improvements: [
      "`applyContentRoutingGuard` の officer-first 条件を広げ、技術/運用/顧客心理は必ず nominate にする。",
      "CEO Prompt に『仮定で議論できるなら ask_proposer 禁止』を追加する。",
      "routingKind から nextSpeaker へのマップをテストで固定する。",
    ],
    fixTargets: ["Speaker Router", "CEO Prompt"],
    impact: "企画者依存",
    autoRepairLabel: REPAIR_LABELS.reselect_next_speaker,
    repairKind: "reselect_next_speaker",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "役員同士で仮定議論し、未提示事実だけ企画者へ聞く。",
        improvements: [
          "applyContentRoutingGuard で officer-answerable キーワードなら ask_proposer を nominate に変換する。",
          "CHAIR_FACILITATOR_RULES の優先順位を再掲し ask_proposer を稀にする。",
        ],
        targets: ["Speaker Router", "CEO Prompt"],
      }),
  },
  bounce_to_asker: {
    expectedState: "質問した本人へ同じ問いを返さない。別役員へ振る。",
    estimatedCauses: [
      { label: "Speaker Router ガード漏れ", confidence: 93 },
      { label: "nominateReason 固定", confidence: 70 },
      { label: "facilitator 出力の nextSpeaker 偏り", confidence: 61 },
    ],
    improvements: [
      "`applyContentRoutingGuard` の asker 一致禁止を最終段でも再適用する。",
      "CEO Prompt に『質問者本人への回し返し禁止』を残し、品質テストにケースを追加する。",
      "forcedNextRoleKey 再選定で asker を除外する。",
    ],
    fixTargets: ["Speaker Router", "CEO Prompt", "Validator"],
    impact: "自己問答ループ",
    autoRepairLabel: REPAIR_LABELS.reselect_next_speaker,
    repairKind: "reselect_next_speaker",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "質問者本人以外の役員が答える。",
        improvements: [
          "run-discussion.ts で nextSpeaker === asker を最終的に必ず潰す。",
          "check-ai-quality / check-ai-debugger に bounce ケースを残す。",
        ],
        targets: ["Speaker Router", "Validator"],
      }),
  },
  off_current_issue: {
    expectedState: "現在テーマの解決に役立つ視点だけ話す（関連視点は許可）。",
    estimatedCauses: [
      { label: "Theme管理ミス", confidence: 82 },
      { label: "Role Prompt のテーマ拘束不足", confidence: 74 },
      { label: "CEO の脱線止め不足", confidence: 55 },
    ],
    improvements: [
      "役員プロンプトの『現在のテーマ』節に『無関係な余談禁止。ただし根拠としての顧客・ブランド・コストは許可』を明記する。",
      "CEO Prompt で明示的余談のみ軽く戻す（関連視点は park しない）。",
    ],
    fixTargets: ["Theme Manager", "Role Prompt", "CEO Prompt"],
    impact: "論点拡散",
    autoRepairLabel: null,
    repairKind: null,
    cursorPrompt: ({ detection, title, theme }) =>
      cursorBlock({
        title,
        detection,
        expected: `テーマ「${theme ?? "現在テーマ"}」の解決に役立つ発言だけをする。`,
        improvements: [
          "discussionUtteranceUser にテーマ拘束ルールを追記する。",
          "関連視点（顧客・ブランド・コスト）は利益テーマでも許可する旨を残す。",
        ],
        targets: ["Theme Manager", "Role Prompt"],
      }),
  },
  over_nominate: {
    expectedState: "全役員が現在テーマを専門視点から発言する（特定役員の専有禁止）。",
    estimatedCauses: [
      { label: "Role Prompt弱化（テーマ専有の誤解）", confidence: 91 },
      { label: "Speaker Router のローテーション不足", confidence: 84 },
      { label: "Theme管理ミス", confidence: 76 },
    ],
    improvements: [
      "Role Prompt / DISCUSSION_RULES へ『利益テーマでは全役員が専門視点から発言する。CFO専有ではない』を追加する。",
      "`pickAnyOfficer` の recent ウィンドウを広げ、同一 role の連続上限をコードで強制する。",
      "CEO Prompt に『未発言役員へ広げる』を毎ターン必須にする。",
    ],
    fixTargets: ["Role Prompt", "Speaker Router", "CEO Prompt", "Theme Manager"],
    impact: "多視点喪失・ループ",
    autoRepairLabel: REPAIR_LABELS.reselect_next_speaker,
    repairKind: "reselect_next_speaker",
    cursorPrompt: ({ detection, title, theme }) =>
      cursorBlock({
        title,
        detection,
        expected: `テーマ「${theme ?? "利益性"}」について全役員が専門視点から議論する。`,
        improvements: [
          "src/lib/ai/role-focus.ts の CHAIR_FACILITATOR_RULES / DISCUSSION_RULES に『テーマは1つ、視点は複数。特定役員の専有禁止』を追加する。",
          "discussion-themes.ts の pickAnyOfficer で同一 role の連続を制限する。",
          "役員プロンプトに『現在テーマを自分の専門から語る』を明記する。",
        ],
        targets: ["Role Prompt", "Speaker Router", "CEO Prompt"],
      }),
  },
  conversation_loop: {
    expectedState: "毎ターン議論が1歩前進（新視点 / accept / advance）。",
    estimatedCauses: [
      { label: "Meeting Memory 未更新", confidence: 86 },
      { label: "同一論点の反復", confidence: 81 },
      { label: "Speaker Router 偏り", confidence: 70 },
    ],
    improvements: [
      "ループ検知時に unresolvedIssues を1つに絞り、CEOが『この1点だけ』と宣言するルールを追加する。",
      "会議メモリ再構築を走らせ openTopics と issue リストを同期する。",
      "役員へ accept/advance を促す chairUtterance テンプレを追加する。",
    ],
    fixTargets: ["Meeting Memory", "CEO Prompt", "Speaker Router", "Issue Manager"],
    impact: "会議長期化・品質低下",
    autoRepairLabel: REPAIR_LABELS.rebuild_meeting_memory,
    repairKind: "rebuild_meeting_memory",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "ループせず、未解決Issueを1つずつ閉じて前進する。",
        improvements: [
          "conversation_loop 検知時に rebuild_meeting_memory + テーマ絞り込みを行う。",
          "CEO Prompt にループ時の『1論点集中』手順を書く。",
        ],
        targets: ["Meeting Memory", "CEO Prompt", "Issue Manager"],
      }),
  },
  role_mismatch: {
    expectedState: "各役員は現在テーマを、自分の専門視点から語る。",
    estimatedCauses: [
      { label: "Role Prompt弱化", confidence: 91 },
      { label: "テーマ専有の誤解", confidence: 76 },
      { label: "getRoleFocus 未適用", confidence: 58 },
    ],
    improvements: [
      "該当 role の Role Prompt（`getRoleFocus` / ROLE_FOCUS）に『現在テーマへの専門角度』例を追加する。",
      "会話用プロンプトへ『専門外だけの発言は避け、テーマへの自視点を1つ入れる』を追加する。",
      "例（利益テーマ）: CFO=ROI、マーケ=購入率、顧客=払う気、CTO=開発費、現場=運用コスト。",
    ],
    fixTargets: ["Role Prompt", "CEO Prompt"],
    impact: "多視点の価値低下",
    autoRepairLabel: null,
    repairKind: null,
    cursorPrompt: ({ detection, title, theme, extra }) =>
      cursorBlock({
        title,
        detection,
        expected: `テーマ「${theme ?? "利益性"}」について、各役員が専門視点から発言する。`,
        improvements: [
          `Role Prompt（${extra ?? "該当ロール"}）へ『現在テーマでは自分の専門から必ず一言入れる』を追加する。`,
          "利益テーマでは全役員が専門視点から発言する（CFOだけが話すのではない）と明記する。",
          "src/lib/ai/role-focus.ts の ROLE_FOCUS と DISCUSSION_RULES を更新する。",
        ],
        targets: ["Role Prompt", "CEO Prompt"],
      }),
  },
  immature_roi_demand: {
    expectedState: "experiment では仮説・価値・方向性。具体ROI数値要求は禁止。不足はPARKED。",
    estimatedCauses: [
      { label: "成熟度ガイド未適用", confidence: 92 },
      { label: "CFO Role Prompt 過剰 / Theme専有", confidence: 80 },
      { label: "formatReviewLevelGuidance 未参照", confidence: 65 },
    ],
    improvements: [
      "`ROLE_FOCUS.cfo` と DISCUSSION_RULES に experiment 禁止例を追記済みか確認する。",
      "数値要求の ceoQuestions を PARKED にし、構造確認へ戻す自動修復を有効化する。",
      "CEO Prompt で『具体数字を企画者へ』連発を禁止する。",
    ],
    fixTargets: ["Role Prompt", "CEO Prompt", "Issue Manager", "Validator"],
    impact: "アイデア議論の退化・会議停止",
    autoRepairLabel: REPAIR_LABELS.park_numeric_questions,
    repairKind: "park_numeric_questions",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "experiment では具体ROI数値を求めず、仮説と価値を議論する。数値はPARKED。",
        improvements: [
          "role-focus.ts の成熟度節を強化する。",
          "数値OPEN質問をPARKEDへ移し、多視点の構造確認へ戻す。",
        ],
        targets: ["Role Prompt", "Issue Manager", "Validator"],
      }),
  },
  review_tone: {
    expectedState: "自然な口語のみ。見出し・箇条書き・レビュー口調は禁止。",
    estimatedCauses: [
      { label: "会話プロンプト漏れ / Step2混入", confidence: 90 },
      { label: "REVIEW_LIKE_BANNED 不足", confidence: 78 },
      { label: "Role Prompt にレビュー例が残存", confidence: 60 },
    ],
    improvements: [
      "`discussionUtteranceSchema` の REVIEW_LIKE_BANNED に検知された見出し語を追加する。",
      "conversation 用システムプロンプトからレビューテンプレを完全排除する。",
      "失敗時はモデルに口語へ言い換え再生成させる（既存 superRefine を活かす）。",
    ],
    fixTargets: ["Role Prompt", "JSON Schema", "Validator"],
    impact: "壁打ちがレビュー化する",
    autoRepairLabel: null,
    repairKind: null,
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "1〜3文の口語だけを返す。",
        improvements: [
          "schemas.ts の REVIEW_LIKE_BANNED を拡張する。",
          "prompts.discussionUtteranceUser の禁止見出しリストを同期する。",
        ],
        targets: ["JSON Schema", "Role Prompt", "Validator"],
      }),
  },
  memory_inconsistency: {
    expectedState: "unresolvedIssues / resolvedIssues / openTopics が常に同期している。",
    estimatedCauses: [
      { label: "二重管理の同期漏れ", confidence: 94 },
      { label: "facilitator 出力の片方欠落", confidence: 77 },
      { label: "applyMeetingMemory の空配列上書き", confidence: 68 },
    ],
    improvements: [
      "`applyMeetingMemory` で openTopics と issue リストを双方向同期するヘルパーを1つにまとめる。",
      "facilitator スキーマで片方だけ空のとき既存値を保持する（既存ガードを強化）。",
      "自動修復 `rebuild_meeting_memory` を ACTIVE で許可する。",
    ],
    fixTargets: ["Meeting Memory", "Issue Manager", "JSON Schema"],
    impact: "終了判定・テーマ選択の狂い",
    autoRepairLabel: REPAIR_LABELS.rebuild_meeting_memory,
    repairKind: "rebuild_meeting_memory",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "Issueリストと openTopics の status が一致する。",
        improvements: [
          "run-discussion.ts の applyMeetingMemory に同期ヘルパーを追加する。",
          "ai-debugger の rebuild_meeting_memory を単一の正とする。",
        ],
        targets: ["Meeting Memory", "Issue Manager"],
      }),
  },
  stale_plan_version: {
    expectedState: "全員が最新 currentVersion の企画だけを前提にする。",
    estimatedCauses: [
      { label: "企画更新後の前提未切替", confidence: 90 },
      { label: "プロンプトに旧サマリ残存", confidence: 72 },
      { label: "Version 告知不足", confidence: 58 },
    ],
    improvements: [
      "役員プロンプト先頭に `必ず Version N のみ` を固定表示する。",
      "旧 Version 言及を検知したらCEOが最新Versionを再告知する（refresh_plan_version）。",
      "plan_update カード後の最初の nominateReason に Version を含める。",
    ],
    fixTargets: ["Plan Version", "CEO Prompt", "Role Prompt"],
    impact: "旧版への議論後退",
    autoRepairLabel: REPAIR_LABELS.refresh_plan_version,
    repairKind: "refresh_plan_version",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "最新企画Versionだけを前提に話す。",
        improvements: [
          "discussionUtteranceUser で currentVersion を強調する。",
          "stale version 検知時に CEO が最新Versionを宣言する処理を確認する。",
        ],
        targets: ["Plan Version", "Role Prompt", "CEO Prompt"],
      }),
  },
  status_transition: {
    expectedState: "RESOLVED 質問は再掲しない。OPEN→ANSWERED→RESOLVED が一方向。",
    estimatedCauses: [
      { label: "状態遷移ガード漏れ", confidence: 92 },
      { label: "Issue Manager / ceoQuestions 未更新", confidence: 81 },
      { label: "CEO Prompt の再掲", confidence: 66 },
    ],
    improvements: [
      "`guardRepeatedCeoQuestion` で RESOLVED 類似を必ずブロックする。",
      "CEO Prompt の質問ボード規則を再掲し、テストケースを追加する。",
      "自動修復で関連 OPEN を ANSWERED にする（RESOLVED 強制はしない）。",
    ],
    fixTargets: ["Issue Manager", "CEO Prompt", "Validator"],
    impact: "解決済みの再オープン",
    autoRepairLabel: REPAIR_LABELS.block_repeat_question,
    repairKind: "block_repeat_question",
    cursorPrompt: ({ detection, title }) =>
      cursorBlock({
        title,
        detection,
        expected: "RESOLVED は再質問されない。",
        improvements: [
          "guardRepeatedCeoQuestion の RESOLVED 判定を強化する。",
          "check-ai-debugger に status_transition ケースを維持する。",
        ],
        targets: ["Issue Manager", "Validator", "CEO Prompt"],
      }),
  },
};

function finding(partial: {
  ruleId: string;
  severity: DebuggerSeverity;
  title: string;
  detection: string;
  fingerprint: string;
  relatedMessageIds?: string[];
  relatedIssueIds?: string[];
  relatedPlanVersion?: number | null;
  causes?: string[];
  impact?: string;
  recommendations?: string[];
  autoRepairable?: boolean;
  repairKind?: RepairKind | null;
  expectedState?: string;
  currentState?: string;
  estimatedCauses?: CauseEstimate[];
  improvements?: string[];
  fixTargets?: FixTarget[];
  cursorPrompt?: string;
  autoRepairLabel?: string | null;
  theme?: string;
  roleExtra?: string;
}): DebuggerFinding {
  const pb = RULE_PLAYBOOKS[partial.ruleId];
  const estimatedCauses =
    partial.estimatedCauses ??
    pb?.estimatedCauses ??
    (partial.causes ?? []).map((label, i) => ({
      label,
      confidence: Math.max(40, 90 - i * 12),
    }));
  const improvements =
    partial.improvements ?? pb?.improvements ?? partial.recommendations ?? [];
  const fixTargets = partial.fixTargets ?? pb?.fixTargets ?? ["Validator"];
  const expectedState =
    partial.expectedState ?? pb?.expectedState ?? "会議が自然に前進している。";
  const repairKind =
    partial.repairKind !== undefined
      ? partial.repairKind
      : (pb?.repairKind ?? null);
  const autoRepairable =
    partial.autoRepairable ?? Boolean(repairKind && pb?.autoRepairLabel);
  const autoRepairLabel =
    partial.autoRepairLabel !== undefined
      ? partial.autoRepairLabel
      : autoRepairable
        ? (pb?.autoRepairLabel ?? repairKindLabel(repairKind))
        : null;
  const cursorPrompt =
    partial.cursorPrompt ??
    pb?.cursorPrompt({
      detection: partial.detection,
      title: partial.title,
      theme: partial.theme,
      extra: partial.roleExtra,
    }) ??
    cursorBlock({
      title: partial.title,
      detection: partial.detection,
      expected: expectedState,
      improvements,
      targets: fixTargets,
    });

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "open",
    ruleId: partial.ruleId,
    severity: partial.severity,
    title: partial.title,
    detection: partial.detection,
    expectedState,
    currentState: partial.currentState ?? partial.detection,
    estimatedCauses,
    improvements,
    fixTargets,
    cursorPrompt,
    autoRepairLabel,
    causes: estimatedCauses.map((c) => c.label),
    impact: partial.impact ?? pb?.impact ?? "",
    recommendations: improvements,
    relatedMessageIds: partial.relatedMessageIds ?? [],
    relatedIssueIds: partial.relatedIssueIds ?? [],
    relatedPlanVersion: partial.relatedPlanVersion ?? null,
    autoRepairable,
    repairKind,
    fingerprint: partial.fingerprint,
  };
}

function fingerprint(ruleId: string, key: string): string {
  return `${ruleId}:${normalizeText(key).slice(0, 80)}`;
}

/** Fill new fields for findings persisted before the improvement-assistant format. */
export function hydrateFinding(raw: DebuggerFinding): DebuggerFinding {
  if (
    raw.expectedState &&
    raw.estimatedCauses?.length &&
    raw.improvements?.length &&
    raw.cursorPrompt
  ) {
    return {
      ...raw,
      autoRepairLabel:
        raw.autoRepairLabel ??
        (raw.autoRepairable ? repairKindLabel(raw.repairKind) : null),
    };
  }
  const pb = RULE_PLAYBOOKS[raw.ruleId];
  const estimatedCauses =
    raw.estimatedCauses?.length > 0
      ? raw.estimatedCauses
      : (raw.causes ?? []).map((label, i) => ({
          label,
          confidence: Math.max(40, 90 - i * 12),
        }));
  const improvements =
    raw.improvements?.length > 0
      ? raw.improvements
      : raw.recommendations?.length
        ? raw.recommendations
        : (pb?.improvements ?? []);
  const fixTargets =
    raw.fixTargets?.length > 0
      ? raw.fixTargets
      : (pb?.fixTargets ?? ["Validator"]);
  const expectedState =
    raw.expectedState || pb?.expectedState || "会議が自然に前進している。";
  return {
    ...raw,
    expectedState,
    currentState: raw.currentState || raw.detection,
    estimatedCauses:
      estimatedCauses.length > 0
        ? estimatedCauses
        : (pb?.estimatedCauses ?? [{ label: "不明", confidence: 40 }]),
    improvements:
      improvements.length > 0
        ? improvements
        : ["該当ルールのプレイブックを確認する。"],
    fixTargets,
    cursorPrompt:
      raw.cursorPrompt ||
      pb?.cursorPrompt({
        detection: raw.detection,
        title: raw.title,
      }) ||
      cursorBlock({
        title: raw.title,
        detection: raw.detection,
        expected: expectedState,
        improvements,
        targets: fixTargets,
      }),
    autoRepairLabel:
      raw.autoRepairLabel ??
      (raw.autoRepairable ? repairKindLabel(raw.repairKind) : null),
  };
}

/** Detect anomalies for the latest turn. Returns at most a few new findings. */
export function analyzeDiscussionTurn(
  ctx: AnalyzeContext,
  debuggerState: DebuggerState,
): DebuggerFinding[] {
  if (debuggerState.mode === "OFF") return [];

  const chats = chatOnly(ctx.messages);
  const recent = chats.slice(-12);
  const last = recent[recent.length - 1];
  if (!last && !ctx.facilitatorJsonFailed && !ctx.apiTimeout) return [];

  const out: DebuggerFinding[] = [];
  const push = (f: DebuggerFinding) => {
    if (debuggerState.seenFingerprints.includes(f.fingerprint)) return;
    if (out.some((x) => x.fingerprint === f.fingerprint)) return;
    out.push(f);
  };

  // 19. API timeout
  if (ctx.apiTimeout) {
    push(
      finding({
        ruleId: "api_timeout",
        severity: "critical",
        title: "API応答停止・タイムアウト",
        detection: "API応答が停止またはタイムアウトしました。",
        causes: ["ネットワーク遅延", "モデル応答遅延", "AbortSignal発火"],
        impact: "ターンが欠落し、会議が止まる可能性がある",
        recommendations: ["進行を再開", "古い応答は破棄"],
        relatedMessageIds: last?.id ? [last.id] : [],
        relatedIssueIds: [],
        relatedPlanVersion: ctx.currentVersion,
        autoRepairable: true,
        repairKind: "discard_stale_response",
        fingerprint: fingerprint("api_timeout", "timeout"),
      }),
    );
  }

  // 18. JSON schema / facilitator failure hint
  if (ctx.facilitatorJsonFailed) {
    push(
      finding({
        ruleId: "schema_violation_hint",
        severity: "warning",
        title: "JSON schema違反の予兆",
        detection: "司会JSONの再生成に失敗し、フォールバック指名へ落ちました。",
        causes: ["出力がスキーマ外", "長すぎる配列", "モデル不安定"],
        impact: "指名品質が落ち、ループや誤ルーティングが増える",
        recommendations: ["フォールバック継続を許可", "会議メモリを再構築"],
        relatedMessageIds: [],
        relatedIssueIds: [],
        relatedPlanVersion: ctx.currentVersion,
        autoRepairable: true,
        repairKind: "rebuild_meeting_memory",
        fingerprint: fingerprint("schema_violation_hint", "facilitator"),
      }),
    );
  }

  // 20. Duplicate response
  if (ctx.duplicateResponseDetected || (recent.length >= 2 && msgText(recent[recent.length - 1]!) === msgText(recent[recent.length - 2]!))) {
    const a = recent[recent.length - 1]!;
    const b = recent[recent.length - 2];
    push(
      finding({
        ruleId: "duplicate_response",
        severity: "warning",
        title: "同一レスポンスの二重表示",
        detection: "同じ文言の発言が連続して記録されています。",
        causes: ["stale応答の反映", "二重speak", "generationId競合"],
        impact: "タイムラインがノイズ化しループ判定が狂う",
        recommendations: ["古いAPI応答を破棄", "二重表示を無視"],
        relatedMessageIds: [a.id, b?.id].filter(Boolean) as string[],
        relatedIssueIds: [],
        relatedPlanVersion: ctx.currentVersion,
        autoRepairable: true,
        repairKind: "discard_stale_response",
        fingerprint: fingerprint("duplicate_response", msgText(a).slice(0, 40)),
      }),
    );
  }

  if (ctx.staleResponseDiscarded) {
    push(
      finding({
        ruleId: "stale_discarded",
        severity: "info",
        title: "古いAPI応答を破棄",
        detection: "generationId不一致のため古い応答を破棄しました。",
        causes: ["割り込み", "Abort", "ループ世代更新"],
        impact: "正しい進行を維持（正常な防御）",
        recommendations: ["対応不要（自動破棄済）"],
        relatedMessageIds: [],
        relatedIssueIds: [],
        relatedPlanVersion: ctx.currentVersion,
        autoRepairable: false,
        repairKind: null,
        fingerprint: fingerprint("stale_discarded", String(Date.now()).slice(0, -4)),
      }),
    );
  }

  if (!last) return prioritizeFindings(out);

  const lastText = msgText(last);

  // 1. Repeated same question (chair / ask_proposer / questions)
  const questionLike = chats
    .filter(
      (m) =>
        m.speakerType === "chair" ||
        m.messageType === "ask_proposer" ||
        m.moveType === "question" ||
        (m.addressTo === "proposer" && /[？?]/.test(msgText(m))),
    )
    .slice(-8);
  if (questionLike.length >= 3) {
    const probe = msgText(questionLike[questionLike.length - 1]!);
    const hits = questionLike.filter((m) =>
      isSimilarPoint(msgText(m), probe, 0.55),
    );
    if (hits.length >= 3) {
      push(
        finding({
          ruleId: "repeat_question",
          severity: "warning",
          title: "同一質問の繰り返し",
          detection: `「${probe.slice(0, 40)}」系の質問が直近で${hits.length}回繰り返されています。`,
          causes: [
            "Issue状態が更新されていない",
            "企画者回答が共有メモリに反映されていない",
            "古いnextSpeaker候補が再利用されている",
          ],
          impact: "会議がループし、企画者が疲弊する",
          recommendations: [
            "対象質問をANSWEREDへ更新",
            "役員へ回答評価を依頼",
            "企画者への再質問を停止",
          ],
          relatedMessageIds: hits.map((h) => h.id!).filter(Boolean),
          relatedIssueIds: ctx.ceoQuestions
            .filter((q) => q.status === "OPEN" || q.status === "ANSWERED")
            .map((q) => q.id)
            .slice(0, 3),
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "block_repeat_question",
          fingerprint: fingerprint("repeat_question", probe),
        }),
      );
    }
  }

  // 9. Same CEO instruction consecutive
  const chairs = chats.filter((m) => m.speakerType === "chair").slice(-4);
  if (chairs.length >= 2) {
    const a = msgText(chairs[chairs.length - 1]!);
    const b = msgText(chairs[chairs.length - 2]!);
    if (isSimilarPoint(a, b, 0.6)) {
      push(
        finding({
          ruleId: "repeat_ceo_instruction",
          severity: "warning",
          title: "CEOによる同じ指示の連続",
          detection: "CEOの指示内容が連続してほぼ同一です。",
          causes: ["メモリ未更新", "nominateReason固定", "ループ検知漏れ"],
          impact: "議論が前進せず、同じ促しが続く",
          recommendations: ["重複CEO発言を抑止", "別視点の役員へ再選定"],
          relatedMessageIds: chairs
            .slice(-2)
            .map((c) => c.id!)
            .filter(Boolean),
          relatedIssueIds: [],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "suppress_duplicate_chair",
          fingerprint: fingerprint("repeat_ceo_instruction", a),
        }),
      );
    }
  }

  // 2. Same proposal paraphrase
  const proposals = chats
    .filter(
      (m) =>
        (m.speakerType === "board_member" || m.speakerType === "executive") &&
        (m.moveType === "alternative" || m.moveType === "expand"),
    )
    .slice(-6);
  if (proposals.length >= 3) {
    const probe = msgText(proposals[proposals.length - 1]!);
    const hits = proposals.filter((m) => isSimilarPoint(msgText(m), probe, 0.55));
    if (hits.length >= 3) {
      push(
        finding({
          ruleId: "repeat_proposal",
          severity: "warning",
          title: "同一提案の言い換え反復",
          detection: `似た提案が${hits.length}回繰り返されています。`,
          causes: ["却下/決定メモリ未参照", "前進moveType不足"],
          impact: "同じ改善案の言い換えで時間を消費",
          recommendations: ["決定/却下を確認", "accept/advanceへ誘導"],
          relatedMessageIds: hits.map((h) => h.id!).filter(Boolean),
          relatedIssueIds: [],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: false,
          repairKind: null,
          fingerprint: fingerprint("repeat_proposal", probe),
        }),
      );
    }
  }

  // 3. Re-discuss resolved issue
  if (lastText && ctx.resolvedIssues.length > 0) {
    const hit = ctx.resolvedIssues.find((label) =>
      isSimilarPoint(lastText, label, 0.5),
    );
    if (hit && last.speakerType !== "chair") {
      push(
        finding({
          ruleId: "rediscuss_resolved",
          severity: "warning",
          title: "解決済みIssueの再議論",
          detection: `解決済み「${hit}」に近い内容が再議論されています。`,
          causes: ["resolvedIssues未参照", "テーマ変更時のメモリ漏れ"],
          impact: "解決済みを再オープンし前進が止まる",
          recommendations: ["解決済みの再オープンを防止", "未解決Issueへ戻す"],
          relatedMessageIds: last.id ? [last.id] : [],
          relatedIssueIds: [hit],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "block_reopen_resolved",
          fingerprint: fingerprint("rediscuss_resolved", hit),
        }),
      );
    }
  }

  // 4. Rejected re-proposal
  if (lastText && ctx.rejectedItems.length > 0) {
    const hit = ctx.rejectedItems.find((item) =>
      isSimilarPoint(lastText, item, 0.5),
    );
    if (hit) {
      push(
        finding({
          ruleId: "rereject_proposal",
          severity: "critical",
          title: "却下済み案の再提案",
          detection: `却下済み「${hit}」に近い提案が出ています。`,
          causes: ["rejectedItems未参照", "プロンプト不整合"],
          impact: "却下決定が無効化される",
          recommendations: ["却下事項を前提に別角度へ", "会議メモリを再構築"],
          relatedMessageIds: last.id ? [last.id] : [],
          relatedIssueIds: [hit],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "rebuild_meeting_memory",
          fingerprint: fingerprint("rereject_proposal", hit),
        }),
      );
    }
  }

  // 5. Ignoring proposer answer
  const lastProposerIdx = [...chairs.length ? chats : chats]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find(
      ({ m }) => m.speakerType === "proposer" || m.speakerType === "user",
    )?.i;
  if (lastProposerIdx !== undefined) {
    const after = chats.slice(lastProposerIdx + 1, lastProposerIdx + 5);
    const proposerText = msgText(chats[lastProposerIdx]!);
    const ignored = after.filter(
      (m) =>
        m.moveType === "question" &&
        m.addressTo === "proposer" &&
        isSimilarPoint(msgText(m), proposerText, 0.35),
    );
    // Stronger: officers ask similar question to what was just answered
    const openQs = ctx.ceoQuestions.filter((q) => q.status === "ANSWERED");
    const reask = after.some(
      (m) =>
        (m.speakerType === "chair" || m.addressTo === "proposer") &&
        openQs.some((q) => isSimilarPoint(msgText(m), q.text, 0.55)),
    );
    if (ignored.length > 0 || reask) {
      push(
        finding({
          ruleId: "ignore_proposer_answer",
          severity: "warning",
          title: "企画者回答の無視",
          detection: "企画者の回答後に同趣旨の再質問が出ています。",
          causes: ["ANSWERED未更新", "回答評価の欠如"],
          impact: "企画者依存が上がり議論が進まない",
          recommendations: [
            "対象IssueをANSWERED/RESOLVEDへ",
            "役員に回答評価を依頼",
          ],
          relatedMessageIds: after.map((m) => m.id!).filter(Boolean).slice(0, 4),
          relatedIssueIds: openQs.map((q) => q.id).slice(0, 3),
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "block_repeat_question",
          fingerprint: fingerprint("ignore_proposer_answer", proposerText.slice(0, 40)),
        }),
      );
    }
  }

  // 6. Officer-answerable asked to proposer
  if (
    ctx.lastFacilitatorAction === "ask_proposer" &&
    last.speakerType === "chair"
  ) {
    const text = lastText;
    const officerRoutable =
      /(技術|実装|開発|運用|現場|ブランド|顧客心理|ROI計算|費用対効果)/.test(
        text,
      ) && !/(価格はいくら|無料にする|何人想定|予算上限は)/.test(text);
    if (officerRoutable) {
      push(
        finding({
          ruleId: "misroute_to_proposer",
          severity: "warning",
          title: "他役員が答えられる質問を企画者へ",
          detection: "役員で議論可能な内容が企画者へ振られています。",
          causes: ["ルーティングが役職名依存", "officer-first未適用"],
          impact: "企画者依存率が上がる",
          recommendations: ["nextSpeakerを再選定", "役員同士で仮定議論"],
          relatedMessageIds: last.id ? [last.id] : [],
          relatedIssueIds: [],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "reselect_next_speaker",
          fingerprint: fingerprint("misroute_to_proposer", text.slice(0, 40)),
        }),
      );
    }
  }

  // 7. Bounce question to asker
  if (
    ctx.lastAskerRole &&
    ctx.lastRoutedRole &&
    ctx.lastAskerRole === ctx.lastRoutedRole &&
    ctx.lastFacilitatorAction === "nominate"
  ) {
    push(
      finding({
        ruleId: "bounce_to_asker",
        severity: "critical",
        title: "質問者本人へ質問を返す",
        detection: `直前の発言者（${ctx.lastAskerRole}）へ同じ問いが戻されています。`,
        causes: ["ルーティングガード漏れ", "nominateReason固定"],
        impact: "会話が自己問答になり前進しない",
        recommendations: ["nextSpeakerを再選定", "別視点の役員へ"],
        relatedMessageIds: last.id ? [last.id] : [],
        relatedIssueIds: [],
        relatedPlanVersion: ctx.currentVersion,
        autoRepairable: true,
        repairKind: "reselect_next_speaker",
        fingerprint: fingerprint("bounce_to_asker", ctx.lastAskerRole),
      }),
    );
  }

  // 8. Off-current-issue (soft — only clear mismatch)
  if (
    lastText &&
    (last.speakerType === "board_member" || last.speakerType === "executive") &&
    ctx.unresolvedIssues.length > 0
  ) {
    const theme = ctx.activeTheme;
    const related =
      isSimilarPoint(lastText, theme, 0.25) ||
      ctx.unresolvedIssues.some((i) => isSimilarPoint(lastText, i, 0.35)) ||
      ctx.decisions.some((d) => isSimilarPoint(lastText, d, 0.4)) ||
      similarityScore(lastText, theme) > 0.15 ||
      /だから|それなら|なるほど|次は|前提/.test(lastText);
    const clearlyOther =
      !related &&
      /(別件ですが|話は変わりますが|余談ですが)/.test(lastText);
    if (clearlyOther) {
      push(
        finding({
          ruleId: "off_current_issue",
          severity: "info",
          title: "現在Issueと無関係な発言",
          detection: `現在テーマ「${theme}」と明示的に無関係な脱線を検知しました。`,
          causes: ["テーマロック不足", "役員が別論点を開始"],
          impact: "論点が散らばる（関連視点なら許容）",
          recommendations: ["現在テーマへ戻す", "脱線をIssueへ控える"],
          relatedMessageIds: last.id ? [last.id] : [],
          relatedIssueIds: ctx.unresolvedIssues.slice(0, 2),
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: false,
          repairKind: null,
          fingerprint: fingerprint("off_current_issue", lastText.slice(0, 40)),
        }),
      );
    }
  }

  // 10. Over-nominate / Theme monopoly (same officer 3+ in window)
  const nominees = chats
    .filter((m) => m.speakerType === "board_member" || m.speakerType === "executive")
    .slice(-8)
    .map((m) => m.roleKey)
    .filter(Boolean) as string[];
  if (nominees.length >= 3) {
    const counts = new Map<string, number>();
    for (const r of nominees) counts.set(r, (counts.get(r) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const unique = counts.size;
    if (top && (top[1] >= 3 || (unique <= 2 && top[1] >= 3))) {
      push(
        finding({
          ruleId: "over_nominate",
          severity: "warning",
          title: "Theme役職専有を検知",
          detection: `${top[0]} が直近${nominees.length}発言中${top[1]}回中心。テーマ「${ctx.activeTheme}」が役職専有になっています。`,
          currentState: `テーマ「${ctx.activeTheme}」で ${top[0]} に指名が偏り、他視点が不足`,
          relatedMessageIds: [],
          relatedIssueIds: [],
          relatedPlanVersion: ctx.currentVersion,
          fingerprint: fingerprint("over_nominate", top[0]),
          theme: ctx.activeTheme,
          roleExtra: top[0],
        }),
      );
    }
  }

  // 11. Conversation loop (low advance + high similarity)
  const window = recent.slice(-8);
  if (window.length >= 6) {
    let similarPairs = 0;
    let pairs = 0;
    for (let i = 0; i < window.length; i += 1) {
      for (let j = i + 1; j < window.length; j += 1) {
        pairs += 1;
        if (isSimilarPoint(msgText(window[i]!), msgText(window[j]!), 0.5)) {
          similarPairs += 1;
        }
      }
    }
    const advances = window.filter(
      (m) => m.moveType === "accept" || m.moveType === "advance",
    ).length;
    const dupRate = pairs > 0 ? similarPairs / pairs : 0;
    if (dupRate >= 0.25 && advances <= 1) {
      push(
        finding({
          ruleId: "conversation_loop",
          severity: "critical",
          title: "会話ループを検知",
          detection: `直近${window.length}ターンで類似発言が多く、前進（accept/advance）がほぼありません。`,
          causes: ["同一論点の反復", "メモリ未更新", "ルーティング偏り"],
          impact: "会議が長くなり品質が落ちる",
          recommendations: [
            "会議メモリを再構築",
            "未解決Issueを1つに絞る",
            "accept/advanceを促す",
          ],
          relatedMessageIds: window.map((m) => m.id!).filter(Boolean).slice(0, 6),
          relatedIssueIds: ctx.unresolvedIssues.slice(0, 3),
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "rebuild_meeting_memory",
          fingerprint: fingerprint("conversation_loop", "loop"),
        }),
      );
    }
  }

  // 12. Role / utterance mismatch
  if (
    last.roleKey &&
    ROLE_HINTS[last.roleKey] &&
    lastText.length > 20 &&
    (last.speakerType === "board_member" || last.speakerType === "executive")
  ) {
    const hint = ROLE_HINTS[last.roleKey]!;
    const otherHints = Object.entries(ROLE_HINTS).filter(([k]) => k !== last.roleKey);
    const ownHit = hint.test(lastText);
    const otherHit = otherHitsOnly(lastText, otherHints);
    if (!ownHit && otherHit && last.moveType !== "accept" && last.moveType !== "advance") {
      push(
        finding({
          ruleId: "role_mismatch",
          severity: "info",
          title: "役員人格と発言内容の不一致",
          detection: `${last.roleKey} の発言が専門領域から外れています（テーマ「${ctx.activeTheme}」）。`,
          currentState: `${last.roleKey} がテーマ「${ctx.activeTheme}」で専門外の話をしている`,
          relatedMessageIds: last.id ? [last.id] : [],
          relatedIssueIds: [],
          relatedPlanVersion: ctx.currentVersion,
          fingerprint: fingerprint("role_mismatch", `${last.roleKey}:${lastText.slice(0, 30)}`),
          theme: ctx.activeTheme,
          roleExtra: last.roleKey ?? undefined,
        }),
      );
    }
  }

  // 13. Inappropriate numeric demand for maturity
  if (
    ctx.reviewLevel === "experiment" &&
    ROI_NUMERIC.test(lastText) &&
    /いくら|何％|算出|計算|示して|教えて/.test(lastText)
  ) {
    push(
      finding({
        ruleId: "immature_roi_demand",
        severity: "warning",
        title: "企画成熟度に不適切な数値要求",
        detection: "experiment段階で具体的なROI/回収の数値要求が出ています。",
        relatedMessageIds: last.id ? [last.id] : [],
        relatedIssueIds: [],
        relatedPlanVersion: ctx.currentVersion,
        fingerprint: fingerprint("immature_roi_demand", lastText.slice(0, 40)),
        theme: ctx.activeTheme,
      }),
    );
  }

  // 14. Review tone relapse
  if (REVIEW_TONE.test(lastText) && last.speakerType !== "chair") {
    push(
      finding({
        ruleId: "review_tone",
        severity: "warning",
        title: "レビュー口調への逆戻り",
        detection: "見出し・レビュー口調の発言を検知しました。",
        causes: ["会話プロンプト漏れ", "Step2テンプレ混入"],
        impact: "自然な壁打ちがレビュー会議化する",
        recommendations: ["口語の一文へ言い換え", "スキーマ禁止を強化"],
        relatedMessageIds: last.id ? [last.id] : [],
        relatedIssueIds: [],
        relatedPlanVersion: ctx.currentVersion,
        autoRepairable: false,
        repairKind: null,
        fingerprint: fingerprint("review_tone", lastText.slice(0, 40)),
      }),
    );
  }

  // 15. Memory vs conversation inconsistency
  const openLabels = new Set(
    ctx.openTopics.filter((t) => t.status !== "resolved").map((t) => t.label),
  );
  for (const label of ctx.unresolvedIssues) {
    const topic = ctx.openTopics.find((t) => t.label === label);
    if (topic && topic.status === "resolved") {
      push(
        finding({
          ruleId: "memory_inconsistency",
          severity: "warning",
          title: "会議メモリと会話の不整合",
          detection: `「${label}」が未解決リストにあるのに openTopics では resolved です。`,
          causes: ["二重管理の同期漏れ"],
          impact: "終了判定やテーマ選択が狂う",
          recommendations: ["会議メモリを再構築"],
          relatedMessageIds: [],
          relatedIssueIds: [label],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "rebuild_meeting_memory",
          fingerprint: fingerprint("memory_inconsistency", label),
        }),
      );
      break;
    }
  }
  for (const label of ctx.resolvedIssues) {
    if (openLabels.has(label)) {
      push(
        finding({
          ruleId: "memory_inconsistency",
          severity: "info",
          title: "会議メモリと会話の不整合",
          detection: `「${label}」は解決済みだが openTopics では未解決のままです。`,
          causes: ["openTopics未同期"],
          impact: "終了条件が満たされない",
          recommendations: ["会議メモリを再構築"],
          relatedMessageIds: [],
          relatedIssueIds: [label],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "rebuild_meeting_memory",
          fingerprint: fingerprint("memory_inconsistency", `open:${label}`),
        }),
      );
      break;
    }
  }

  // 16. Stale plan version reference
  const verMatch = lastText.match(/Version\s*(\d+)|V(\d+)/i);
  if (verMatch) {
    const mentioned = Number(verMatch[1] ?? verMatch[2]);
    if (mentioned > 0 && mentioned < ctx.currentVersion) {
      push(
        finding({
          ruleId: "stale_plan_version",
          severity: "warning",
          title: "古い企画Versionを参照",
          detection: `発言が Version ${mentioned} を参照しています（現行は ${ctx.currentVersion}）。`,
          causes: ["企画更新後の前提未切替"],
          impact: "旧版へ議論が戻る",
          recommendations: ["企画Versionを最新化", "現行サマリを再共有"],
          relatedMessageIds: last.id ? [last.id] : [],
          relatedIssueIds: [],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "refresh_plan_version",
          fingerprint: fingerprint("stale_plan_version", String(mentioned)),
        }),
      );
    }
  }

  // 17. CEO question status transition issues
  const resolvedQs = ctx.ceoQuestions.filter((q) => q.status === "RESOLVED");
  if (last.speakerType === "chair" && lastText) {
    const reaskResolved = resolvedQs.find((q) =>
      isSimilarPoint(lastText, q.text, 0.55),
    );
    if (reaskResolved) {
      push(
        finding({
          ruleId: "status_transition",
          severity: "critical",
          title: "質問状態遷移の不整合",
          detection: `RESOLVED質問「${reaskResolved.text.slice(0, 30)}」が再掲されています。`,
          causes: ["ガード漏れ", "状態ボード未更新"],
          impact: "解決済みが再オープンする",
          recommendations: ["同一質問の再送禁止", "RESOLVEDを維持"],
          relatedMessageIds: last.id ? [last.id] : [],
          relatedIssueIds: [reaskResolved.id],
          relatedPlanVersion: ctx.currentVersion,
          autoRepairable: true,
          repairKind: "block_repeat_question",
          fingerprint: fingerprint("status_transition", reaskResolved.id),
        }),
      );
    }
  }

  return prioritizeFindings(out);
}

function otherHitsOnly(
  text: string,
  others: Array<[string, RegExp]>,
): boolean {
  return others.some(([, re]) => re.test(text));
}

function prioritizeFindings(findings: DebuggerFinding[]): DebuggerFinding[] {
  const rank: Record<DebuggerSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return [...findings]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, 2);
}

export function mergeFindings(
  state: DebuggerState,
  incoming: DebuggerFinding[],
): DebuggerFinding[] {
  const added: DebuggerFinding[] = [];
  for (const f of incoming) {
    if (state.seenFingerprints.includes(f.fingerprint)) continue;
    if (state.findings.some((x) => x.fingerprint === f.fingerprint && x.status === "open")) {
      continue;
    }
    state.findings = [...state.findings, f].slice(-40);
    state.seenFingerprints = [...state.seenFingerprints, f.fingerprint].slice(
      -80,
    );
    added.push(f);
  }
  return added;
}

export function computeQualityScores(
  ctx: AnalyzeContext,
  state: DebuggerState,
): QualityScores {
  const chats = chatOnly(ctx.messages);
  const recent = chats.slice(-20);
  let similarPairs = 0;
  let pairs = 0;
  for (let i = 0; i < recent.length; i += 1) {
    for (let j = i + 1; j < recent.length; j += 1) {
      pairs += 1;
      if (isSimilarPoint(msgText(recent[i]!), msgText(recent[j]!), 0.5)) {
        similarPairs += 1;
      }
    }
  }
  const advances = chats.filter(
    (m) => m.moveType === "accept" || m.moveType === "advance",
  ).length;
  const askProposer = chats.filter(
    (m) =>
      m.messageType === "ask_proposer" ||
      (m.speakerType === "chair" && m.addressTo === "proposer"),
  ).length;
  const board = chats.filter(
    (m) => m.speakerType === "board_member" || m.speakerType === "executive",
  ).length;
  const reviewTone = chats.filter((m) => REVIEW_TONE.test(msgText(m))).length;
  const staleVer = chats.filter((m) => {
    const m2 = msgText(m).match(/Version\s*(\d+)|V(\d+)/i);
    if (!m2) return false;
    const n = Number(m2[1] ?? m2[2]);
    return n > 0 && n < ctx.currentVersion;
  }).length;
  const issueTotal =
    ctx.unresolvedIssues.length + ctx.resolvedIssues.length || 1;
  const misroute = state.findings.filter(
    (f) =>
      f.ruleId === "misroute_to_proposer" || f.ruleId === "bounce_to_asker",
  ).length;
  const loops = state.findings.filter((f) => f.ruleId === "conversation_loop");
  const proposerOver = state.findings.filter(
    (f) =>
      f.ruleId === "misroute_to_proposer" ||
      f.ruleId === "ignore_proposer_answer" ||
      f.ruleId === "repeat_question",
  ).length;

  return {
    duplicateRate: pairs > 0 ? Math.round((similarPairs / pairs) * 100) : 0,
    advanceRate:
      chats.length > 0
        ? Math.round((advances / Math.max(board, 1)) * 100)
        : 0,
    proposerDependencyRate:
      chats.length > 0
        ? Math.round((askProposer / chats.length) * 100)
        : 0,
    issueResolutionRate: Math.round(
      (ctx.resolvedIssues.length / issueTotal) * 100,
    ),
    misrouteCount: misroute,
    reviewToneRate:
      chats.length > 0 ? Math.round((reviewTone / chats.length) * 100) : 0,
    staleVersionRate:
      chats.length > 0 ? Math.round((staleVer / chats.length) * 100) : 0,
    avgLoopLength: loops.length,
    autoRepairCount: state.repairLog.filter((r) => r.action === "auto" || r.action === "confirm").length,
    proposerOverAskCount: proposerOver,
    totalFindings: state.findings.length,
    openFindings: state.findings.filter((f) => f.status === "open").length,
  };
}

export function formatQualitySummary(scores: QualityScores): string {
  return [
    "会議品質サマリー（AIデバッガー）",
    `前進率 ${scores.advanceRate}%`,
    `重複率 ${scores.duplicateRate}%`,
    `誤ルーティング ${scores.misrouteCount}件`,
    `企画者への過剰質問 ${scores.proposerOverAskCount}件`,
    `自動修復 ${scores.autoRepairCount}件`,
  ].join("\n");
}

export function severityLabel(severity: DebuggerSeverity): string {
  if (severity === "critical") return "重大";
  if (severity === "warning") return "警告";
  return "情報";
}

export function severityEmoji(severity: DebuggerSeverity): string {
  if (severity === "critical") return "⛔";
  if (severity === "warning") return "⚠";
  return "ℹ";
}

/** Apply a safe repair. Returns human note; mutates state via callbacks. */
export function applySafeRepair(args: {
  finding: DebuggerFinding;
  action: "auto" | "confirm";
  state: {
    unresolvedIssues: string[];
    resolvedIssues: string[];
    openTopics: DiscussionTopic[];
    ceoQuestions: CeoQuestion[];
    forcedNextRoleKey: string | null;
    forcedNominateReason: string | null;
    currentVersion: number;
    activeGenerationId: string | null;
    pendingSpeak: unknown;
  };
  availableRoleKeys: string[];
  recentRoleKeys: string[];
}): { note: string; chairUtterance: string | null } {
  const { finding, state } = args;
  const kind = finding.repairKind;
  if (!kind || !finding.autoRepairable) {
    return { note: "この指摘は自動修復対象外です。", chairUtterance: null };
  }

  switch (kind) {
    case "suppress_duplicate_chair":
      return {
        note: "重複CEO発言を抑止しました（同趣旨の再掲をスキップ）。",
        chairUtterance: null,
      };
    case "discard_stale_response":
      state.activeGenerationId = null;
      state.pendingSpeak = null;
      return {
        note: "古いAPI応答／進行中generationを破棄しました。",
        chairUtterance: null,
      };
    case "block_reopen_resolved": {
      const labels = finding.relatedIssueIds;
      state.unresolvedIssues = state.unresolvedIssues.filter(
        (l) => !labels.includes(l),
      );
      for (const label of labels) {
        if (!state.resolvedIssues.includes(label)) {
          state.resolvedIssues = [...state.resolvedIssues, label].slice(0, 12);
        }
      }
      state.openTopics = state.openTopics.map((t) =>
        labels.includes(t.label) ? { ...t, status: "resolved" as const } : t,
      );
      return {
        note: "解決済みIssueの再オープンを防止しました。",
        chairUtterance: `解決済みの論点（${labels.join("、")}）は閉じたまま進めます。`,
      };
    }
    case "refresh_plan_version":
      return {
        note: `企画前提を Version ${state.currentVersion} に揃えました。`,
        chairUtterance: `前提は最新の Version ${state.currentVersion} です。旧版には戻らないでください。`,
      };
    case "reselect_next_speaker": {
      const next = pickPerspectiveOfficer({
        availableRoleKeys: args.availableRoleKeys,
        recentRoleKeys: args.recentRoleKeys,
        avoidRoleKey: args.recentRoleKeys[args.recentRoleKeys.length - 1] ?? null,
        banRoleKey: args.recentRoleKeys.slice(-3).length >= 2
          ? args.recentRoleKeys[args.recentRoleKeys.length - 1]
          : null,
      });
      if (next) {
        state.forcedNextRoleKey = next;
        state.forcedNominateReason =
          "AIデバッガー: Theme専有を解除し多視点へ再選定";
      }
      return {
        note: next
          ? `nextSpeakerを ${next} へ再選定しました（Theme役職固定を解除）。`
          : "再選定候補がありません。",
        chairUtterance: next
          ? `視点を広げます。${next} の専門からテーマへ貢献してください。`
          : null,
      };
    }
    case "block_repeat_question": {
      state.ceoQuestions = state.ceoQuestions.map((q) => {
        if (
          finding.relatedIssueIds.includes(q.id) &&
          (q.status === "OPEN" || q.status === "ANSWERED")
        ) {
          return {
            ...q,
            status: "ANSWERED" as const,
            note: q.note ?? "デバッガー: 再質問抑止",
          };
        }
        if (
          finding.relatedMessageIds.length > 0 &&
          q.status === "OPEN" &&
          finding.detection.includes(q.text.slice(0, 10))
        ) {
          return { ...q, status: "ANSWERED" as const };
        }
        return q;
      });
      // Soft: mark similar OPEN as ANSWERED when detection mentions repeat
      return {
        note: "同一質問の再送を禁止し、関連OPENをANSWEREDへ更新しました（RESOLVED強制はしません）。",
        chairUtterance:
          "同じ質問の繰り返しは止めます。回答を前提に次の視点へ進みましょう。",
      };
    }
    case "rebuild_meeting_memory": {
      const topicResolved = new Set(
        state.openTopics
          .filter((t) => t.status === "resolved")
          .map((t) => t.label),
      );
      const topicOpen = new Set(
        state.openTopics
          .filter((t) => t.status !== "resolved")
          .map((t) => t.label),
      );
      const unresolved = [
        ...new Set([
          ...state.unresolvedIssues.filter((l) => !topicResolved.has(l)),
          ...topicOpen,
        ]),
      ]
        .filter((l) => !topicResolved.has(l))
        .slice(0, 12);
      const resolved = [
        ...new Set([
          ...state.resolvedIssues,
          ...topicResolved,
        ]),
      ]
        .filter((l) => !unresolved.includes(l))
        .slice(0, 12);
      state.unresolvedIssues = unresolved;
      state.resolvedIssues = resolved;
      state.openTopics = [
        ...unresolved.map((label, i) => {
          const existing = state.openTopics.find((t) => t.label === label);
          return (
            existing ?? {
              id: `u-${i}-${label.slice(0, 12)}`,
              label,
              status: "unresolved" as const,
              note: null,
            }
          );
        }),
        ...resolved.map((label, i) => {
          const existing = state.openTopics.find((t) => t.label === label);
          return (
            existing ?? {
              id: `r-${i}-${label.slice(0, 12)}`,
              label,
              status: "resolved" as const,
              note: null,
            }
          );
        }),
      ].slice(0, 12);
      return {
        note: "会議メモリ（未解決/解決済み/openTopics）を再同期しました。企画内容・役員意見は変更していません。",
        chairUtterance: "論点ボードを整理しました。未解決から続けます。",
      };
    }
    case "park_numeric_questions": {
      const numeric =
        /(ROI|roi|回収|利益率|損失上限|予算|円|％|パーセント|投資対効果)/i;
      let parked = 0;
      state.ceoQuestions = state.ceoQuestions.map((q) => {
        if (
          (q.status === "OPEN" || q.status === "ANSWERED") &&
          numeric.test(q.text)
        ) {
          parked += 1;
          return {
            ...q,
            status: "PARKED" as const,
            note: q.note ?? "デバッガー: アイデア段階のため将来確認へPARKED",
          };
        }
        return q;
      });
      return {
        note: parked
          ? `数値関連の質問 ${parked}件を PARKED にしました。`
          : "PARKED対象の数値質問はありませんでした。",
        chairUtterance:
          "具体的な数値は次段階の確認項目としてPARKEDします。今は複数視点で構造が成立するかを見ましょう。",
      };
    }
    default:
      return { note: "未知の修復種別です。", chairUtterance: null };
  }
}
