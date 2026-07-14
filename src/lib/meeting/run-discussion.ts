import { prisma } from "@/lib/db";
import { runDiscussionUtterance } from "@/lib/ai/run-board-member";
import {
  runDiscussionBriefSummary,
  runDiscussionFacilitator,
  runInterruptClassification,
  runPlanUpdateDetection,
} from "@/lib/ai/run-chairperson";
import type {
  CompanyContext,
  MemberContext,
  ProjectContext,
} from "@/lib/ai/prompts";
import type { ReviewLevel } from "@/lib/ai/role-focus";
import {
  isDiscussionSpeaker,
  MEETING_STATUS,
  MEETING_STEP,
} from "@/lib/meeting/constants";
import { pickThinkingLine, thinkingTitle } from "@/lib/meeting/thinking-messages";
import {
  analyzeDiscussionTurn,
  applySafeRepair,
  computeQualityScores,
  createDebuggerState,
  formatQualitySummary,
  hydrateFinding,
  mergeFindings,
  parseDebuggerState,
  severityEmoji,
  type DebuggerFinding,
  type DebuggerMode,
  type DebuggerState,
} from "@/lib/meeting/ai-debugger";
import {
  broadenPerspectiveUtterance,
  dedupeIssueLabels,
  detectThemeMonopoly,
  migrateThemeLabel,
  normalizeThemeLabel,
  perspectiveHint,
  pickPerspectiveOfficer,
  pickNextThemeFromIssues,
  themeCloseUtterance,
} from "@/lib/meeting/discussion-themes";
import {
  guardRepeatedCeoQuestion as guardRepeatedCeoQuestionCore,
  isRepeatedCeoChairUtterance,
  markOpenQuestionsAnswered as markOpenQuestionsAnsweredBoard,
  markOpenQuestionsAnsweredByOfficerProgress as markOpenQuestionsAnsweredByOfficerProgressBoard,
  registerOpenCeoQuestion as registerOpenCeoQuestionBoard,
} from "@/lib/meeting/ceo-questions";
import {
  detectCeoExplicitNomination,
  formatNominationOverrideNotice,
  normalizeUtteranceAddress,
  resolveNextSpeaker,
  roleDisplayLabel,
} from "@/lib/meeting/speaker-routing";
import type { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "crypto";
import type {
  CeoQuestion,
  DiscussionFacilitatorOutput,
  DiscussionTopic,
} from "@/lib/ai/schemas";

type Json = Prisma.InputJsonValue;

type BoardMemberRow = {
  id: string;
  title: string;
  roleKey: string;
  description: string;
  priorities: unknown;
  checkItems: unknown;
  behaviorRules: unknown;
  isChairperson: boolean;
};

export type PlanVersion = {
  version: number;
  summary: string;
  changes: string[];
  createdAt: string;
};

export type PendingPlanUpdate = {
  version: number;
  changes: string[];
  summary: string;
  chairNote: string | null;
  sourceMessageId: string | null;
};

/** Rich chat message — keeps legacy fields for compatibility. */
export type DiscussionMessage = {
  id?: string;
  speakerType: "board_member" | "proposer" | "chair" | "system" | "user" | "executive";
  roleKey: string | null;
  title: string;
  text: string;
  content?: string;
  speakerId?: string | null;
  speakerName?: string;
  messageType?: string | null;
  targetExecutiveId?: string | null;
  proposalVersion?: number | null;
  createdAt?: string;
  interruptedGenerationId?: string | null;
  metadata?: Record<string, unknown>;
  addressTo?: string;
  addressRoleKey?: string | null;
  /** Structured destination (preferred over addressTo). */
  targetType?: "proposer" | "executive" | "chair" | "all" | "none";
  /** roleKey when targetType === "executive" */
  targetParticipantId?: string | null;
  moveType?: string;
  nominateReason?: string;
  kind?: "chat" | "plan_update" | "brief_summary" | "thinking" | "diagnostic";
  planUpdate?: {
    version: number;
    changes: string[];
    summary: string;
  };
  /** AI Debugger finding payload when kind === "diagnostic" */
  diagnostic?: DebuggerFinding;
};

type PendingSpeak = {
  generationId: string;
  roleKey: string;
  nominateReason: string;
  chairUtterance: string | null;
  rareInterruptRoleKey: string | null;
  action: string;
};

type WallChatState = {
  messages: DiscussionMessage[];
  planVersions: PlanVersion[];
  currentVersion: number;
  ended: boolean;
  endReason: string | null;
  paused: boolean;
  awaitingEndConfirm: boolean;
  pendingPlanUpdate: PendingPlanUpdate | null;
  activeGenerationId: string | null;
  pendingSpeak: PendingSpeak | null;
  forcedNextRoleKey: string | null;
  forcedNominateReason: string | null;
  /** CEO-maintained issue board — end only when all are resolved. */
  openTopics: DiscussionTopic[];
  /** Top-priority issue labels for UI (importance order, max 4). */
  priorityIssues: string[];
  /** Free-form current theme label (CEO-managed). No fixed order. */
  activeTheme: string;
  /** Unresolved issue labels. */
  unresolvedIssues: string[];
  /** Resolved issue labels. */
  resolvedIssues: string[];
  /** CEO-managed questions with OPEN/ANSWERED/RESOLVED/PARKED. */
  ceoQuestions: CeoQuestion[];
  /** Confirmed premises for the rest of the meeting. */
  decisions: string[];
  /** Explicitly rejected ideas — must not be re-proposed. */
  rejectedItems: string[];
  /** AI Debugger (audit) — not a meeting participant. */
  debugger: DebuggerState;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function newMessageId(): string {
  return randomUUID();
}

function toMemberContext(member: BoardMemberRow): MemberContext {
  return {
    title: member.title,
    roleKey: member.roleKey,
    description: member.description,
    priorities: asStringArray(member.priorities),
    checkItems: member.checkItems == null ? null : asStringArray(member.checkItems),
    behaviorRules: asStringArray(member.behaviorRules),
    isChairperson: member.isChairperson,
  };
}

function projectToPlanSummary(project: ProjectContext): string {
  return [
    `タイトル: ${project.title}`,
    `背景: ${project.background}`,
    `課題: ${project.problem}`,
    `内容: ${project.content}`,
    `対象: ${project.targetCustomer}`,
    `期待効果: ${project.expectedEffect}`,
    `概算費用: ${project.estimatedCost}`,
    `制約: ${project.constraints}`,
  ].join("\n");
}

function formatPlanUpdateBanner(version: number, changes: string[]): string {
  const lines = changes.map((c) => `・${c.replace(/^・/, "")}`);
  return [
    "━━━━━━━━━━━━━━",
    "📌企画更新",
    `Version${version}`,
    "変更内容",
    ...lines,
    "━━━━━━━━━━━━━━",
    `これ以降は Version${version} を前提に議論します。`,
  ].join("\n");
}

function normalizeSpeakerType(
  raw: string | undefined,
): DiscussionMessage["speakerType"] {
  if (raw === "user") return "proposer";
  if (raw === "executive") return "board_member";
  if (
    raw === "board_member" ||
    raw === "proposer" ||
    raw === "chair" ||
    raw === "system"
  ) {
    return raw;
  }
  return "board_member";
}

function coerceMessage(raw: unknown): DiscussionMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const text =
    typeof m.text === "string"
      ? m.text
      : typeof m.content === "string"
        ? m.content
        : null;
  if (!text) return null;
  const speakerType = normalizeSpeakerType(
    typeof m.speakerType === "string" ? m.speakerType : undefined,
  );
  return {
    ...(m as DiscussionMessage),
    id: typeof m.id === "string" ? m.id : undefined,
    speakerType,
    roleKey: typeof m.roleKey === "string" ? m.roleKey : null,
    title:
      typeof m.title === "string"
        ? m.title
        : typeof m.speakerName === "string"
          ? m.speakerName
          : "不明",
    text,
    content: text,
  };
}

function readWallChatState(
  summary: unknown,
  project: ProjectContext,
): WallChatState {
  const data =
    summary && typeof summary === "object" && !Array.isArray(summary)
      ? (summary as Record<string, unknown>)
      : {};

  const messages = Array.isArray(data.messages)
    ? data.messages
        .map(coerceMessage)
        .filter((m): m is DiscussionMessage => Boolean(m))
    : [];

  let planVersions: PlanVersion[] = [];
  if (Array.isArray(data.planVersions)) {
    planVersions = data.planVersions.filter(
      (v): v is PlanVersion =>
        Boolean(v) &&
        typeof v === "object" &&
        typeof (v as PlanVersion).version === "number" &&
        typeof (v as PlanVersion).summary === "string",
    );
  }

  if (planVersions.length === 0) {
    planVersions = [
      {
        version: 1,
        summary: projectToPlanSummary(project),
        changes: ["初版（提出時企画）"],
        createdAt: new Date().toISOString(),
      },
    ];
  }

  const currentVersion =
    typeof data.currentVersion === "number"
      ? data.currentVersion
      : planVersions[planVersions.length - 1]?.version ?? 1;

  const pendingPlanUpdate =
    data.pendingPlanUpdate &&
    typeof data.pendingPlanUpdate === "object" &&
    !Array.isArray(data.pendingPlanUpdate)
      ? (data.pendingPlanUpdate as PendingPlanUpdate)
      : null;

  const pendingSpeak =
    data.pendingSpeak &&
    typeof data.pendingSpeak === "object" &&
    !Array.isArray(data.pendingSpeak)
      ? (data.pendingSpeak as PendingSpeak)
      : null;

  let openTopics: DiscussionTopic[] = [];
  if (Array.isArray(data.openTopics)) {
    openTopics = data.openTopics.filter(
      (t): t is DiscussionTopic =>
        Boolean(t) &&
        typeof t === "object" &&
        typeof (t as DiscussionTopic).id === "string" &&
        typeof (t as DiscussionTopic).label === "string" &&
        ["unresolved", "discussing", "resolved"].includes(
          (t as DiscussionTopic).status,
        ),
    );
  }

  const decisions = asStringArray(data.decisions).map((s) => s.slice(0, 80));
  const rejectedItems = asStringArray(data.rejectedItems).map((s) =>
    s.slice(0, 80),
  );
  const priorityIssues = asStringArray(data.priorityIssues)
    .map((s) => s.slice(0, 80))
    .slice(0, 4);

  const activeTheme = migrateThemeLabel(data.activeTheme);

  let unresolvedIssues = dedupeIssueLabels(
    asStringArray(data.unresolvedIssues),
  );
  let resolvedIssues = dedupeIssueLabels(asStringArray(data.resolvedIssues));

  // Migrate from openTopics / legacy closedThemes when issue lists are empty
  if (unresolvedIssues.length === 0 && resolvedIssues.length === 0) {
    unresolvedIssues = dedupeIssueLabels(
      openTopics
        .filter((t) => t.status !== "resolved")
        .map((t) => t.label)
        .concat(priorityIssues),
    );
    resolvedIssues = dedupeIssueLabels([
      ...openTopics.filter((t) => t.status === "resolved").map((t) => t.label),
      ...asStringArray(data.closedThemes).map((id) => migrateThemeLabel(id)),
    ]);
  }

  let ceoQuestions: CeoQuestion[] = [];
  if (Array.isArray(data.ceoQuestions)) {
    const statuses = new Set(["OPEN", "ANSWERED", "RESOLVED", "PARKED"]);
    ceoQuestions = data.ceoQuestions
      .filter(
        (q): q is CeoQuestion =>
          Boolean(q) &&
          typeof q === "object" &&
          typeof (q as CeoQuestion).id === "string" &&
          typeof (q as CeoQuestion).text === "string" &&
          statuses.has((q as CeoQuestion).status),
      )
      .map((q) => ({
        id: q.id.slice(0, 40),
        text: q.text.slice(0, 120),
        status: q.status,
        note:
          typeof q.note === "string" ? q.note.slice(0, 120) : (q.note ?? null),
      }))
      .slice(0, 12);
  }

  return {
    messages,
    planVersions,
    currentVersion,
    ended: Boolean(data.ended),
    endReason: typeof data.endReason === "string" ? data.endReason : null,
    paused: Boolean(data.paused),
    awaitingEndConfirm: Boolean(data.awaitingEndConfirm),
    pendingPlanUpdate,
    activeGenerationId:
      typeof data.activeGenerationId === "string"
        ? data.activeGenerationId
        : null,
    pendingSpeak,
    forcedNextRoleKey:
      typeof data.forcedNextRoleKey === "string"
        ? data.forcedNextRoleKey
        : null,
    forcedNominateReason:
      typeof data.forcedNominateReason === "string"
        ? data.forcedNominateReason
        : null,
    openTopics,
    priorityIssues,
    activeTheme,
    unresolvedIssues,
    resolvedIssues,
    ceoQuestions,
    decisions,
    rejectedItems,
    debugger: parseDebuggerState(data.debugger),
  };
}

function currentPlanFromState(state: WallChatState): {
  version: number;
  summary: string;
} {
  const match =
    state.planVersions.find((v) => v.version === state.currentVersion) ??
    state.planVersions[state.planVersions.length - 1];
  return {
    version: match.version,
    summary: match.summary,
  };
}

function evolvedHintsFromMessages(messages: DiscussionMessage[]): string[] {
  return messages
    .filter(
      (m) =>
        m.speakerType === "proposer" ||
        m.moveType === "alternative" ||
        m.kind === "plan_update",
    )
    .map((m) => `${m.title}: ${m.text}`)
    .slice(-8);
}

function pushMessage(
  state: WallChatState,
  partial: Omit<DiscussionMessage, "id" | "createdAt" | "content"> & {
    id?: string;
    createdAt?: string;
  },
): DiscussionMessage {
  const msg: DiscussionMessage = {
    ...partial,
    id: partial.id ?? newMessageId(),
    createdAt: partial.createdAt ?? new Date().toISOString(),
    content: partial.text,
    speakerName: partial.title,
    proposalVersion: partial.proposalVersion ?? state.currentVersion,
  };
  state.messages.push(msg);
  return msg;
}

async function loadDiscussionContext(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      project: {
        include: {
          company: { include: { boardMembers: true } },
        },
      },
      rounds: {
        where: {
          step: { in: [MEETING_STEP.DISCUSSION, MEETING_STEP.REBUTTAL] },
        },
        orderBy: { roundNumber: "asc" },
        take: 1,
      },
    },
  });
  if (!meeting) throw new Error("会議が見つかりません。");

  const chair = meeting.project.company.boardMembers.find((m) => m.isChairperson);
  if (!chair) throw new Error("CEOが見つかりません。");

  const speakers = meeting.project.company.boardMembers.filter(isDiscussionSpeaker);
  if (speakers.length < 2) {
    throw new Error("壁打ち参加者が不足しています。");
  }

  const project: ProjectContext = {
    title: meeting.project.title,
    background: meeting.project.background,
    problem: meeting.project.problem,
    content: meeting.project.content,
    targetCustomer: meeting.project.targetCustomer,
    expectedEffect: meeting.project.expectedEffect,
    estimatedCost: meeting.project.estimatedCost,
    constraints: meeting.project.constraints,
    discussionPoints: meeting.project.discussionPoints,
  };
  const company: CompanyContext = {
    name: meeting.project.company.name,
    philosophy: meeting.project.company.philosophy,
    vision: meeting.project.company.vision,
    values: asStringArray(meeting.project.company.values),
    culture: meeting.project.company.culture,
    principles: meeting.project.company.principles,
    prohibitions: meeting.project.company.prohibitions,
  };

  return { meeting, chair, speakers, project, company };
}

