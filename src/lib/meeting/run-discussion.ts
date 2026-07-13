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
import type { Prisma } from "@/generated/prisma/client";
import { randomUUID } from "crypto";
import type { DiscussionTopic } from "@/lib/ai/schemas";

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
  moveType?: string;
  nominateReason?: string;
  kind?: "chat" | "plan_update" | "brief_summary" | "thinking";
  planUpdate?: {
    version: number;
    changes: string[];
    summary: string;
  };
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
  /** Confirmed premises for the rest of the meeting. */
  decisions: string[];
  /** Explicitly rejected ideas — must not be re-proposed. */
  rejectedItems: string[];
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
    decisions,
    rejectedItems,
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
          decisions: [],
          rejectedItems: [],
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
    decisions: state.decisions,
    rejectedItems: state.rejectedItems,
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
    decisions: state.decisions,
    rejectedItems: state.rejectedItems,
  };
}

function topicsAllResolved(topics: DiscussionTopic[]): boolean {
  return topics.length > 0 && topics.every((t) => t.status === "resolved");
}

function unresolvedTopics(topics: DiscussionTopic[]): DiscussionTopic[] {
  return topics.filter((t) => t.status !== "resolved");
}

function applyMeetingMemory(
  state: WallChatState,
  next: {
    openTopics?: DiscussionTopic[];
    priorityIssues?: string[];
    decisions?: string[];
    rejectedItems?: string[];
  },
): void {
  if (next.openTopics && next.openTopics.length > 0) {
    state.openTopics = next.openTopics.slice(0, 12);
  }
  if (Array.isArray(next.priorityIssues)) {
    state.priorityIssues = next.priorityIssues
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 4);
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
      decisions: state.decisions,
      rejectedItems: state.rejectedItems,
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
      decisions: state.decisions,
      rejectedItems: state.rejectedItems,
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
    decisions: facilitation.decisions,
    rejectedItems: facilitation.rejectedItems,
  });

  const open = unresolvedTopics(state.openTopics);
  const canProposeEnd =
    facilitation.action === "propose_end" && topicsAllResolved(state.openTopics);

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
  let forcedAction = facilitation.action;
  let forcedNominateReason = facilitation.nominateReason;
  let forcedChairUtterance = facilitation.chairUtterance;
  if (facilitation.action === "propose_end" && open.length > 0) {
    forcedAction = "nominate";
    const focus = focusTopicFromState(state) ?? open[0]!;
    forcedNominateReason = `重要論点「${focus.label}」を深掘り`;
    forcedChairUtterance =
      facilitation.repetitionDetected && focus.status !== "resolved"
        ? `同じ話が続いていますが、「${focus.label}」はまだ閉じません。別角度をお願いします。`
        : `まだ未解決です。「${focus.label}」を続けます。`;
  }

  if (forcedAction === "ask_proposer") {
    let chairMessage: DiscussionMessage | null = null;
    if (forcedChairUtterance?.trim() || facilitation.chairUtterance?.trim()) {
      chairMessage = pushMessage(state, {
        speakerType: "chair",
        roleKey: chair.roleKey,
        title: chair.title,
        text: (forcedChairUtterance ?? facilitation.chairUtterance)!.slice(0, 150),
        moveType: "question",
        nominateReason: forcedNominateReason,
        kind: "chat",
        messageType: "ask_proposer",
        metadata: {
        openTopics: state.openTopics,
        priorityIssues: state.priorityIssues,
        decisions: state.decisions,
        rejectedItems: state.rejectedItems,
      },
      });
    }
    state.activeGenerationId = null;
    state.pendingSpeak = null;
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

  if (forcedAction === "chair_nudge") {
    const text =
      forcedChairUtterance?.trim() ||
      facilitation.chairUtterance?.trim() ||
      "ちょっと待って。今の話、企画者はどう思う？";
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
        decisions: state.decisions,
        rejectedItems: state.rejectedItems,
      },
    });
    state.activeGenerationId = null;
    state.pendingSpeak = null;
    await persistDiscussion(roundId, args.meetingId, state);
    return {
      status: "chair_only",
      generationId: null,
      speaker: null,
      thinkingTitle: null,
      thinkingLine: null,
      chairMessage,
      summary: publicState(state),
    };
  }

  // nominate or rare_interrupt (or overridden propose_end → nominate)
  let roleKey =
    facilitation.nextSpeakerRoleKey &&
    speakerByRole.has(facilitation.nextSpeakerRoleKey)
      ? facilitation.nextSpeakerRoleKey
      : pickFallbackSpeaker(speakers, state.messages);

  // Occasionally shuffle away from fixed order even if model repeats
  if (Math.random() < 0.25 && forcedAction !== "propose_end") {
    const others = speakers.filter((s) => s.roleKey !== roleKey);
    if (others.length > 0) {
      roleKey = shufflePick(others).roleKey;
    }
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
  const chairText = forcedChairUtterance?.trim() || facilitation.chairUtterance?.trim();
  if (chairText) {
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
        decisions: state.decisions,
        rejectedItems: state.rejectedItems,
      },
    });
  }

  const line = pickThinkingLine(speaker.roleKey);
  const focusTopic = focusTopicFromState(state);
  state.activeGenerationId = generationId;
  state.pendingSpeak = {
    generationId,
    roleKey: speaker.roleKey,
    nominateReason:
      forcedNominateReason ||
      (focusTopic
        ? `重要論点「${focusTopic.label}」への視点`
        : "今の流れで一番刺さる視点"),
    chairUtterance: forcedChairUtterance,
    rareInterruptRoleKey,
    action: forcedAction === "propose_end" ? "nominate" : forcedAction,
  };

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
    speaker: { roleKey: speaker.roleKey, title: speaker.title },
    thinkingTitle: thinkingTitle(speaker.title),
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
      proposerAnswers: proposerAnswersFromMessages(state.messages),
      chairNotes: chairNotesFromMessages(state.messages),
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
    return {
      status: "stale",
      message: null,
      interruptQueued: false,
      summary: publicState(fresh.state),
    };
  }

  const liveState = fresh.state;
  const message = pushMessage(liveState, {
    speakerType: "board_member",
    roleKey: speaker.roleKey,
    title: speaker.title,
    speakerId: speaker.id,
    text: utterance.text.slice(0, 150),
    addressTo: utterance.addressTo,
    addressRoleKey: utterance.addressRoleKey,
    moveType: utterance.moveType,
    nominateReason: pending.nominateReason,
    kind: "chat",
    messageType: utterance.moveType,
  });

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
    | "cancel_end";
  reviewLevel: ReviewLevel;
  note?: string;
}): Promise<{ summary: ReturnType<typeof publicState>; ended?: boolean }> {
  const { chair, speakers, project, company } = await loadDiscussionContext(
    args.meetingId,
  );
  const { roundId, state } = await ensureRound(args.meetingId, project);

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
