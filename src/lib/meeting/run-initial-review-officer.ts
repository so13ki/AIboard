/**
 * Step2 initial officer reviews — per-officer generation with isolation,
 * timeout, structured logs, and idempotent persistence.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { runInitialReview } from "@/lib/ai/run-board-member";
import { reduceReviewOverlap } from "@/lib/ai/dedupe";
import type {
  CompanyContext,
  MemberContext,
  ProjectContext,
} from "@/lib/ai/prompts";
import type { ReviewLevel } from "@/lib/ai/role-focus";
import {
  MEETING_STATUS,
  MEETING_STEP,
  isSpecialtyReviewer,
} from "@/lib/meeting/constants";
import type { Prisma } from "@/generated/prisma/client";

type Json = Prisma.InputJsonValue;

/** Per-officer wall-clock timeout (OpenAI structured JSON can be slow). */
export const OFFICER_REVIEW_TIMEOUT_MS = 75_000;

export type OfficerReviewStatus =
  | "pending"
  | "generating"
  | "completed"
  | "failed"
  | "timed_out";

export type ReviewerSnapshot = {
  id: string;
  title: string;
  roleKey: string;
  status: OfficerReviewStatus;
  stance?: string | null;
  content?: unknown;
  statementId?: string;
  error?: string;
};

function step2Log(
  message: string,
  fields?: Record<string, string | number | boolean | undefined | null>,
) {
  const extra = fields
    ? " " +
      Object.entries(fields)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")
    : "";
  console.info(`[Step2] ${message}${extra}`);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toMemberContext(member: {
  title: string;
  roleKey: string;
  description: string;
  priorities: unknown;
  checkItems: unknown;
  behaviorRules: unknown;
  isChairperson: boolean;
}): MemberContext {
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

function extractReviewLevel(agendaSummary: unknown): ReviewLevel {
  if (
    agendaSummary &&
    typeof agendaSummary === "object" &&
    "reviewLevel" in agendaSummary
  ) {
    const level = (agendaSummary as { reviewLevel?: unknown }).reviewLevel;
    if (
      level === "experiment" ||
      level === "standard" ||
      level === "strategic"
    ) {
      return level;
    }
  }
  return "standard";
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(label), { name: "TimeoutError" }));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return /timeout/i.test(error.message);
}

export async function startInitialReviewRound(meetingId: string): Promise<{
  meetingId: string;
  roundId: string;
  reviewers: ReviewerSnapshot[];
  alreadyComplete: boolean;
}> {
  step2Log("review started", { meetingId });

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      project: {
        include: {
          company: {
            include: { boardMembers: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
      rounds: {
        where: { step: MEETING_STEP.INITIAL_REVIEW },
        include: { statements: true },
        orderBy: { roundNumber: "asc" },
        take: 1,
      },
    },
  });

  if (!meeting) throw new Error("会議が見つかりません。");
  if (
    meeting.status !== MEETING_STATUS.INITIAL_REVIEW &&
    meeting.status !== MEETING_STATUS.FAILED &&
    meeting.status !== MEETING_STATUS.DISCUSSION
  ) {
    throw new Error("役員レビューの実行タイミングではありません。");
  }

  const reviewers = meeting.project.company.boardMembers.filter(isSpecialtyReviewer);
  step2Log("executives loaded", {
    meetingId,
    count: reviewers.length,
  });

  if (reviewers.length === 0) {
    throw new Error("専門役員が見つかりません。");
  }

  let round = meeting.rounds[0];
  if (!round) {
    round = await prisma.meetingRound.create({
      data: {
        meetingId: meeting.id,
        step: MEETING_STEP.INITIAL_REVIEW,
        roundNumber: 2,
      },
      include: { statements: true },
    });
  }

  const byMember = new Map(
    round.statements
      .filter((s) => s.boardMemberId)
      .map((s) => [s.boardMemberId!, s]),
  );

  const snapshots: ReviewerSnapshot[] = reviewers.map((m) => {
    const existing = byMember.get(m.id);
    if (existing) {
      return {
        id: m.id,
        title: m.title,
        roleKey: m.roleKey,
        status: "completed",
        stance: existing.stance,
        content: existing.content,
        statementId: existing.id,
      };
    }
    return {
      id: m.id,
      title: m.title,
      roleKey: m.roleKey,
      status: "pending",
    };
  });

  const completed = snapshots.filter((s) => s.status === "completed").length;
  const pending = snapshots.length - completed;
  step2Log("progress", {
    meetingId,
    completed,
    failed: 0,
    pending,
  });

  const alreadyComplete = pending === 0 && completed > 0;
  if (alreadyComplete && meeting.status === MEETING_STATUS.INITIAL_REVIEW) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MEETING_STATUS.DISCUSSION,
        currentStep: MEETING_STEP.DISCUSSION,
        errorMessage: null,
      },
    });
    step2Log("review completed", { meetingId, reason: "already_saved" });
  }

  return {
    meetingId,
    roundId: round.id,
    reviewers: snapshots,
    alreadyComplete,
  };
}