async function ensureRound(
  meetingId: string,
  project: ProjectContext,
): Promise<{ roundId: string; state: WallChatState }> {
  let round = await prisma.meetingRound.findFirst({
    where: {
      meetingId,
      step: { in: [MEETING_STEP.DISCUSSION, MEETING_STEP.REBUTTAL] },
    },
    orderBy: { roundNumber: "asc" },
  });

  let state = readWallChatState(round?.summary, project);

  if (!round) {
    round = await prisma.meetingRound.create({
      data: {
        meetingId,
        step: MEETING_STEP.DISCUSSION,
        roundNumber: 3,
        summary: {
          format: "wall_chat",
          messages: [],
          planVersions: state.planVersions,
          currentVersion: 1,
          ended: false,
          endReason: null,
          paused: false,
          awaitingEndConfirm: false,
          pendingPlanUpdate: null,
          activeGenerationId: null,
          pendingSpeak: null,
          forcedNextRoleKey: null,
          forcedNominateReason: null,
          openTopics: [],
          priorityIssues: [],
          activeTheme: "利益性",
          unresolvedIssues: [],
          resolvedIssues: [],
          ceoQuestions: [],
          decisions: [],
          rejectedItems: [],
          debugger: createDebuggerState("PASSIVE"),
        } as Json,
      },
    });
    state = readWallChatState(round.summary, project);
  }

  return { roundId: round.id, state };
}

async function persistDiscussion(
  roundId: string,
  meetingId: string,
  state: WallChatState,
  meta: {
    ended?: boolean;
    endReason?: string | null;
    appendStatement?: boolean;
  } = {},
) {
  if (meta.ended !== undefined) state.ended = meta.ended;
  if (meta.endReason !== undefined) state.endReason = meta.endReason;

  const summary = {
    format: "wall_chat" as const,
    messages: state.messages,
    planVersions: state.planVersions,
    currentVersion: state.currentVersion,
    ended: state.ended,
    endReason: state.endReason,
    paused: state.paused,
    awaitingEndConfirm: state.awaitingEndConfirm,
    pendingPlanUpdate: state.pendingPlanUpdate,
    activeGenerationId: state.activeGenerationId,
    pendingSpeak: state.pendingSpeak,
    forcedNextRoleKey: state.forcedNextRoleKey,
    forcedNominateReason: state.forcedNominateReason,
    openTopics: state.openTopics,
    priorityIssues: state.priorityIssues,
    activeTheme: state.activeTheme,
    unresolvedIssues: state.unresolvedIssues,
    resolvedIssues: state.resolvedIssues,
    ceoQuestions: state.ceoQuestions,
    decisions: state.decisions,
    rejectedItems: state.rejectedItems,
    debugger: state.debugger,
  };

  await prisma.meetingRound.update({
    where: { id: roundId },
    data: { summary: summary as Json },
  });

  if (meta.appendStatement === false) return;

  const last = state.messages[state.messages.length - 1];
  if (!last || last.kind === "thinking") return;

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      project: { include: { company: { include: { boardMembers: true } } } },
    },
  });
  const boardMemberId =
    last.roleKey && meeting
      ? meeting.project.company.boardMembers.find((m) => m.roleKey === last.roleKey)
          ?.id
      : undefined;

  const isProposer =
    last.speakerType === "proposer" || last.speakerType === "user";

  await prisma.statement.create({
    data: {
      meetingRoundId: roundId,
      boardMemberId: isProposer ? null : boardMemberId,
      speakerType: isProposer ? "proposer" : "board_member",
      content: last as unknown as Json,
      rawText: last.text,
    },
  });
}

function pickFallbackSpeaker(
  speakers: BoardMemberRow[],
  messages: DiscussionMessage[],
  avoidRoleKey?: string | null,
): string {
  const recent = messages
    .filter((m) => m.speakerType === "board_member" || m.speakerType === "executive")
    .slice(-4)
    .map((m) => m.roleKey);
  const preferred = speakers.find(
    (s) => !recent.includes(s.roleKey) && s.roleKey !== avoidRoleKey,
  );
  if (preferred) return preferred.roleKey;
  const any = speakers.find((s) => s.roleKey !== avoidRoleKey);
  return (any ?? speakers[0]).roleKey;
}

function shufflePick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function publicState(state: WallChatState) {
  return {
    format: "wall_chat" as const,
    messages: state.messages,
    planVersions: state.planVersions,
    currentVersion: state.currentVersion,
    ended: state.ended,
    endReason: state.endReason,
    paused: state.paused,
    awaitingEndConfirm: state.awaitingEndConfirm,
    pendingPlanUpdate: state.pendingPlanUpdate,
    openTopics: state.openTopics,
    priorityIssues: state.priorityIssues,
    activeTheme: state.activeTheme,
    activeThemeLabel: state.activeTheme,
    unresolvedIssues: state.unresolvedIssues,
    resolvedIssues: state.resolvedIssues,
    ceoQuestions: state.ceoQuestions,
    decisions: state.decisions,
    rejectedItems: state.rejectedItems,
    debugger: {
      mode: state.debugger.mode,
      findings: state.debugger.findings,
      repairLog: state.debugger.repairLog,
      scores: state.debugger.scores,
      openCount: state.debugger.findings.filter((f) => f.status === "open")
        .length,
    },
  };
}

function topicsAllResolved(topics: DiscussionTopic[]): boolean {
  return topics.length > 0 && topics.every((t) => t.status === "resolved");
}

function unresolvedTopics(topics: DiscussionTopic[]): DiscussionTopic[] {
  return topics.filter((t) => t.status !== "resolved");
}

function buildAnalyzeContext(
  state: WallChatState,
  reviewLevel: ReviewLevel,
  extra: Partial<{
    lastFacilitatorAction: string | null;
    lastRoutedRole: string | null;
    lastAskerRole: string | null;
    facilitatorJsonFailed: boolean;
    staleResponseDiscarded: boolean;
    apiTimeout: boolean;
    duplicateResponseDetected: boolean;
  }> = {},
) {
  return {
    messages: state.messages,
    activeTheme: state.activeTheme,
    unresolvedIssues: state.unresolvedIssues,
    resolvedIssues: state.resolvedIssues,
    openTopics: state.openTopics,
    ceoQuestions: state.ceoQuestions,
    decisions: state.decisions,
    rejectedItems: state.rejectedItems,
    currentVersion: state.currentVersion,
    reviewLevel,
    lastFacilitatorAction: extra.lastFacilitatorAction ?? null,
    lastRoutedRole: extra.lastRoutedRole ?? null,
    lastAskerRole: extra.lastAskerRole ?? null,
    facilitatorJsonFailed: extra.facilitatorJsonFailed ?? false,
    staleResponseDiscarded: extra.staleResponseDiscarded ?? false,
    apiTimeout: extra.apiTimeout ?? false,
    duplicateResponseDetected: extra.duplicateResponseDetected ?? false,
  };
}

/** Run debugger analysis; push at most one diagnostic card. Optionally auto-repair in ACTIVE. */
function runDebuggerPass(
  state: WallChatState,
  reviewLevel: ReviewLevel,
  extra: Parameters<typeof buildAnalyzeContext>[2] = {},
  availableRoleKeys: string[] = [],
): void {
  if (state.debugger.mode === "OFF") return;

  const ctx = buildAnalyzeContext(state, reviewLevel, extra);
  const incoming = analyzeDiscussionTurn(ctx, state.debugger);
  const added = mergeFindings(state.debugger, incoming);
  // Ensure cards carry full improvement-assistant payload
  for (const f of added) {
    Object.assign(f, hydrateFinding(f));
  }
  state.debugger.scores = computeQualityScores(ctx, state.debugger);
  state.debugger.lastAnalyzedMessageCount = state.messages.length;

  // Only surface the highest-severity new finding as a timeline card
  const toShow = added[0];
  if (!toShow) return;

  let statusNote = "";
  if (state.debugger.mode === "ACTIVE" && toShow.autoRepairable && toShow.repairKind) {
    const result = applySafeRepair({
      finding: toShow,
      action: "auto",
      state,
      availableRoleKeys,
      recentRoleKeys: recentBoardRoleKeys(state.messages),
    });
    toShow.status = "auto_repaired";
    toShow.repairedAt = new Date().toISOString();
    state.debugger.repairLog = [
      ...state.debugger.repairLog,
      {
        at: toShow.repairedAt,
        findingId: toShow.id,
        action: "auto" as const,
        note: result.note,
        repairKind: toShow.repairKind,
      },
    ].slice(-40);
    statusNote = result.note;
    if (result.chairUtterance) {
      pushMessage(state, {
        speakerType: "chair",
        roleKey: "ceo",
        title: "CEO",
        text: result.chairUtterance.slice(0, 150),
        kind: "chat",
        messageType: "debugger_repair",
        metadata: { findingId: toShow.id },
      });
    }
    state.debugger.scores = computeQualityScores(
      buildAnalyzeContext(state, reviewLevel, extra),
      state.debugger,
    );
  }

  pushMessage(state, {
    speakerType: "system",
    roleKey: null,
    title: "AIデバッガー",
    text: `${severityEmoji(toShow.severity)} ${toShow.title}\n\n${toShow.detection}${statusNote ? `\n\n修復: ${statusNote}` : ""}`.slice(
      0,
      400,
    ),
    kind: "diagnostic",
    messageType: "ai_debugger",
    diagnostic: toShow,
    metadata: {
      findingId: toShow.id,
      ruleId: toShow.ruleId,
      severity: toShow.severity,
    },
  });
}

function pushDebuggerSummary(state: WallChatState, reviewLevel: ReviewLevel): void {
  if (state.debugger.mode === "OFF") return;
  state.debugger.scores = computeQualityScores(
    buildAnalyzeContext(state, reviewLevel),
    state.debugger,
  );
  const text = formatQualitySummary(state.debugger.scores);
  pushMessage(state, {
    speakerType: "system",
    roleKey: null,
    title: "AIデバッガー",
    text,
    kind: "diagnostic",
    messageType: "debug_summary",
    metadata: { scores: state.debugger.scores },
  });
}

function applyMeetingMemory(
  state: WallChatState,
  next: {
    openTopics?: DiscussionTopic[];
    priorityIssues?: string[];
    unresolvedIssues?: string[];
    resolvedIssues?: string[];
    ceoQuestions?: CeoQuestion[];
    decisions?: string[];
    rejectedItems?: string[];
    activeTheme?: string | null;
  },
): void {
  if (typeof next.activeTheme === "string" && next.activeTheme.trim()) {
    state.activeTheme = normalizeThemeLabel(next.activeTheme);
  }
  if (next.openTopics && next.openTopics.length > 0) {
    state.openTopics = next.openTopics.slice(0, 12);
  }
  const hasIssueUpdate =
    (Array.isArray(next.unresolvedIssues) &&
      next.unresolvedIssues.length > 0) ||
    (Array.isArray(next.resolvedIssues) && next.resolvedIssues.length > 0);
  if (hasIssueUpdate) {
    if (Array.isArray(next.unresolvedIssues)) {
      state.unresolvedIssues = dedupeIssueLabels(next.unresolvedIssues);
    }
    if (Array.isArray(next.resolvedIssues)) {
      state.resolvedIssues = dedupeIssueLabels(next.resolvedIssues);
    }
  } else if (next.openTopics && next.openTopics.length > 0) {
    state.unresolvedIssues = dedupeIssueLabels(
      next.openTopics
        .filter((t) => t.status !== "resolved")
        .map((t) => t.label),
    );
    state.resolvedIssues = dedupeIssueLabels(
      next.openTopics
        .filter((t) => t.status === "resolved")
        .map((t) => t.label),
    );
  }
  // Keep priorityIssues aligned with unresolved (UI subset)
  if (Array.isArray(next.priorityIssues) && next.priorityIssues.length > 0) {
    state.priorityIssues = next.priorityIssues
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 4);
  } else {
    state.priorityIssues = state.unresolvedIssues.slice(0, 4);
  }
  if (Array.isArray(next.ceoQuestions) && next.ceoQuestions.length > 0) {
    state.ceoQuestions = next.ceoQuestions
      .filter(
        (q) =>
          q &&
          typeof q.id === "string" &&
          typeof q.text === "string" &&
          ["OPEN", "ANSWERED", "RESOLVED", "PARKED"].includes(q.status),
      )
      .map((q) => ({
        id: q.id.slice(0, 40),
        text: q.text.trim().slice(0, 120),
        status: q.status,
        note:
          typeof q.note === "string" ? q.note.slice(0, 120) : (q.note ?? null),
      }))
      .filter((q) => q.text.length > 0)
      .slice(0, 12);
  }
  if (Array.isArray(next.decisions)) {
    state.decisions = next.decisions
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 10);
  }
  if (Array.isArray(next.rejectedItems)) {
    state.rejectedItems = next.rejectedItems
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 10);
  }
}

/** Derive UI priorities from openTopics when the model omits priorityIssues. */
function derivePriorityIssues(
  topics: DiscussionTopic[],
  explicit?: string[],
): string[] {
  if (explicit && explicit.length > 0) {
    return explicit.map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 4);
  }
  return unresolvedTopics(topics)
    .map((t) => t.label)
    .slice(0, 4);
}

function focusTopicFromState(state: WallChatState): DiscussionTopic | undefined {
  const open = unresolvedTopics(state.openTopics);
  if (open.length === 0) return undefined;
  for (const label of state.priorityIssues) {
    const hit = open.find(
      (t) => t.label === label || t.id === label || t.label.includes(label),
    );
    if (hit) return hit;
  }
  return open[0];
}


function registerOpenCeoQuestion(state: WallChatState, text: string): void {
  state.ceoQuestions = registerOpenCeoQuestionBoard(state.ceoQuestions, text);
}

function markOpenQuestionsAnswered(
  state: WallChatState,
  answerText: string,
): void {
  state.ceoQuestions = markOpenQuestionsAnsweredBoard(
    state.ceoQuestions,
    answerText,
  );
}

function markOpenQuestionsAnsweredByOfficerProgress(
  state: WallChatState,
  officerText: string,
): void {
  state.ceoQuestions = markOpenQuestionsAnsweredByOfficerProgressBoard(
    state.ceoQuestions,
    state.messages,
    officerText,
  );
}

function lastBoardSpeakerRoleKey(
  messages: DiscussionMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (
      (m.speakerType === "board_member" || m.speakerType === "executive") &&
      m.roleKey
    ) {
      return m.roleKey;
    }
  }
  return null;
}

function lastMeaningfulUtterance(
  messages: DiscussionMessage[],
): { roleKey: string | null; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.kind === "thinking" || m.kind === "plan_update") continue;
    if (!m.text?.trim()) continue;
    if (m.speakerType === "chair" || m.speakerType === "system") continue;
    return { roleKey: m.roleKey, text: m.text };
  }
  return null;
}

type ContentRoute = {
  action: "ask_proposer" | "nominate";
  roleKey: string | null;
  kind: string;
  reason: string;
};

/** Map question/topic content → debate kind. Role is NEVER locked to a theme. */
function inferContentRoute(
  text: string,
  availableRoleKeys: string[],
  avoidRoleKey?: string | null,
  recentRoleKeys: string[] = [],
  themeLabel?: string | null,
): ContentRoute {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const has = (re: RegExp) => re.test(raw) || re.test(lower);

  const multi = (kind: string, reason: string): ContentRoute => ({
    action: "nominate",
    // null → caller uses pickPerspectiveOfficer (multi-view)
    roleKey: pickPerspectiveOfficer({
      availableRoleKeys,
      recentRoleKeys,
      avoidRoleKey,
      themeLabel,
    }),
    kind,
    reason,
  });

  // Explicit unique-fact asks that only the proposer can answer
  if (
    has(
      /実際の価格|想定人数|予算上限|社内制約|未公開|まだ決めてない|決めた数字|正式な金額|正式な人数/,
    )
  ) {
    return {
      action: "ask_proposer",
      roleKey: null,
      kind: "revenue_cost_premise",
      reason: "企画者しか知らない未提示の事実が必要",
    };
  }

  // Profit / ROI / cost: multi-perspective — NOT CFO-only
  if (
    has(
      /ROI|roi|投資回収|回収期間|損益分岐|投資対効果|利益率|粗利|売上|価格|値段|コスト|費用|無料|有料|収益|損失/,
    )
  ) {
    return multi(
      "revenue_cost_premise",
      "利益・コストは多視点（獲得・支払意思・開発費・運用）で前進",
    );
  }
  if (has(/技術実現|実現性|システム化|アプリ化|開発工数|過剰設計|API|インフラ|セキュリティ/)) {
    return multi("tech_feasibility", "技術論点もテーマ解決の一視点として多視点で");
  }
  if (has(/運用|現場|スタッフ教育|マニュアル|オペレーション|シフト|負荷/)) {
    return multi("operations", "運用視点をテーマ解決へ交差させる");
  }
  if (has(/顧客心理|使いた|分かりやす|不快|強制感|劣等感|本音|支払/)) {
    return multi("customer_psychology", "顧客視点をテーマ解決へ交差させる");
  }
  if (has(/ブランド|訴求|獲得チャネル|口コミ|マーケ|認知/)) {
    return multi("brand", "マーケ視点をテーマ解決へ交差させる");
  }

  return multi("other", "役員同士で論点を多視点に深める");
}

function routeFromRoutingKind(
  kind: string | null | undefined,
  availableRoleKeys: string[],
  avoidRoleKey?: string | null,
  recentRoleKeys: string[] = [],
  themeLabel?: string | null,
): ContentRoute | null {
  if (!kind) return null;

  // Never lock a routingKind to a single role — pick a fresh perspective
  const roleKey = pickPerspectiveOfficer({
    availableRoleKeys,
    recentRoleKeys,
    avoidRoleKey,
    themeLabel,
  });

  const reasons: Record<string, string> = {
    plan_content: "企画内容は多視点で先に深掘り",
    revenue_cost_premise: "収益・コスト前提は多視点で交差させる",
    roi_calc: "ROI論点もCFO専有にせず多視点で構造確認",
    tech_feasibility: "技術視点をテーマ解決へ",
    operations: "運用視点をテーマ解決へ",
    customer_psychology: "顧客視点をテーマ解決へ",
    brand: "マーケ視点をテーマ解決へ",
    other: "多視点で前進",
  };

  if (
    kind === "plan_content" ||
    kind === "revenue_cost_premise" ||
    kind === "roi_calc" ||
    kind === "tech_feasibility" ||
    kind === "operations" ||
    kind === "customer_psychology" ||
    kind === "brand" ||
    kind === "other"
  ) {
    return {
      action: "nominate",
      roleKey,
      kind,
      reason: reasons[kind] ?? "多視点で前進",
    };
  }
  return null;
}

function detectOfficerRedirectFromProposer(
  text: string,
  availableRoleKeys: string[],
): string | null {
  if (!/(聞きたい|聞いて|意見|どう思う|振って|回して|話して)/.test(text)) {
    return null;
  }
  const rules: Array<[RegExp, string]> = [
    [/マーケ|マーケティング|訴求|ブランド|獲得/, "marketing"],
    [/CFO|財務|ROI|利益|原価/, "cfo"],
    [/CTO|技術|システム|開発/, "cto"],
    [/現場|運用|オペレーション|スタッフ/, "operations"],
    [/顧客代表|顧客心理|ユーザー|利用者/, "customer"],
    [/バランサ|Simply|過剰/, "quality_balancer"],
  ];
  for (const [re, role] of rules) {
    if (re.test(text) && availableRoleKeys.includes(role)) return role;
  }
  return null;
}

function recentAskProposerHeavy(messages: DiscussionMessage[]): boolean {
  const recent = messages.slice(-10);
  const asks = recent.filter((m) => m.messageType === "ask_proposer").length;
  const officerTurns = recent.filter(
    (m) => m.speakerType === "board_member" || m.speakerType === "executive",
  ).length;
  return asks >= 2 || (asks >= 1 && officerTurns < 2);
}

/**
 * Officer-first facilitation:
 * - deepen officer debate by default
 * - never bounce a question back to the asker
 * - ask_proposer only for unique facts / aligned revision requests
 * - honor proposer redirects to other officers
 */