export async function generateOneOfficerReview(args: {
  meetingId: string;
  memberId: string;
  requestId?: string;
}): Promise<{
  status: "completed" | "failed" | "timed_out" | "skipped";
  requestId: string;
  memberId: string;
  roleKey?: string;
  title?: string;
  stance?: string;
  content?: unknown;
  statementId?: string;
  error?: string;
  startedAt: string;
  finishedAt: string;
}> {
  const requestId = args.requestId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  step2Log("executive request started", {
    meetingId: args.meetingId,
    executiveId: args.memberId,
    requestId,
  });

  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: args.meetingId },
      include: {
        project: {
          include: {
            company: {
              include: { boardMembers: { orderBy: { sortOrder: "asc" } } },
            },
          },
        },
        rounds: {
          where: { step: MEETING_STEP.INITIAL_REVIEW },
          include: { statements: true },
          orderBy: { roundNumber: "asc" },
          take: 1,
        },
      },
    });

    if (!meeting) {
      throw new Error("会議が見つかりません。");
    }

    const member = meeting.project.company.boardMembers.find(
      (m) => m.id === args.memberId && isSpecialtyReviewer(m),
    );
    if (!member) {
      throw new Error("対象の専門役員が見つかりません。");
    }

    let round = meeting.rounds[0];
    if (!round) {
      round = await prisma.meetingRound.create({
        data: {
          meetingId: meeting.id,
          step: MEETING_STEP.INITIAL_REVIEW,
          roundNumber: 2,
        },
        include: { statements: true },
      });
    }

    const existing = round.statements.find((s) => s.boardMemberId === member.id);
    if (existing) {
      step2Log("executive review saved", {
        meetingId: args.meetingId,
        executiveId: member.id,
        role: member.roleKey,
        requestId,
        idempotent: true,
      });
      return {
        status: "skipped",
        requestId,
        memberId: member.id,
        roleKey: member.roleKey,
        title: member.title,
        stance: existing.stance ?? undefined,
        content: existing.content,
        statementId: existing.id,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    const agendaRound = await prisma.meetingRound.findFirst({
      where: { meetingId: meeting.id, step: MEETING_STEP.AGENDA },
      orderBy: { roundNumber: "asc" },
    });
    if (!agendaRound?.summary) {
      throw new Error("議題整理が未完了です。");
    }

    const company: CompanyContext = {
      name: meeting.project.company.name,
      philosophy: meeting.project.company.philosophy,
      vision: meeting.project.company.vision,
      values: asStringArray(meeting.project.company.values),
      culture: meeting.project.company.culture,
      principles: meeting.project.company.principles,
      prohibitions: meeting.project.company.prohibitions,
    };
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
    const reviewLevel = extractReviewLevel(agendaRound.summary);

    // Soft dedupe against already-saved reviews (best-effort, non-blocking)
    const priorReviews = round.statements
      .filter((s) => s.boardMemberId && s.boardMemberId !== member.id)
      .map((s) => {
        const peer = meeting.project.company.boardMembers.find(
          (m) => m.id === s.boardMemberId,
        );
        const c = (s.content ?? {}) as Record<string, unknown>;
        return {
          memberTitle: peer?.title ?? "役員",
          content: {
            biggestConcern: String(c.biggestConcern ?? ""),
            questions: asStringArray(c.questions),
            revisionProposals: asStringArray(c.revisionProposals),
            stance: String(c.currentProposalVote ?? c.stance ?? s.stance ?? ""),
            evaluation: String(c.evaluation ?? ""),
            concerns: Array.isArray(c.concerns)
              ? (c.concerns as Array<{ concern: string; reason: string }>)
              : undefined,
            improvements: Array.isArray(c.improvements)
              ? (c.improvements as Array<{
                  proposal: string;
                  expectedEffect: string;
                }>)
              : undefined,
            positives: asStringArray(c.positives),
          },
        };
      });

    const runOnce = async (attempt: number) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), OFFICER_REVIEW_TIMEOUT_MS);
      try {
        const result = await withTimeout(
          runInitialReview({
            company,
            project,
            member: toMemberContext(member),
            agenda: agendaRound.summary,
            reviewLevel,
            priorReviews: attempt === 1 ? [] : priorReviews,
            signal: abort.signal,
          }),
          OFFICER_REVIEW_TIMEOUT_MS + 1_000,
          `timeout after ${OFFICER_REVIEW_TIMEOUT_MS}ms`,
        );
        return result;
      } finally {
        clearTimeout(timer);
      }
    };

    let result;
    try {
      result = await runOnce(1);
      step2Log("executive API response received", {
        meetingId: args.meetingId,
        executiveId: member.id,
        role: member.roleKey,
        requestId,
        elapsedMs: Date.now() - startedMs,
        attempt: 1,
      });
      step2Log("executive JSON validation succeeded", {
        meetingId: args.meetingId,
        executiveId: member.id,
        role: member.roleKey,
        requestId,
        attempt: 1,
      });
    } catch (firstError) {
      if (isTimeoutError(firstError)) {
        step2Log("executive request failed", {
          meetingId: args.meetingId,
          executiveId: member.id,
          role: member.roleKey,
          requestId,
          error: "timed_out",
          elapsedMs: Date.now() - startedMs,
        });
        return {
          status: "timed_out",
          requestId,
          memberId: member.id,
          roleKey: member.roleKey,
          title: member.title,
          error: `タイムアウト（${OFFICER_REVIEW_TIMEOUT_MS / 1000}秒）`,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      // One automatic repair/regeneration attempt for JSON validation failures
      const msg =
        firstError instanceof Error ? firstError.message : String(firstError);
      step2Log("executive request failed", {
        meetingId: args.meetingId,
        executiveId: member.id,
        role: member.roleKey,
        requestId,
        error: msg.slice(0, 200),
        attempt: 1,
        willRetry: true,
      });

      try {
        result = await runOnce(2);
        step2Log("executive API response received", {
          meetingId: args.meetingId,
          executiveId: member.id,
          role: member.roleKey,
          requestId,
          elapsedMs: Date.now() - startedMs,
          attempt: 2,
        });
        step2Log("executive JSON validation succeeded", {
          meetingId: args.meetingId,
          executiveId: member.id,
          role: member.roleKey,
          requestId,
          attempt: 2,
        });
      } catch (secondError) {
        if (isTimeoutError(secondError)) {
          step2Log("executive request failed", {
            meetingId: args.meetingId,
            executiveId: member.id,
            role: member.roleKey,
            requestId,
            error: "timed_out",
            attempt: 2,
          });
          return {
            status: "timed_out",
            requestId,
            memberId: member.id,
            roleKey: member.roleKey,
            title: member.title,
            error: `タイムアウト（${OFFICER_REVIEW_TIMEOUT_MS / 1000}秒）`,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }
        const msg2 =
          secondError instanceof Error
            ? secondError.message
            : String(secondError);
        step2Log("executive request failed", {
          meetingId: args.meetingId,
          executiveId: member.id,
          role: member.roleKey,
          requestId,
          error: msg2.slice(0, 200),
          attempt: 2,
        });
        return {
          status: "failed",
          requestId,
          memberId: member.id,
          roleKey: member.roleKey,
          title: member.title,
          error: msg2.slice(0, 300),
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }
    }

    // Re-check idempotency before insert (race with parallel/duplicate calls)
    const fresh = await prisma.statement.findFirst({
      where: { meetingRoundId: round.id, boardMemberId: member.id },
    });
    if (fresh) {
      return {
        status: "skipped",
        requestId,
        memberId: member.id,
        roleKey: member.roleKey,
        title: member.title,
        stance: fresh.stance ?? undefined,
        content: fresh.content,
        statementId: fresh.id,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    const deduped = reduceReviewOverlap(
      result,
      priorReviews.map((r) => r.content),
    );
    const stance = deduped.currentProposalVote ?? deduped.stance;

    const statement = await prisma.statement.create({
      data: {
        meetingRoundId: round.id,
        boardMemberId: member.id,
        speakerType: "board_member",
        stance,
        content: deduped as Json,
      },
    });

    step2Log("executive review saved", {
      meetingId: args.meetingId,
      executiveId: member.id,
      role: member.roleKey,
      requestId,
      statementId: statement.id,
      elapsedMs: Date.now() - startedMs,
    });

    return {
      status: "completed",
      requestId,
      memberId: member.id,
      roleKey: member.roleKey,
      title: member.title,
      stance,
      content: deduped,
      statementId: statement.id,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    step2Log("executive request failed", {
      meetingId: args.meetingId,
      executiveId: args.memberId,
      requestId,
      error: msg.slice(0, 200),
    });
    return {
      status: "failed",
      requestId,
      memberId: args.memberId,
      error: msg.slice(0, 300),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

/**
 * Mark Step2 done when every officer is terminal and at least one completed.
 */
export async function finalizeInitialReviewIfReady(meetingId: string): Promise<{
  finalized: boolean;
  nextStatus: string | null;
  completed: number;
  failedOrTimedOut: number;
  pending: number;
  reason?: string;
}> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      project: {
        include: {
          company: { include: { boardMembers: true } },
        },
      },
      rounds: {
        where: { step: MEETING_STEP.INITIAL_REVIEW },
        include: { statements: true },
        orderBy: { roundNumber: "asc" },
        take: 1,
      },
    },
  });

  if (!meeting) {
    return {
      finalized: false,
      nextStatus: null,
      completed: 0,
      failedOrTimedOut: 0,
      pending: 0,
      reason: "missing_meeting",
    };
  }

  if (meeting.status === MEETING_STATUS.DISCUSSION) {
    return {
      finalized: true,
      nextStatus: MEETING_STATUS.DISCUSSION,
      completed: 0,
      failedOrTimedOut: 0,
      pending: 0,
      reason: "already_discussion",
    };
  }

  const reviewers = meeting.project.company.boardMembers.filter(isSpecialtyReviewer);
  const round = meeting.rounds[0];
  const doneIds = new Set(
    round?.statements
      .map((s) => s.boardMemberId)
      .filter((id): id is string => Boolean(id)) ?? [],
  );
  const completed = reviewers.filter((m) => doneIds.has(m.id)).length;
  const pending = reviewers.length - completed;

  step2Log("progress", {
    meetingId,
    completed,
    failed: 0,
    pending,
  });

  // Client tracks failed/timed_out locally; server only knows completed vs missing.
  // Finalize when client says all terminal OR when all have statements.
  if (completed === 0) {
    return {
      finalized: false,
      nextStatus: null,
      completed,
      failedOrTimedOut: 0,
      pending,
      reason: "no_completed_reviews",
    };
  }

  if (pending > 0) {
    return {
      finalized: false,
      nextStatus: null,
      completed,
      failedOrTimedOut: 0,
      pending,
      reason: "still_pending_on_server",
    };
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: MEETING_STATUS.DISCUSSION,
      currentStep: MEETING_STEP.DISCUSSION,
      errorMessage: null,
    },
  });

  step2Log("review completed", { meetingId, completed });

  return {
    finalized: true,
    nextStatus: MEETING_STATUS.DISCUSSION,
    completed,
    failedOrTimedOut: 0,
    pending: 0,
  };
}

/**
 * Client-driven finalize: allow advance when ≥1 completed and client reports
 * no pending/generating officers (failed/timed_out allowed).
 */
export async function finalizeInitialReviewFromClient(args: {
  meetingId: string;
  terminalMemberIds: string[];
  failedMemberIds: string[];
}): Promise<{
  finalized: boolean;
  nextStatus: string | null;
  completed: number;
  reason?: string;
}> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: args.meetingId },
    include: {
      project: {
        include: { company: { include: { boardMembers: true } } },
      },
      rounds: {
        where: { step: MEETING_STEP.INITIAL_REVIEW },
        include: { statements: true },
        orderBy: { roundNumber: "asc" },
        take: 1,
      },
    },
  });

  if (!meeting) {
    return { finalized: false, nextStatus: null, completed: 0, reason: "missing" };
  }

  if (meeting.status === MEETING_STATUS.DISCUSSION) {
    return {
      finalized: true,
      nextStatus: MEETING_STATUS.DISCUSSION,
      completed: 0,
      reason: "already_discussion",
    };
  }

  const reviewers = meeting.project.company.boardMembers.filter(isSpecialtyReviewer);
  const reviewerIds = new Set(reviewers.map((m) => m.id));
  const doneIds = new Set(
    meeting.rounds[0]?.statements
      .map((s) => s.boardMemberId)
      .filter((id): id is string => Boolean(id)) ?? [],
  );
  const completed = [...doneIds].filter((id) => reviewerIds.has(id)).length;

  const terminal = new Set(
    [...args.terminalMemberIds, ...args.failedMemberIds].filter((id) =>
      reviewerIds.has(id),
    ),
  );
  // Every reviewer must be either saved or explicitly failed/timed_out by client
  const allTerminal = reviewers.every(
    (m) => doneIds.has(m.id) || terminal.has(m.id),
  );

  if (!allTerminal) {
    return {
      finalized: false,
      nextStatus: null,
      completed,
      reason: "not_all_terminal",
    };
  }

  if (completed === 0) {
    return {
      finalized: false,
      nextStatus: null,
      completed: 0,
      reason: "all_failed",
    };
  }

  await prisma.meeting.update({
    where: { id: args.meetingId },
    data: {
      status: MEETING_STATUS.DISCUSSION,
      currentStep: MEETING_STEP.DISCUSSION,
      errorMessage: null,
    },
  });

  step2Log("review completed", {
    meetingId: args.meetingId,
    completed,
    failed: args.failedMemberIds.length,
  });

  return {
    finalized: true,
    nextStatus: MEETING_STATUS.DISCUSSION,
    completed,
  };
}