function applyContentRoutingGuard(args: {
  state: WallChatState;
  availableRoleKeys: string[];
  action: DiscussionFacilitatorOutput["action"];
  nextSpeakerRoleKey: string | null;
  nominateReason: string;
  chairUtterance: string | null;
  routingKind?: string | null;
  /** When true, do not let auto content router overwrite the locked pick */
  nominationLocked?: boolean;
}): {
  action: DiscussionFacilitatorOutput["action"];
  nextSpeakerRoleKey: string | null;
  nominateReason: string;
  chairUtterance: string | null;
} {
  const last = lastMeaningfulUtterance(args.state.messages);
  const askerRole = last?.roleKey ?? null;

  // Prefer last proposer message if the latest meaningful speaker is proposer
  let lastProposerText: string | null = null;
  for (let i = args.state.messages.length - 1; i >= 0; i -= 1) {
    const m = args.state.messages[i]!;
    if (m.speakerType === "proposer" || m.speakerType === "user") {
      lastProposerText = m.text;
      break;
    }
    if (m.speakerType === "board_member" || m.speakerType === "executive") {
      break;
    }
  }

  const redirected =
    lastProposerText &&
    detectOfficerRedirectFromProposer(
      lastProposerText,
      args.availableRoleKeys,
    );

  const recent = recentBoardRoleKeys(args.state.messages);
  const themeLabel = args.state.activeTheme;
  const monopoly = detectThemeMonopoly({ recentRoleKeys: recent });

  const routeFromKind = routeFromRoutingKind(
    args.routingKind,
    args.availableRoleKeys,
    askerRole,
    recent,
    themeLabel,
  );
  const routeFromText = inferContentRoute(
    last?.text ?? args.state.priorityIssues[0] ?? "",
    args.availableRoleKeys,
    askerRole,
    recent,
    themeLabel,
  );
  const preferred = routeFromKind ?? routeFromText;

  let action = args.action;
  let nextSpeakerRoleKey = args.nextSpeakerRoleKey;
  let nominateReason = args.nominateReason;
  let chairUtterance = args.chairUtterance;
  const locked = Boolean(args.nominationLocked && nextSpeakerRoleKey);

  // Priority 1: Proposer handed discussion to an officer
  if (redirected) {
    return {
      action: "nominate",
      nextSpeakerRoleKey: redirected,
      nominateReason: `企画者が${roleDisplayLabel(redirected)}へ議論を振ったので役員同士で継続`,
      chairUtterance: null,
    };
  }

  // Suppress ask_proposer spam: keep officers talking
  if (
    action === "ask_proposer" &&
    recentAskProposerHeavy(args.state.messages)
  ) {
    action = "nominate";
    if (!locked) {
      nextSpeakerRoleKey =
        preferred.roleKey && preferred.roleKey !== askerRole
          ? preferred.roleKey
          : null;
    }
    nominateReason = "企画者への質問が続いたため、先に役員同士で深掘り";
    chairUtterance = null;
  }

  // If model asked proposer but officers can debate, prefer nominate
  if (
    action === "ask_proposer" &&
    preferred.action === "nominate" &&
    args.routingKind !== "plan_content" &&
    !/未提示|しか知らない|修正案|合意後/.test(args.nominateReason)
  ) {
    if (preferred.kind !== "revenue_cost_premise" || preferred.action === "nominate") {
      action = "nominate";
      if (!locked) {
        nextSpeakerRoleKey = preferred.roleKey;
        nominateReason = preferred.reason || "役員同士で先に議論";
      }
      if (chairUtterance && /企画者/.test(chairUtterance)) {
        chairUtterance = null;
      }
    }
  }

  // Stronger: default ask_proposer → nominate unless unique-fact wording
  if (
    action === "ask_proposer" &&
    !/未提示|しか知らない|正式|修正案|意見が揃|合意/.test(
      `${args.nominateReason}${chairUtterance ?? ""}`,
    ) &&
    preferred.action === "nominate"
  ) {
    action = "nominate";
    if (!locked) {
      nextSpeakerRoleKey =
        preferred.roleKey ??
        nextSpeakerRoleKey ??
        null;
      nominateReason = preferred.reason || "役員同士の議論を優先";
    }
    chairUtterance = null;
  }

  // Explicit nomination lock: skip auto overwrite / monopoly rotate
  if (locked && action === "nominate") {
    if (askerRole && nextSpeakerRoleKey === askerRole) {
      // Anti-bounce with visible reason
      nextSpeakerRoleKey =
        preferred.roleKey && preferred.roleKey !== askerRole
          ? preferred.roleKey
          : null;
      nominateReason = `${roleDisplayLabel(askerRole)}は直前発言者のため別視点で先に補足`;
      chairUtterance =
        chairUtterance?.trim() ||
        formatNominationOverrideNotice(
          askerRole,
          nextSpeakerRoleKey ?? "operations",
          nominateReason,
        );
    }
    return { action, nextSpeakerRoleKey, nominateReason, chairUtterance };
  }

  const bouncing =
    askerRole &&
    action === "nominate" &&
    nextSpeakerRoleKey === askerRole;

  if (bouncing) {
    if (
      preferred.roleKey &&
      preferred.roleKey !== askerRole &&
      args.availableRoleKeys.includes(preferred.roleKey)
    ) {
      nextSpeakerRoleKey = preferred.roleKey;
      nominateReason = preferred.reason;
      chairUtterance = null;
    } else {
      action = "nominate";
      nextSpeakerRoleKey = null;
      nominateReason = "質問者への回し返し禁止。別の役員で議論を継続";
      chairUtterance = null;
    }
  }

  // Fill missing nominate target from content route (only when unlocked / empty)
  if (
    action === "nominate" &&
    preferred.action === "nominate" &&
    preferred.roleKey &&
    preferred.roleKey !== askerRole &&
    args.availableRoleKeys.includes(preferred.roleKey) &&
    (!nextSpeakerRoleKey || nextSpeakerRoleKey === askerRole)
  ) {
    nextSpeakerRoleKey = preferred.roleKey;
    nominateReason = preferred.reason;
  }

  // Final hard rule: never nominate the asker; prefer another officer over proposer
  if (
    action === "nominate" &&
    askerRole &&
    nextSpeakerRoleKey === askerRole
  ) {
    nextSpeakerRoleKey =
      preferred.roleKey && preferred.roleKey !== askerRole
        ? preferred.roleKey
        : null;
    nominateReason = "質問した本人への回し返し禁止。別役員で前進";
    chairUtterance = null;
  }

  // Theme monopoly: break role lock only when nomination is NOT explicit
  if (action === "nominate") {
    const ban =
      monopoly.monopolized && monopoly.roleKey ? monopoly.roleKey : null;
    const recentHeavy =
      nextSpeakerRoleKey &&
      recent.slice(-3).filter((r) => r === nextSpeakerRoleKey).length >= 2;
    if (ban || recentHeavy) {
      const fresh = pickPerspectiveOfficer({
        availableRoleKeys: args.availableRoleKeys,
        recentRoleKeys: recent,
        avoidRoleKey: askerRole,
        themeLabel,
        banRoleKey: ban ?? nextSpeakerRoleKey,
      });
      if (fresh && fresh !== nextSpeakerRoleKey) {
        const intended = nextSpeakerRoleKey;
        nextSpeakerRoleKey = fresh;
        nominateReason = `テーマ「${themeLabel}」の多視点展開（${perspectiveHint(fresh)}）`;
        if (!chairUtterance || /CFO|お願いします/.test(chairUtterance)) {
          chairUtterance = intended
            ? formatNominationOverrideNotice(
                intended,
                fresh,
                "同一役員の連続を避け多視点で前進",
              )
            : broadenPerspectiveUtterance(themeLabel, fresh);
        }
      }
    }
  }

  return { action, nextSpeakerRoleKey, nominateReason, chairUtterance };
}


/**
 * Theme facilitation without fixed order:
 * - CEO manages current theme + issues
 * - Perspectives that help the theme are allowed (no auto park-aside)
 * - close_theme → declare organized, pick next unresolved issue as theme
 * - Rotate among all officers on the current theme
 */
function applyThemeFacilitation(args: {
  state: WallChatState;
  availableRoleKeys: string[];
  action: DiscussionFacilitatorOutput["action"];
  nextSpeakerRoleKey: string | null;
  nominateReason: string;
  chairUtterance: string | null;
  activeTheme?: string | null;
  themeAction?: string | null;
  lastUtteranceText?: string | null;
}): {
  action: DiscussionFacilitatorOutput["action"];
  nextSpeakerRoleKey: string | null;
  nominateReason: string;
  chairUtterance: string | null;
  closedNow: boolean;
} {
  const previousTheme = args.state.activeTheme;
  if (typeof args.activeTheme === "string" && args.activeTheme.trim()) {
    // Officers must not change theme; only close_theme path may
    const themeAction = args.themeAction ?? "continue";
    if (themeAction === "close_theme" || args.action === "propose_end") {
      // allow below
    } else {
      // Keep existing theme; ignore model jumping themes mid-discussion
      args.state.activeTheme = previousTheme;
    }
  }

  let active = normalizeThemeLabel(args.state.activeTheme);
  args.state.activeTheme = active;

  let action = args.action;
  let nextSpeakerRoleKey = args.nextSpeakerRoleKey;
  let nominateReason = args.nominateReason;
  let chairUtterance = args.chairUtterance;
  let closedNow = false;

  const themeAction = args.themeAction ?? "continue";

  if (themeAction === "close_theme" || args.action === "propose_end") {
    closedNow = true;
    // Move current theme label into resolved if not already an issue label
    if (!args.state.resolvedIssues.includes(previousTheme)) {
      args.state.resolvedIssues = dedupeIssueLabels([
        ...args.state.resolvedIssues,
        previousTheme,
      ]);
    }
    args.state.unresolvedIssues = args.state.unresolvedIssues.filter(
      (label) => label !== previousTheme,
    );

    const modelNext =
      typeof args.activeTheme === "string" &&
      args.activeTheme.trim() &&
      normalizeThemeLabel(args.activeTheme) !== previousTheme
        ? normalizeThemeLabel(args.activeTheme)
        : null;
    const nxt =
      modelNext ??
      pickNextThemeFromIssues(args.state.unresolvedIssues, previousTheme);
    if (nxt) {
      args.state.activeTheme = nxt;
      active = nxt;
      // Drop the new theme from unresolved (it is now the focus)
      args.state.unresolvedIssues = args.state.unresolvedIssues.filter(
        (label) => label !== nxt,
      );
      action = "nominate";
      nextSpeakerRoleKey = pickPerspectiveOfficer({
        availableRoleKeys: args.availableRoleKeys,
        recentRoleKeys: recentBoardRoleKeys(args.state.messages),
        themeLabel: nxt,
      });
      nominateReason = `次のテーマ「${nxt}」を開始`;
      chairUtterance = `${themeCloseUtterance(previousTheme)} 次は「${nxt}」です。`;
    } else if (args.state.unresolvedIssues.length === 0) {
      chairUtterance =
        chairUtterance?.trim() ||
        `${themeCloseUtterance(previousTheme)} 未解決Issueは一通り整理できました。終了してよいですか？`;
      if (args.action !== "propose_end") {
        action = "propose_end";
      }
    }
    args.state.priorityIssues = args.state.unresolvedIssues.slice(0, 4);
    return {
      action,
      nextSpeakerRoleKey,
      nominateReason,
      chairUtterance,
      closedNow,
    };
  }

  const asker = lastBoardSpeakerRoleKey(args.state.messages);
  const recent = recentBoardRoleKeys(args.state.messages);
  const uniqueRecent = Array.from(new Set(recent.slice(-6)));
  const stalled =
    uniqueRecent.length > 0 &&
    uniqueRecent.length <= 2 &&
    args.state.messages.filter(
      (m) => m.speakerType === "board_member" || m.speakerType === "executive",
    ).length >= 3;

  // One theme, many perspectives — but NEVER overwrite an explicit CEO nomination
  const ceoLock = detectCeoExplicitNomination({
    nextSpeakerRoleKey: args.nextSpeakerRoleKey,
    chairUtterance: args.chairUtterance,
    nominateReason: args.nominateReason,
    availableRoleKeys: args.availableRoleKeys,
  });
  if (ceoLock) {
    nextSpeakerRoleKey = ceoLock.roleKey;
  } else if (action === "nominate" || action === "rare_interrupt" || stalled) {
    const monopoly = detectThemeMonopoly({ recentRoleKeys: recent });
    const next = pickPerspectiveOfficer({
      availableRoleKeys: args.availableRoleKeys,
      recentRoleKeys: recent,
      avoidRoleKey: asker,
      themeLabel: active,
      banRoleKey: monopoly.monopolized ? monopoly.roleKey : null,
    });
    if (next) {
      nextSpeakerRoleKey = next;
      const angle = perspectiveHint(next);
      nominateReason = `テーマ「${active}」への${angle}`;
      if (
        (stalled || monopoly.monopolized) &&
        (!chairUtterance ||
          chairUtterance.length < 8 ||
          /CFO.*お願い|引き続きCFO/.test(chairUtterance))
      ) {
        action = "nominate";
        chairUtterance = broadenPerspectiveUtterance(active, next);
      }
    }
  }

  args.state.priorityIssues = args.state.unresolvedIssues.slice(0, 4);

  return {
    action,
    nextSpeakerRoleKey,
    nominateReason,
    chairUtterance,
    closedNow,
  };
}

function recentBoardRoleKeys(messages: DiscussionMessage[]): string[] {
  return messages
    .filter(
      (m) =>
        (m.speakerType === "board_member" || m.speakerType === "executive") &&
        m.roleKey,
    )
    .map((m) => m.roleKey!)
    .slice(-8);
}

/**
 * Hard guard: never re-ask RESOLVED / ANSWERED / OPEN, and never repeat
 * the same CEO facilitate/nominate utterance (paraphrase included).
 * Converts ask_proposer/chair_nudge/nominate-with-repeat to nominate without
 * reusing the same chairUtterance.
 */
function guardRepeatedCeoQuestion(
  state: WallChatState,
  action: DiscussionFacilitatorOutput["action"] | string,
  chairUtterance: string | null,
  nominateReason: string,
): {
  action: DiscussionFacilitatorOutput["action"];
  chairUtterance: string | null;
  nominateReason: string;
  suppressed: boolean;
} {
  const focus = focusTopicFromState(state);
  return guardRepeatedCeoQuestionCore(
    state,
    action,
    chairUtterance,
    nominateReason,
    focus?.label ?? state.activeTheme,
  );
}

/** @deprecated use applyMeetingMemory */
function applyOpenTopics(
  state: WallChatState,
  next: DiscussionTopic[] | undefined,
): void {
  applyMeetingMemory(state, { openTopics: next });
}

function proposerAnswersFromMessages(messages: DiscussionMessage[]): string[] {
  return messages
    .filter(
      (m) => m.speakerType === "proposer" || m.speakerType === "user",
    )
    .map((m) => m.text.slice(0, 200))
    .slice(-6);
}

function chairNotesFromMessages(messages: DiscussionMessage[]): string[] {
  return messages
    .filter(
      (m) =>
        m.speakerType === "chair" ||
        m.messageType === "facilitate" ||
        m.kind === "brief_summary",
    )
    .map((m) => m.text.slice(0, 200))
    .slice(-6);
}

export type PrepareTurnResult = {
  status:
    | "ready"
    | "paused"
    | "ended"
    | "awaiting_end_confirm"
    | "awaiting_proposer"
    | "chair_only";
  generationId: string | null;
  speaker: { roleKey: string; title: string } | null;
  thinkingTitle: string | null;
  thinkingLine: string | null;
  chairMessage: DiscussionMessage | null;
  summary: ReturnType<typeof publicState>;
};

/**
 * Decide the next speaker (or chair action). Does not generate officer utterance.
 * Client shows thinking UI, then calls speakDiscussionTurn.
 */
export async function prepareDiscussionTurn(args: {
  meetingId: string;
  reviewLevel: ReviewLevel;
  signal?: AbortSignal;
}): Promise<PrepareTurnResult> {
  const { meeting, chair, speakers, project, company } =
    await loadDiscussionContext(args.meetingId);
  const { roundId, state } = await ensureRound(args.meetingId, project);

  if (state.ended) {
    return {
      status: "ended",
      generationId: null,
      speaker: null,
      thinkingTitle: null,
      thinkingLine: null,
      chairMessage: null,
      summary: publicState(state),
    };
  }
  if (state.paused) {
    return {
      status: "paused",
      generationId: null,
      speaker: null,
      thinkingTitle: null,
      thinkingLine: null,
      chairMessage: null,
      summary: publicState(state),
    };
  }
  if (state.awaitingEndConfirm) {
    return {
      status: "awaiting_end_confirm",
      generationId: null,
      speaker: null,
      thinkingTitle: null,
      thinkingLine: null,
      chairMessage: null,
      summary: publicState(state),
    };
  }

  const speakerByRole = new Map(speakers.map((s) => [s.roleKey, s]));
  const availableRoleKeys = speakers.map((s) => s.roleKey);
  const currentPlan = currentPlanFromState(state);
  const generationId = randomUUID();

  // Forced next (from interrupt / rare interrupt queue) — wins over awaiting_proposer
  if (state.forcedNextRoleKey && speakerByRole.has(state.forcedNextRoleKey)) {
    const speaker = speakerByRole.get(state.forcedNextRoleKey)!;
    const line = pickThinkingLine(speaker.roleKey);
    const nominateReason =
      state.forcedNominateReason || "企画者の指名／割り込みへの応答";
    state.forcedNextRoleKey = null;
    state.forcedNominateReason = null;
    state.activeGenerationId = generationId;
    state.pendingSpeak = {
      generationId,
      roleKey: speaker.roleKey,
      nominateReason,
      chairUtterance: null,
      rareInterruptRoleKey: null,
      action: "nominate",
    };
    await persistDiscussion(roundId, args.meetingId, state, {
      appendStatement: false,
    });
    await prisma.meeting.update({
      where: { id: args.meetingId },
      data: {
        status: MEETING_STATUS.DISCUSSION,
        currentStep: MEETING_STEP.DISCUSSION,
        errorMessage: null,
      },
    });
    return {
      status: "ready",
      generationId,
      speaker: { roleKey: speaker.roleKey, title: speaker.title },
      thinkingTitle: thinkingTitle(speaker.title),
      thinkingLine: line,
      chairMessage: null,
      summary: publicState(state),
    };
  }

  if (meeting.status === MEETING_STATUS.AWAITING_DISCUSSION) {
    return {
      status: "awaiting_proposer",
      generationId: null,
      speaker: null,
      thinkingTitle: null,
      thinkingLine: null,
      chairMessage: null,
      summary: publicState(state),
    };
  }

  let facilitatorJsonFailed = false;
  let facilitation: Awaited<ReturnType<typeof runDiscussionFacilitator>>;
  try {
    facilitation = await runDiscussionFacilitator({
      company,
      project,
      chair: toMemberContext(chair),
      availableRoleKeys,
      transcript: state.messages,
      reviewLevel: args.reviewLevel,
      evolvedHints: evolvedHintsFromMessages(state.messages),
      currentPlan,
      planVersions: state.planVersions,
      openTopics: state.openTopics,
      priorityIssues: state.priorityIssues,
      unresolvedIssues: state.unresolvedIssues,
      resolvedIssues: state.resolvedIssues,
      ceoQuestions: state.ceoQuestions,
      decisions: state.decisions,
      rejectedItems: state.rejectedItems,
      lastSpeakerRoleKey: lastBoardSpeakerRoleKey(state.messages),
      activeTheme: state.activeTheme,
      signal: args.signal,
    });
  } catch (error) {
    if (
      args.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    console.info(
      "[Discussion] facilitator JSON failed (isolated) — continuing with fallback nominate",
      error instanceof Error ? error.message.slice(0, 200) : String(error),
    );
    facilitatorJsonFailed = true;
    const fallbackRole = pickFallbackSpeaker(speakers, state.messages);
    const focus = focusTopicFromState(state);
    facilitation = {
      action: "nominate",
      nextSpeakerRoleKey: fallbackRole,
      nominateReason: focus
        ? `重要論点「${focus.label}」を継続`
        : "議論を前進させる",
      chairUtterance:
        "整理の再生成に失敗しましたが、会議は続けます。重要論点から進めます。",
      endReason: null,
      interruptRoleKey: null,
      openTopics:
        state.openTopics.length > 0
          ? state.openTopics
          : [
              {
                id: "continue",
                label: "議論の継続",
                status: "discussing" as const,
                note: null,
              },
            ],
      priorityIssues: derivePriorityIssues(state.openTopics, state.priorityIssues),
      unresolvedIssues: state.unresolvedIssues,
      resolvedIssues: state.resolvedIssues,
      ceoQuestions: state.ceoQuestions,
      decisions: state.decisions,
      rejectedItems: state.rejectedItems,
      activeTheme: state.activeTheme,
      themeAction: "continue",
      repetitionDetected: false,
    };
  }

  if (args.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  applyMeetingMemory(state, {
    openTopics: facilitation.openTopics,
    priorityIssues: derivePriorityIssues(
      facilitation.openTopics,
      facilitation.priorityIssues,
    ),
    unresolvedIssues: facilitation.unresolvedIssues,
    resolvedIssues: facilitation.resolvedIssues,
    ceoQuestions: facilitation.ceoQuestions,
    decisions: facilitation.decisions,
    rejectedItems: facilitation.rejectedItems,
    activeTheme: facilitation.activeTheme,
  });

  const lastUtterance = lastMeaningfulUtterance(state.messages);
  let themeGate = applyThemeFacilitation({
    state,
    availableRoleKeys,
    action: facilitation.action,
    nextSpeakerRoleKey: facilitation.nextSpeakerRoleKey,
    nominateReason: facilitation.nominateReason,
    chairUtterance: facilitation.chairUtterance,
    activeTheme: facilitation.activeTheme ?? state.activeTheme,
    themeAction: facilitation.themeAction,
    lastUtteranceText: lastUtterance?.text ?? null,
  });

  const open = unresolvedTopics(state.openTopics);
  const canProposeEnd =
    (themeGate.action === "propose_end" ||
      facilitation.action === "propose_end") &&
    state.unresolvedIssues.length === 0 &&
    (state.resolvedIssues.length > 0 || topicsAllResolved(state.openTopics));

  // End only when the CEO issue board is fully resolved — never by turn count.
  if (canProposeEnd) {
    const endText =
      facilitation.chairUtterance?.trim() ||
      facilitation.endReason?.trim() ||
      "論点は一通り収束しました。終了してよいですか？";
    const chairMessage = pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: endText.slice(0, 150),
      moveType: "brake",
      kind: "chat",
      messageType: "propose_end",
      metadata: {
        openTopics: state.openTopics,
        priorityIssues: state.priorityIssues,
        ceoQuestions: state.ceoQuestions,
        decisions: state.decisions,
        rejectedItems: state.rejectedItems,
      },
    });
    state.awaitingEndConfirm = true;
    state.activeGenerationId = null;
    state.pendingSpeak = null;
    await persistDiscussion(roundId, args.meetingId, state);
    await prisma.meeting.update({
      where: { id: args.meetingId },
      data: {
        status: MEETING_STATUS.DISCUSSION,
        currentStep: MEETING_STEP.DISCUSSION,
        errorMessage: null,
      },
    });
    return {
      status: "awaiting_end_confirm",
      generationId: null,
      speaker: null,
      thinkingTitle: null,
      thinkingLine: null,
      chairMessage,
      summary: publicState(state),
    };
  }

  // Model tried to end while issues remain → keep discussing the open issue
  let forcedAction = themeGate.action;
  let forcedNominateReason = themeGate.nominateReason;
  let forcedChairUtterance = themeGate.chairUtterance;
  let routedNextSpeaker =
    themeGate.nextSpeakerRoleKey &&
    speakerByRole.has(themeGate.nextSpeakerRoleKey)
      ? themeGate.nextSpeakerRoleKey
      : facilitation.nextSpeakerRoleKey &&
          speakerByRole.has(facilitation.nextSpeakerRoleKey)
        ? facilitation.nextSpeakerRoleKey
        : null;
  if (
    (facilitation.action === "propose_end" || themeGate.action === "propose_end") &&
    state.unresolvedIssues.length > 0
  ) {
    // Unresolved issues remain — continue current theme instead of ending
    forcedAction = "nominate";
    const focusRole = pickPerspectiveOfficer({
      availableRoleKeys,
      recentRoleKeys: recentBoardRoleKeys(state.messages),
      avoidRoleKey: lastBoardSpeakerRoleKey(state.messages),
      themeLabel: state.activeTheme,
    });
    routedNextSpeaker = focusRole;
    forcedNominateReason = `テーマ「${state.activeTheme}」を多視点で継続`;
    if (!themeGate.closedNow) {
      forcedChairUtterance =
        forcedChairUtterance ||
        `まだ未解決Issueがあります。テーマ「${state.activeTheme}」を続けましょう。`;
    }
  }

  let chairUtteranceSuppressed = false;
  const ceoExplicitLock = detectCeoExplicitNomination({
    nextSpeakerRoleKey:
      facilitation.nextSpeakerRoleKey &&
      speakerByRole.has(facilitation.nextSpeakerRoleKey)
        ? facilitation.nextSpeakerRoleKey
        : routedNextSpeaker,
    chairUtterance: forcedChairUtterance ?? facilitation.chairUtterance,
    nominateReason: forcedNominateReason,
    availableRoleKeys,
  });
  {
    const inputChair = forcedChairUtterance ?? facilitation.chairUtterance;
    const guarded = guardRepeatedCeoQuestion(
      state,
      forcedAction,
      inputChair,
      forcedNominateReason,
    );
    forcedAction = guarded.action;
    forcedChairUtterance = guarded.chairUtterance;
    forcedNominateReason = guarded.nominateReason;
    if (guarded.suppressed) chairUtteranceSuppressed = true;
  }

  {
    const routed = applyContentRoutingGuard({
      state,
      availableRoleKeys,
      action: forcedAction,
      nextSpeakerRoleKey: routedNextSpeaker,
      nominateReason: forcedNominateReason,
      chairUtterance: chairUtteranceSuppressed
        ? forcedChairUtterance
        : (forcedChairUtterance ?? facilitation.chairUtterance),
      routingKind: facilitation.routingKind,
      nominationLocked: Boolean(ceoExplicitLock),
    });
    forcedAction = routed.action;
    forcedNominateReason = routed.nominateReason;
    forcedChairUtterance = routed.chairUtterance;
    routedNextSpeaker = routed.nextSpeakerRoleKey;
  }

  // Priority-aware next speaker (proposer > CEO > addressed > auto > missing)
  {
    const asker = lastBoardSpeakerRoleKey(state.messages);
    const recent = recentBoardRoleKeys(state.messages);
    const missingPick = pickPerspectiveOfficer({
      availableRoleKeys,
      recentRoleKeys: recent,
      avoidRoleKey: asker,
      themeLabel: state.activeTheme,
    });
    const resolved = resolveNextSpeaker({
      availableRoleKeys,
      messages: state.messages,
      facilitatorNextSpeaker:
        ceoExplicitLock?.roleKey ??
        facilitation.nextSpeakerRoleKey ??
        routedNextSpeaker,
      chairUtterance: forcedChairUtterance ?? facilitation.chairUtterance,
      nominateReason: forcedNominateReason,
      autoCandidate: routedNextSpeaker,
      missingPerspectivePick: missingPick,
      askerRole: asker,
    });
    if (resolved.roleKey) {
      routedNextSpeaker = resolved.roleKey;
    }
    if (resolved.overrideReason) {
      forcedChairUtterance =
        forcedChairUtterance?.trim() || resolved.overrideReason;
      chairUtteranceSuppressed = false;
      forcedNominateReason = resolved.overrideReason;
    }
    // Locked CEO/proposer nomination: do not run monopoly auto-rotate below
    if (resolved.locked) {
      // skip needRotate block by marking via forced reason only
    } else if (forcedAction === "nominate" || forcedAction === "rare_interrupt") {
      const monopoly = detectThemeMonopoly({ recentRoleKeys: recent });
      const routedHeavy =
        routedNextSpeaker &&
        recent.slice(-3).filter((r) => r === routedNextSpeaker).length >= 2;
      const needRotate =
        !routedNextSpeaker ||
        routedNextSpeaker === asker ||
        monopoly.monopolized ||
        Boolean(routedHeavy);

      if (needRotate) {
        const focusPick = pickPerspectiveOfficer({
          availableRoleKeys,
          recentRoleKeys: recent,
          avoidRoleKey: asker,
          themeLabel: state.activeTheme,
          banRoleKey: monopoly.monopolized
            ? monopoly.roleKey
            : routedHeavy
              ? routedNextSpeaker
              : null,
        });
        if (focusPick) {
          const intended = routedNextSpeaker;
          routedNextSpeaker = focusPick;
          forcedNominateReason = `テーマ「${state.activeTheme}」への${perspectiveHint(focusPick)}`;
          if (intended && intended !== focusPick && monopoly.monopolized) {
            forcedChairUtterance = formatNominationOverrideNotice(
              intended,
              focusPick,
              "同一役員の連続を避け多視点で前進",
            );
            chairUtteranceSuppressed = false;
          } else if (
            monopoly.monopolized &&
            (!forcedChairUtterance ||
              /CFO.*お願い|引き続きCFO|具体的な数字/.test(
                forcedChairUtterance,
              ))
          ) {
            forcedChairUtterance = broadenPerspectiveUtterance(
              state.activeTheme,
              focusPick,
            );
          }
        }
      }
    }
  }

  // If theme gate produced chair_nudge, honor it
  if (themeGate.action === "chair_nudge" && themeGate.chairUtterance) {
    forcedAction = "chair_nudge";
    forcedChairUtterance = themeGate.chairUtterance;
    forcedNominateReason = themeGate.nominateReason;
    chairUtteranceSuppressed = false;
  }

  // Preserve close-and-advance announcement
  if (themeGate.closedNow && themeGate.chairUtterance) {
    forcedChairUtterance = themeGate.chairUtterance;
    chairUtteranceSuppressed = false;
    if (themeGate.action === "nominate") {
      forcedAction = "nominate";
      if (themeGate.nextSpeakerRoleKey) {
        routedNextSpeaker = themeGate.nextSpeakerRoleKey;
      }
      forcedNominateReason = themeGate.nominateReason;
    }
  }

  // Final pass: block any resurrected / paraphrased CEO question
  {
    const candidate = chairUtteranceSuppressed
      ? forcedChairUtterance
      : (forcedChairUtterance ?? facilitation.chairUtterance);
    const guarded = guardRepeatedCeoQuestion(
      state,
      forcedAction,
      candidate,
      forcedNominateReason,
    );
    forcedAction = guarded.action;
    forcedChairUtterance = guarded.chairUtterance;
    forcedNominateReason = guarded.nominateReason;
    if (guarded.suppressed) chairUtteranceSuppressed = true;
  }

  if (forcedAction === "ask_proposer") {
    let chairMessage: DiscussionMessage | null = null;
    const askText = (
      (chairUtteranceSuppressed
        ? forcedChairUtterance
        : forcedChairUtterance ?? facilitation.chairUtterance) ?? ""
    )
      .trim()
      .slice(0, 150);
    if (askText && !isRepeatedCeoChairUtterance({
      ceoQuestions: state.ceoQuestions,
      messages: state.messages,
      text: askText,
    })) {
      registerOpenCeoQuestion(state, askText);
      chairMessage = pushMessage(state, {
        speakerType: "chair",
        roleKey: chair.roleKey,
        title: chair.title,
        text: askText,
        moveType: "question",
        nominateReason: forcedNominateReason,
        kind: "chat",
        messageType: "ask_proposer",
        metadata: {
          openTopics: state.openTopics,
          priorityIssues: state.priorityIssues,
          ceoQuestions: state.ceoQuestions,
          decisions: state.decisions,
          rejectedItems: state.rejectedItems,
        },
      });
      state.activeGenerationId = null;
      state.pendingSpeak = null;
      runDebuggerPass(
        state,
        args.reviewLevel,
        {
          lastFacilitatorAction: "ask_proposer",
          lastRoutedRole: null,
          lastAskerRole: lastBoardSpeakerRoleKey(state.messages),
          facilitatorJsonFailed,
        },
        availableRoleKeys,
      );
      await persistDiscussion(roundId, args.meetingId, state);
      await prisma.meeting.update({
        where: { id: args.meetingId },
        data: {
          status: MEETING_STATUS.AWAITING_DISCUSSION,
          currentStep: MEETING_STEP.DISCUSSION,
          errorMessage: null,
        },
      });
      return {
        status: "awaiting_proposer",
        generationId: null,
        speaker: null,
        thinkingTitle: null,
        thinkingLine: null,
        chairMessage,
        summary: publicState(state),
      };
    }
    // Fall through to officer debate instead of re-asking
    forcedAction = "nominate";
    forcedChairUtterance = null;
    chairUtteranceSuppressed = true;
  }

  if (forcedAction === "chair_nudge") {
    const text = (
      (chairUtteranceSuppressed
        ? forcedChairUtterance
        : forcedChairUtterance ?? facilitation.chairUtterance) ??
      "ちょっと待って。今の話、企画者はどう思う？"
    ).trim();
    if (
      isRepeatedCeoChairUtterance({
        ceoQuestions: state.ceoQuestions,
        messages: state.messages,
        text,
      })
    ) {
      forcedAction = "nominate";
      forcedChairUtterance = null;
      chairUtteranceSuppressed = true;
    } else {
      registerOpenCeoQuestion(state, text);
      const chairMessage = pushMessage(state, {
        speakerType: "chair",
        roleKey: chair.roleKey,
        title: chair.title,
        text: text.slice(0, 150),
        moveType: "question",
        nominateReason: forcedNominateReason,
        kind: "chat",
        messageType: "chair_nudge",
        metadata: {
          openTopics: state.openTopics,
          priorityIssues: state.priorityIssues,
          ceoQuestions: state.ceoQuestions,
          decisions: state.decisions,
          rejectedItems: state.rejectedItems,
        },
      });
      state.activeGenerationId = null;
      state.pendingSpeak = null;
      runDebuggerPass(
        state,
        args.reviewLevel,
        {
          lastFacilitatorAction: "chair_nudge",
          lastRoutedRole: routedNextSpeaker,
          lastAskerRole: lastBoardSpeakerRoleKey(state.messages),
          facilitatorJsonFailed,
        },
        availableRoleKeys,
      );
      await persistDiscussion(roundId, args.meetingId, state);
      await prisma.meeting.update({
        where: { id: args.meetingId },
        data: {
          status: MEETING_STATUS.AWAITING_DISCUSSION,
          currentStep: MEETING_STEP.DISCUSSION,
          errorMessage: null,
        },
      });
      return {
        status: "awaiting_proposer",
        generationId: null,
        speaker: null,
        thinkingTitle: null,
        thinkingLine: null,
        chairMessage,
        summary: publicState(state),
      };
    }
  }

  // nominate or rare_interrupt (or overridden propose_end → nominate)
  // Content-based route wins; never bounce to the last asker.
  const askerRole = lastBoardSpeakerRoleKey(state.messages);
  let roleKey =
    routedNextSpeaker && speakerByRole.has(routedNextSpeaker)
      ? routedNextSpeaker
      : facilitation.nextSpeakerRoleKey &&
          speakerByRole.has(facilitation.nextSpeakerRoleKey) &&
          facilitation.nextSpeakerRoleKey !== askerRole
        ? facilitation.nextSpeakerRoleKey
        : pickFallbackSpeaker(speakers, state.messages, askerRole);

  if (askerRole && roleKey === askerRole) {
    roleKey = pickFallbackSpeaker(speakers, state.messages, askerRole);
  }

  const speaker = speakerByRole.get(roleKey);
  if (!speaker) throw new Error(`壁打ち発言者 ${roleKey} が見つかりません。`);

  let rareInterruptRoleKey: string | null = null;
  if (
    forcedAction === "rare_interrupt" &&
    facilitation.interruptRoleKey &&
    speakerByRole.has(facilitation.interruptRoleKey) &&
    facilitation.interruptRoleKey !== roleKey
  ) {
    rareInterruptRoleKey = facilitation.interruptRoleKey;
  } else if (Math.random() < 0.08) {
    // Rare natural barge-in (~8%)
    const barge = speakers.find(
      (s) => s.roleKey !== roleKey && !["ceo"].includes(s.roleKey),
    );
    if (barge) rareInterruptRoleKey = barge.roleKey;
  }

  let chairMessage: DiscussionMessage | null = null;
  let chairText = (
    chairUtteranceSuppressed
      ? forcedChairUtterance?.trim() || ""
      : forcedChairUtterance?.trim() || facilitation.chairUtterance?.trim() || ""
  );
  if (
    chairText &&
    isRepeatedCeoChairUtterance({
      ceoQuestions: state.ceoQuestions,
      messages: state.messages,
      text: chairText,
    })
  ) {
    chairText = "";
    forcedChairUtterance = null;
    forcedNominateReason =
      forcedNominateReason ||
      "同一司会発話の繰り返しを避け、別視点で前進";
  }
  if (chairText) {
    registerOpenCeoQuestion(state, chairText);
    chairMessage = pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: chairText.slice(0, 150),
      moveType: "expand",
      nominateReason: forcedNominateReason,
      kind: "chat",
      messageType: "facilitate",
      metadata: {
        openTopics: state.openTopics,
        priorityIssues: state.priorityIssues,
        ceoQuestions: state.ceoQuestions,
        decisions: state.decisions,
        rejectedItems: state.rejectedItems,
      },
    });
  }

  // Apply forced next speaker from prior debugger repair
  if (
    state.forcedNextRoleKey &&
    speakerByRole.has(state.forcedNextRoleKey) &&
    state.forcedNextRoleKey !== askerRole
  ) {
    const forced = speakerByRole.get(state.forcedNextRoleKey)!;
    roleKey = forced.roleKey;
  }

  const line = pickThinkingLine(
    (speakerByRole.get(roleKey) ?? speaker).roleKey,
  );
  const focusTopic = focusTopicFromState(state);
  const finalSpeaker = speakerByRole.get(roleKey) ?? speaker;
  state.activeGenerationId = generationId;
  state.pendingSpeak = {
    generationId,
    roleKey: finalSpeaker.roleKey,
    nominateReason:
      state.forcedNominateReason ||
      forcedNominateReason ||
      (focusTopic
        ? `重要論点「${focusTopic.label}」への視点`
        : "今の流れで一番刺さる視点"),
    chairUtterance: forcedChairUtterance,
    rareInterruptRoleKey,
    action: forcedAction === "propose_end" ? "nominate" : forcedAction,
  };
  // Consume one-shot debugger force
  state.forcedNextRoleKey = null;
  state.forcedNominateReason = null;

  runDebuggerPass(
    state,
    args.reviewLevel,
    {
      lastFacilitatorAction: forcedAction,
      lastRoutedRole: finalSpeaker.roleKey,
      lastAskerRole: askerRole,
      facilitatorJsonFailed,
    },
    availableRoleKeys,
  );

  await persistDiscussion(roundId, args.meetingId, state, {
    appendStatement: chairMessage ? undefined : false,
  });

  await prisma.meeting.update({
    where: { id: args.meetingId },
    data: {
      status: MEETING_STATUS.DISCUSSION,
      currentStep: MEETING_STEP.DISCUSSION,
      errorMessage: null,
    },
  });

  return {
    status: "ready",
    generationId,
    speaker: { roleKey: finalSpeaker.roleKey, title: finalSpeaker.title },
    thinkingTitle: thinkingTitle(finalSpeaker.title),
    thinkingLine: line,
    chairMessage,
    summary: publicState(state),
  };
}

export type SpeakTurnResult = {
  status: "spoken" | "stale" | "aborted" | "paused" | "ended";
  message: DiscussionMessage | null;
  interruptQueued: boolean;
  summary: ReturnType<typeof publicState>;
};

export async function speakDiscussionTurn(args: {
  meetingId: string;
  generationId: string;
  reviewLevel: ReviewLevel;
  signal?: AbortSignal;
}): Promise<SpeakTurnResult> {
  const { chair, speakers, project, company } = await loadDiscussionContext(
    args.meetingId,
  );
  const { roundId, state } = await ensureRound(args.meetingId, project);

  if (state.ended) {
    return {
      status: "ended",
      message: null,
      interruptQueued: false,
      summary: publicState(state),
    };
  }
  if (state.paused) {
    return {
      status: "paused",
      message: null,
      interruptQueued: false,
      summary: publicState(state),
    };
  }

  const pending = state.pendingSpeak;
  if (
    !pending ||
    pending.generationId !== args.generationId ||
    state.activeGenerationId !== args.generationId
  ) {
    return {
      status: "stale",
      message: null,
      interruptQueued: false,
      summary: publicState(state),
    };
  }

  const speaker = speakers.find((s) => s.roleKey === pending.roleKey);
  if (!speaker) throw new Error(`発言者 ${pending.roleKey} が見つかりません。`);

  const currentPlan = currentPlanFromState(state);

  let utterance;
  try {
    utterance = await runDiscussionUtterance({
      company,
      project,
      member: toMemberContext(speaker),
      reviewLevel: args.reviewLevel,
      transcript: state.messages,
      nominateReason: pending.nominateReason,
      currentPlan,
      decisions: state.decisions,
      rejectedItems: state.rejectedItems,
      openTopics: state.openTopics,
      ceoQuestions: state.ceoQuestions,
      proposerAnswers: proposerAnswersFromMessages(state.messages),
      chairNotes: chairNotesFromMessages(state.messages),
      activeTheme: state.activeTheme,
      activeThemeLabel: state.activeTheme,
      signal: args.signal,
    });
  } catch (error) {
    if (
      args.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      // Do not persist incomplete utterance
      if (state.activeGenerationId === args.generationId) {
        state.activeGenerationId = null;
        state.pendingSpeak = null;
        runDebuggerPass(
          state,
          args.reviewLevel,
          { apiTimeout: true },
          speakers.map((s) => s.roleKey),
        );
        await persistDiscussion(roundId, args.meetingId, state, {
          appendStatement: false,
        });
      }
      return {
        status: "aborted",
        message: null,
        interruptQueued: false,
        summary: publicState(state),
      };
    }
    throw error;
  }

  // Re-check after await — interrupt may have cleared generation
  const fresh = await ensureRound(args.meetingId, project);
  if (
    fresh.state.activeGenerationId !== args.generationId ||
    fresh.state.pendingSpeak?.generationId !== args.generationId
  ) {
    runDebuggerPass(
      fresh.state,
      args.reviewLevel,
      { staleResponseDiscarded: true },
      speakers.map((s) => s.roleKey),
    );
    await persistDiscussion(fresh.roundId, args.meetingId, fresh.state, {
      appendStatement: false,
    });
    return {
      status: "stale",
      message: null,
      interruptQueued: false,
      summary: publicState(fresh.state),
    };
  }

  const liveState = fresh.state;
  const prevText = [...liveState.messages]
    .reverse()
    .find(
      (m) =>
        m.kind !== "diagnostic" &&
        (m.speakerType === "board_member" || m.speakerType === "executive"),
    )?.text;
  const duplicateResponseDetected = Boolean(
    prevText && prevText === utterance.text.slice(0, 150),
  );
  const answeringCeoNomination = Boolean(
    pending.nominateReason || pending.chairUtterance,
  );
  const address = normalizeUtteranceAddress({
    text: utterance.text,
    moveType: utterance.moveType,
    speakerRoleKey: speaker.roleKey,
    availableRoleKeys: speakers.map((s) => s.roleKey),
    addressTo: utterance.addressTo,
    addressRoleKey: utterance.addressRoleKey,
    targetType: utterance.targetType,
    targetParticipantId: utterance.targetParticipantId,
    answeringCeoNomination,
  });
  const message = pushMessage(liveState, {
    speakerType: "board_member",
    roleKey: speaker.roleKey,
    title: speaker.title,
    speakerId: speaker.id,
    text: utterance.text.slice(0, 150),
    addressTo: address.addressTo,
    addressRoleKey: address.addressRoleKey,
    targetType: address.targetType,
    targetParticipantId: address.targetParticipantId,
    moveType: utterance.moveType,
    nominateReason: pending.nominateReason,
    kind: "chat",
    messageType: utterance.moveType,
  });
  markOpenQuestionsAnsweredByOfficerProgress(liveState, utterance.text);

  let interruptQueued = false;
  if (pending.rareInterruptRoleKey) {
    const prefaces = [
      "少し補足します。",
      "その点には異論があります。",
      "ちょっと待って、そこは大事です。",
    ];
    const preface = shufflePick(prefaces);
    liveState.forcedNextRoleKey = pending.rareInterruptRoleKey;
    liveState.forcedNominateReason = `自然な割り込みとして「${preface}」から入ってください`;
    interruptQueued = true;
    const interrupter = speakers.find(
      (s) => s.roleKey === pending.rareInterruptRoleKey,
    );
    if (interrupter) {
      pushMessage(liveState, {
        speakerType: "system",
        roleKey: null,
        title: "会議",
        text: `${interrupter.title}が割り込みます…`,
        kind: "chat",
        messageType: "interrupt_notice",
      });
    }
  }

  liveState.activeGenerationId = null;
  liveState.pendingSpeak = null;

  runDebuggerPass(
    liveState,
    args.reviewLevel,
    { duplicateResponseDetected },
    speakers.map((s) => s.roleKey),
  );

  await persistDiscussion(fresh.roundId, args.meetingId, liveState);

  void chair;
  return {
    status: "spoken",
    message,
    interruptQueued,
    summary: publicState(liveState),
  };
}

/**
 * First entry into discussion: create round only (client drives live turns).
 */
export async function runDiscussionBatch(args: {
  meetingId: string;
  company: CompanyContext;
  project: ProjectContext;
  reviewLevel: ReviewLevel;
  chair: BoardMemberRow;
  speakers: BoardMemberRow[];
  projectId: string;
}): Promise<"awaiting_proposer" | "ended" | "continue"> {
  await ensureRound(args.meetingId, args.project);
  await prisma.meeting.update({
    where: { id: args.meetingId },
    data: {
      status: MEETING_STATUS.DISCUSSION,
      currentStep: MEETING_STEP.DISCUSSION,
      errorMessage: null,
    },
  });
  return "continue";
}

export async function interruptDiscussion(args: {
  meetingId: string;
  message: string;
  targetRoleKey?: string | null;
  messageType?: string | null;
  controlAction?: string | null;
  reviewLevel: ReviewLevel;
  signal?: AbortSignal;
}): Promise<{
  summary: ReturnType<typeof publicState>;
  intent: string;
  interruptedGenerationId: string | null;
}> {
  const { chair, speakers, project, company } = await loadDiscussionContext(
    args.meetingId,
  );
  const { roundId, state } = await ensureRound(args.meetingId, project);

  if (state.ended) {
    throw new Error("会議は既に終了しています。");
  }

  const interruptedGenerationId = state.activeGenerationId;
  // Cancel in-flight generation
  state.activeGenerationId = null;
  state.pendingSpeak = null;

  const target =
    args.targetRoleKey && args.targetRoleKey !== "all"
      ? args.targetRoleKey
      : null;

  const text = args.message.trim().slice(0, 800);
  const proposerMsg = pushMessage(state, {
    speakerType: "proposer",
    roleKey: null,
    title: "企画者",
    text,
    addressTo: target ? "officer" : "all",
    addressRoleKey: target,
    moveType: "alternative",
    kind: "chat",
    messageType: args.messageType ?? args.controlAction ?? "interrupt",
    targetExecutiveId: target,
    interruptedGenerationId,
  });

  markOpenQuestionsAnswered(state, text);

  await persistDiscussion(roundId, args.meetingId, state);

  // Fast-path controls without full classification when explicit
  const control = args.controlAction ?? args.messageType;
  if (control === "pause_request" || control === "pause") {
    state.paused = true;
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: "一旦止めます。再開するまで待ちます。",
      kind: "chat",
      messageType: "pause",
    });
    await persistDiscussion(roundId, args.meetingId, state);
    await prisma.meeting.update({
      where: { id: args.meetingId },
      data: { status: MEETING_STATUS.DISCUSSION, errorMessage: null },
    });
    return {
      summary: publicState(state),
      intent: "pause_request",
      interruptedGenerationId,
    };
  }

  if (control === "end_request" || control === "会議終了") {
    state.awaitingEndConfirm = true;
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: "会議を終了しますか？ 承認してください。",
      kind: "chat",
      messageType: "propose_end",
    });
    await persistDiscussion(roundId, args.meetingId, state);
    return {
      summary: publicState(state),
      intent: "end_request",
      interruptedGenerationId,
    };
  }

  const availableRoleKeys = speakers.map((s) => s.roleKey);
  const currentPlan = currentPlanFromState(state);

  let classification: Awaited<ReturnType<typeof runInterruptClassification>>;
  try {
    classification = await runInterruptClassification({
      company,
      project,
      chair: toMemberContext(chair),
      currentPlan,
      proposerMessage: text,
      targetRoleKey: target,
      messageType: args.messageType ?? null,
      availableRoleKeys,
      signal: args.signal,
    });
  } catch (error) {
    if (
      args.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    console.info(
      "[Discussion] interruptClassification failed (isolated)",
      error instanceof Error ? error.message.slice(0, 200) : String(error),
    );
    const fallbackIntent =
      args.messageType === "proposal_change" || args.messageType === "企画変更"
        ? ("proposal_change" as const)
        : args.messageType === "question"
          ? ("question" as const)
          : args.messageType === "objection"
            ? ("objection" as const)
            : args.messageType === "summary_request" ||
                args.messageType === "一度整理"
              ? ("summary_request" as const)
              : ("clarification" as const);
    classification = {
      intent: fallbackIntent,
      preferredNextRoleKey: target,
      overrideTargetReason: null,
      chairUtterance: "了解しました。議論を続けます。",
      needsPlanUpdateReview:
        fallbackIntent === "proposal_change" ||
        args.messageType === "企画変更",
    };
  }

  if (classification.intent === "pause_request") {
    state.paused = true;
  }

  if (classification.intent === "end_request") {
    state.awaitingEndConfirm = true;
  }

  if (classification.intent === "summary_request" || control === "summary_request") {
    try {
      const brief = await runDiscussionBriefSummary({
        company,
        project,
        chair: toMemberContext(chair),
        currentPlan,
        transcript: state.messages,
        decisions: state.decisions,
        rejectedItems: state.rejectedItems,
        openTopics: state.openTopics,
        priorityIssues: state.priorityIssues,
        signal: args.signal,
      });
      const priority =
        brief.priorityIssues.length > 0
          ? brief.priorityIssues
          : brief.openIssues.slice(0, 4);
      const body = [
        `【現在の案】${brief.currentPlan}`,
        `【合意】${brief.agreedPoints.map((p) => `・${p}`).join("") || "・（まだ明確な合意なし）"}`,
        `【重要論点】${priority.map((p) => `・${p}`).join("") || "・なし"}`,
        brief.openIssues.length > priority.length
          ? `【その他の残論点】${brief.openIssues
              .filter((p) => !priority.includes(p))
              .map((p) => `・${p}`)
              .join("")}`
          : null,
        `【次の質問】${brief.nextQuestion}`,
      ]
        .filter(Boolean)
        .join("\n");
      pushMessage(state, {
        speakerType: "chair",
        roleKey: chair.roleKey,
        title: chair.title,
        text: body.slice(0, 600),
        kind: "brief_summary",
        messageType: "summary",
      });
      applyMeetingMemory(state, {
        priorityIssues: derivePriorityIssues(state.openTopics, priority),
      });
    } catch (error) {
      if (
        args.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      pushMessage(state, {
        speakerType: "chair",
        roleKey: chair.roleKey,
        title: chair.title,
        text: "整理の生成に失敗しました。議論は続けます。もう一度『一度整理』を試せます。",
        kind: "chat",
        messageType: "summary_failed",
      });
    }
  } else {
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: classification.chairUtterance.slice(0, 150),
      kind: "chat",
      messageType: classification.intent,
      metadata: {
        overrideTargetReason: classification.overrideTargetReason,
        preferredNextRoleKey: classification.preferredNextRoleKey,
      },
    });
  }

  // Resolve next speaker priority
  let nextRole =
    classification.preferredNextRoleKey &&
    availableRoleKeys.includes(classification.preferredNextRoleKey)
      ? classification.preferredNextRoleKey
      : target && availableRoleKeys.includes(target)
        ? target
        : null;

  if (
    target &&
    nextRole &&
    nextRole !== target &&
    classification.overrideTargetReason
  ) {
    // Chair override already explained in chairUtterance / metadata
  } else if (target && availableRoleKeys.includes(target)) {
    nextRole = target;
  }

  if (
    classification.intent !== "pause_request" &&
    classification.intent !== "end_request" &&
    classification.intent !== "summary_request"
  ) {
    state.forcedNextRoleKey = nextRole;
    state.forcedNominateReason = nextRole
      ? `企画者の割り込み（${classification.intent}）への応答`
      : null;
    state.paused = false;
  }

  // Plan update candidate (not applied yet). Isolated: failure must not stop the meeting.
  if (
    classification.needsPlanUpdateReview ||
    classification.intent === "proposal_change" ||
    args.messageType === "proposal_change" ||
    args.messageType === "企画変更"
  ) {
    try {
      const detection = await runPlanUpdateDetection({
        company,
        project,
        chair: toMemberContext(chair),
        currentPlan,
        proposerMessage: text,
        signal: args.signal,
      });

      const summaryText = detection.updatedPlanSummary?.trim() || null;

      if (detection.planUpdated) {
        const changes =
          detection.changes.length > 0
            ? detection.changes
            : ["企画内容の変更候補"];
        state.pendingPlanUpdate = {
          version: state.currentVersion + 1,
          changes,
          // Rewrite overview only when the model supplied one; otherwise derive from changes
          summary:
            summaryText ??
            `${currentPlan.summary}\n\n【変更候補】\n${changes.map((c) => `- ${c}`).join("\n")}`,
          chairNote: detection.chairNote?.trim() || null,
          sourceMessageId: proposerMsg.id ?? null,
        };
      } else if (classification.needsPlanUpdateReview && summaryText) {
        // Chair thought a review was needed and provided a rewrite — show as candidate
        const changes =
          detection.changes.length > 0
            ? detection.changes
            : ["企画内容の確認・整理"];
        state.pendingPlanUpdate = {
          version: state.currentVersion + 1,
          changes,
          summary: summaryText,
          chairNote: detection.chairNote?.trim() || null,
          sourceMessageId: proposerMsg.id ?? null,
        };
      }
      // planUpdated=false and no summary → do not create a pending update
    } catch (error) {
      if (
        args.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      console.info(
        "[Discussion] planUpdateDetection failed (isolated)",
        error instanceof Error ? error.message.slice(0, 200) : String(error),
      );
      pushMessage(state, {
        speakerType: "system",
        roleKey: null,
        title: "会議",
        text: "企画更新の自動判定に失敗しました。議論は続けます。必要なら『企画変更』として再度発言するか、後から更新候補を出してください。",
        kind: "chat",
        messageType: "plan_update_detection_failed",
        metadata: {
          step: "plan_update_detection",
          error:
            error instanceof Error ? error.message.slice(0, 200) : String(error),
        },
      });
    }
  }

  await persistDiscussion(roundId, args.meetingId, state);

  await prisma.meeting.update({
    where: { id: args.meetingId },
    data: {
      status: state.paused
        ? MEETING_STATUS.DISCUSSION
        : state.awaitingEndConfirm
          ? MEETING_STATUS.DISCUSSION
          : MEETING_STATUS.DISCUSSION,
      currentStep: MEETING_STEP.DISCUSSION,
      errorMessage: null,
    },
  });

  return {
    summary: publicState(state),
    intent: classification.intent,
    interruptedGenerationId,
  };
}

export async function resolvePendingPlanUpdate(args: {
  meetingId: string;
  action: "approve" | "reject" | "edit";
  editedChanges?: string[];
  editedSummary?: string;
}): Promise<{ summary: ReturnType<typeof publicState> }> {
  const { chair, project } = await loadDiscussionContext(args.meetingId);
  const { roundId, state } = await ensureRound(args.meetingId, project);

  if (!state.pendingPlanUpdate) {
    throw new Error("承認待ちの企画更新候補がありません。");
  }

  if (args.action === "reject") {
    state.pendingPlanUpdate = null;
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: "企画更新は見送ります。現行 Version のまま続けます。",
      kind: "chat",
      messageType: "plan_update_rejected",
    });
    await persistDiscussion(roundId, args.meetingId, state);
    return { summary: publicState(state) };
  }

  const pending = state.pendingPlanUpdate;
  const changes =
    args.action === "edit" && args.editedChanges?.length
      ? args.editedChanges
      : pending.changes;
  const summaryText =
    args.action === "edit" && args.editedSummary?.trim()
      ? args.editedSummary.trim()
      : pending.summary;
  const nextVersion = pending.version;

  state.planVersions.push({
    version: nextVersion,
    summary: summaryText,
    changes,
    createdAt: new Date().toISOString(),
  });
  state.currentVersion = nextVersion;
  state.pendingPlanUpdate = null;

  const banner = formatPlanUpdateBanner(nextVersion, changes);
  const note = pending.chairNote ? `\n${pending.chairNote}` : "";
  pushMessage(state, {
    speakerType: "chair",
    roleKey: chair.roleKey,
    title: chair.title,
    text: `${banner}${note}`.slice(0, 900),
    moveType: "expand",
    kind: "plan_update",
    messageType: "plan_update",
    planUpdate: {
      version: nextVersion,
      changes,
      summary: summaryText,
    },
  });

  await persistDiscussion(roundId, args.meetingId, state);
  return { summary: publicState(state) };
}

export async function controlDiscussion(args: {
  meetingId: string;
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
    | "debugger_ignore";
  reviewLevel: ReviewLevel;
  note?: string;
  debuggerMode?: DebuggerMode;
  findingId?: string;
  repairAction?: "auto" | "confirm" | "ignore";
}): Promise<{ summary: ReturnType<typeof publicState>; ended?: boolean }> {
  const { chair, speakers, project, company } = await loadDiscussionContext(
    args.meetingId,
  );
  const { roundId, state } = await ensureRound(args.meetingId, project);
  const availableRoleKeys = speakers.map((s) => s.roleKey);

  if (args.action === "set_debugger_mode") {
    const mode = args.debuggerMode ?? "PASSIVE";
    state.debugger.mode = mode;
    if (mode === "OFF") {
      // Keep history but stop new cards
    }
    await persistDiscussion(roundId, args.meetingId, state, {
      appendStatement: false,
    });
    return { summary: publicState(state) };
  }

  if (args.action === "debugger_ignore" || args.action === "debugger_repair") {
    const findingId = args.findingId;
    const finding = state.debugger.findings.find((f) => f.id === findingId);
    if (!finding) {
      return { summary: publicState(state) };
    }
    if (args.action === "debugger_ignore" || args.repairAction === "ignore") {
      finding.status = "ignored";
      state.debugger.repairLog = [
        ...state.debugger.repairLog,
        {
          at: new Date().toISOString(),
          findingId: finding.id,
          action: "ignore" as const,
          note: "ユーザーが無視",
          repairKind: finding.repairKind,
        },
      ].slice(-40);
      // Mark matching timeline card as ignored via metadata (leave text)
      for (const m of state.messages) {
        if (m.kind === "diagnostic" && m.diagnostic?.id === finding.id) {
          m.diagnostic = { ...finding };
          m.metadata = { ...m.metadata, ignored: true };
        }
      }
    } else {
      const result = applySafeRepair({
        finding,
        action: args.repairAction === "auto" ? "auto" : "confirm",
        state,
        availableRoleKeys,
        recentRoleKeys: recentBoardRoleKeys(state.messages),
      });
      finding.status =
        args.repairAction === "auto" ? "auto_repaired" : "confirmed_repaired";
      finding.repairedAt = new Date().toISOString();
      state.debugger.repairLog = [
        ...state.debugger.repairLog,
        {
          at: finding.repairedAt,
          findingId: finding.id,
          action: (args.repairAction === "auto" ? "auto" : "confirm") as
            | "auto"
            | "confirm",
          note: result.note,
          repairKind: finding.repairKind,
        },
      ].slice(-40);
      for (const m of state.messages) {
        if (m.kind === "diagnostic" && m.diagnostic?.id === finding.id) {
          m.diagnostic = { ...finding };
          m.text = `${m.text}\n\n修復: ${result.note}`.slice(0, 450);
        }
      }
      if (result.chairUtterance) {
        pushMessage(state, {
          speakerType: "chair",
          roleKey: chair.roleKey,
          title: chair.title,
          text: result.chairUtterance.slice(0, 150),
          kind: "chat",
          messageType: "debugger_repair",
        });
      }
    }
    state.debugger.scores = computeQualityScores(
      buildAnalyzeContext(state, args.reviewLevel),
      state.debugger,
    );
    await persistDiscussion(roundId, args.meetingId, state);
    return { summary: publicState(state) };
  }

  if (args.action === "pause") {
    state.paused = true;
    state.activeGenerationId = null;
    state.pendingSpeak = null;
    pushMessage(state, {
      speakerType: "system",
      roleKey: null,
      title: "会議",
      text: "企画者が一時停止しました。",
      kind: "chat",
      messageType: "pause",
    });
    await persistDiscussion(roundId, args.meetingId, state);
    return { summary: publicState(state) };
  }

  if (args.action === "resume") {
    state.paused = false;
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: "再開します。",
      kind: "chat",
      messageType: "resume",
    });
    await persistDiscussion(roundId, args.meetingId, state);
    return { summary: publicState(state) };
  }

  if (args.action === "cancel_end") {
    state.awaitingEndConfirm = false;
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: "了解です。議論を続けます。",
      kind: "chat",
      messageType: "cancel_end",
    });
    await persistDiscussion(roundId, args.meetingId, state);
    return { summary: publicState(state) };
  }

  if (args.action === "confirm_end" || args.action === "proceed") {
    const endText =
      args.action === "proceed"
        ? "この方向で進めます。壁打ちはここまで。企画推進役へ。"
        : "企画者の承認により会議を終了します。企画推進役へ引き継ぎます。";
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: endText,
      kind: "chat",
      messageType: "end",
    });
    pushDebuggerSummary(state, args.reviewLevel);
    state.awaitingEndConfirm = false;
    state.paused = false;
    state.activeGenerationId = null;
    state.pendingSpeak = null;
    await persistDiscussion(roundId, args.meetingId, state, {
      ended: true,
      endReason: args.action === "proceed" ? "proposer_proceed" : "proposer_end",
    });
    await prisma.meeting.update({
      where: { id: args.meetingId },
      data: {
        status: MEETING_STATUS.PRODUCT_COACH,
        currentStep: MEETING_STEP.PRODUCT_COACH,
        errorMessage: null,
      },
    });
    return { summary: publicState(state), ended: true };
  }

  if (args.action === "summarize") {
    try {
      const brief = await runDiscussionBriefSummary({
        company,
        project,
        chair: toMemberContext(chair),
        currentPlan: currentPlanFromState(state),
        transcript: state.messages,
        decisions: state.decisions,
        rejectedItems: state.rejectedItems,
        openTopics: state.openTopics,
        priorityIssues: state.priorityIssues,
      });
      const priority =
        brief.priorityIssues.length > 0
          ? brief.priorityIssues
          : brief.openIssues.slice(0, 4);
      const body = [
        `【現在の案】${brief.currentPlan}`,
        `【合意】${brief.agreedPoints.map((p) => `・${p}`).join("") || "・（まだ明確な合意なし）"}`,
        `【重要論点】${priority.map((p) => `・${p}`).join("") || "・なし"}`,
        brief.openIssues.length > priority.length
          ? `【その他の残論点】${brief.openIssues
              .filter((p) => !priority.includes(p))
              .map((p) => `・${p}`)
              .join("")}`
          : null,
        `【次の質問】${brief.nextQuestion}`,
      ]
        .filter(Boolean)
        .join("\n");
      pushMessage(state, {
        speakerType: "chair",
        roleKey: chair.roleKey,
        title: chair.title,
        text: body.slice(0, 600),
        kind: "brief_summary",
        messageType: "summary",
      });
      applyMeetingMemory(state, {
        priorityIssues: derivePriorityIssues(state.openTopics, priority),
      });
    } catch (error) {
      pushMessage(state, {
        speakerType: "chair",
        roleKey: chair.roleKey,
        title: chair.title,
        text: "整理の生成に失敗しました。議論は続けます。もう一度『一度整理』を試せます。",
        kind: "chat",
        messageType: "summary_failed",
      });
    }
    await persistDiscussion(roundId, args.meetingId, state);
    return { summary: publicState(state) };
  }

  if (args.action === "close_topic" || args.action === "change_topic") {
    const text =
      args.note?.trim() ||
      (args.action === "close_topic"
        ? "この論点はここまで。次の論点へ移ります。"
        : "別の論点へ移ります。");
    pushMessage(state, {
      speakerType: "chair",
      roleKey: chair.roleKey,
      title: chair.title,
      text: text.slice(0, 150),
      kind: "chat",
      messageType: args.action,
    });
    // Prefer quality balancer / marketing for fresh angle
    const prefer =
      speakers.find((s) => s.roleKey === "quality_balancer") ??
      speakers.find((s) => s.roleKey === "marketing") ??
      speakers[0];
    state.forcedNextRoleKey = prefer.roleKey;
    state.paused = false;
    await persistDiscussion(roundId, args.meetingId, state);
    return { summary: publicState(state) };
  }

  return { summary: publicState(state) };
}

/**
 * Legacy proposer reply path (AWAITING_DISCUSSION). Now creates pending plan update
 * instead of auto-applying versions.
 */
export async function appendProposerDiscussionReply(args: {
  meetingId: string;
  message: string;
  revisedPlan?: string;
}): Promise<void> {
  const result = await interruptDiscussion({
    meetingId: args.meetingId,
    message: args.revisedPlan?.trim()
      ? `${args.message.trim()}\n（修正メモ: ${args.revisedPlan.trim()}）`
      : args.message,
    messageType: args.revisedPlan?.trim() ? "proposal_change" : null,
    reviewLevel: "standard" as ReviewLevel,
  });
  void result;
}

export { isDiscussionSpeaker, toMemberContext as toDiscussionMemberContext };
