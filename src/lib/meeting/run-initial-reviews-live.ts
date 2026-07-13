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

export type ReviewStreamReviewer = {
  id: string;
  title: string;
  roleKey: string;
};

export type ReviewStreamEvent =
  | { type: "roster"; reviewers: ReviewStreamReviewer[]; roundId: string }
  | {
      type: "status";
      memberId: string;
      status: "waiting" | "thinking" | "typing";
    }
  | {
      type: "complete";
      memberId: string;
      title: string;
      roleKey: string;
      stance: string;
      content: unknown;
      statementId: string;
    }
  | { type: "error"; memberId: string; message: string }
  | { type: "done"; nextStatus: string }
  | { type: "fatal"; message: string };

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

type PriorReview = {
  memberTitle: string;
  content: {
    biggestConcern: string;
    questions: string[];
    revisionProposals: string[];
    stance: string;
    evaluation: string;
    concerns?: Array<{ concern: string; reason: string }>;
    improvements?: Array<{ proposal: string; expectedEffect: string }>;
    positives?: string[];
  };
};

/**
 * Fan-out initial reviews in parallel. Emits NDJSON-friendly events as each
 * officer finishes so the UI can render in arrival order.
 */
export async function streamInitialReviews(args: {
  meetingId: string;
  emit: (event: ReviewStreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
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
    args.emit({ type: "fatal", message: "会議が見つかりません。" });
    return;
  }

  if (
    meeting.status !== MEETING_STATUS.INITIAL_REVIEW &&
    meeting.status !== MEETING_STATUS.FAILED
  ) {
    // Already past this step — still emit done so UI can refresh
    if (meeting.status === MEETING_STATUS.DISCUSSION) {
      args.emit({ type: "done", nextStatus: MEETING_STATUS.DISCUSSION });
      return;
    }
    args.emit({
      type: "fatal",
      message: "役員レビューの実行タイミングではありません。",
    });
    return;
  }

  const agendaRound = await prisma.meetingRound.findFirst({
    where: { meetingId: meeting.id, step: MEETING_STEP.AGENDA },
    orderBy: { roundNumber: "asc" },
  });
  if (!agendaRound?.summary) {
    args.emit({ type: "fatal", message: "議題整理が未完了です。" });
    return;
  }

  const reviewers = meeting.project.company.boardMembers.filter(isSpecialtyReviewer);
  if (reviewers.length === 0) {
    args.emit({ type: "fatal", message: "専門役員が見つかりません。" });
    return;
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

  const doneMemberIds = new Set(
    round.statements
      .map((s) => s.boardMemberId)
      .filter((id): id is string => Boolean(id)),
  );

  const roster: ReviewStreamReviewer[] = reviewers.map((m) => ({
    id: m.id,
    title: m.title,
    roleKey: m.roleKey,
  }));

  args.emit({ type: "roster", reviewers: roster, roundId: round.id });

  // Seed prior reviews from already-persisted statements (resume support)
  const completedPriors: PriorReview[] = [];
  for (const statement of round.statements) {
    const member = reviewers.find((m) => m.id === statement.boardMemberId);
    if (!member || !statement.content || typeof statement.content !== "object") {
      continue;
    }
    const c = statement.content as Record<string, unknown>;
    completedPriors.push({
      memberTitle: member.title,
      content: {
        biggestConcern: String(c.biggestConcern ?? ""),
        questions: asStringArray(c.questions),
        revisionProposals: asStringArray(c.revisionProposals),
        stance: String(c.currentProposalVote ?? c.stance ?? statement.stance ?? ""),
        evaluation: String(c.evaluation ?? ""),
        concerns: Array.isArray(c.concerns)
          ? (c.concerns as PriorReview["content"]["concerns"])
          : undefined,
        improvements: Array.isArray(c.improvements)
          ? (c.improvements as PriorReview["content"]["improvements"])
          : undefined,
        positives: asStringArray(c.positives),
      },
    });
    args.emit({
      type: "complete",
      memberId: member.id,
      title: member.title,
      roleKey: member.roleKey,
      stance: statement.stance ?? "hold",
      content: statement.content,
      statementId: statement.id,
    });
  }

  const pending = reviewers.filter((m) => !doneMemberIds.has(m.id));
  if (pending.length === 0) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MEETING_STATUS.DISCUSSION,
        currentStep: MEETING_STEP.DISCUSSION,
        errorMessage: null,
      },
    });
    args.emit({ type: "done", nextStatus: MEETING_STATUS.DISCUSSION });
    return;
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

  // Serialize only the dedupe + persist critical section
  let chain = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  for (const member of pending) {
    args.emit({ type: "status", memberId: member.id, status: "thinking" });
  }

  await Promise.all(
    pending.map(async (member) => {
      if (args.signal?.aborted) return;

      // Brief beat so UI shows thinking before typing
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
      if (args.signal?.aborted) return;

      args.emit({ type: "status", memberId: member.id, status: "typing" });

      try {
        // Parallel: do not wait for other officers' full text before calling AI.
        // Light overlap reduction uses only reviews completed so far (lock).
        const result = await runInitialReview({
          company,
          project,
          member: toMemberContext(member),
          agenda: agendaRound.summary,
          reviewLevel,
          priorReviews: [],
          signal: args.signal,
        });

        if (args.signal?.aborted) return;

        const persisted = await withLock(async () => {
          const priorsSnapshot = [...completedPriors];
          const deduped = reduceReviewOverlap(
            result,
            priorsSnapshot.map((r) => r.content),
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

          completedPriors.push({
            memberTitle: member.title,
            content: {
              biggestConcern: deduped.biggestConcern,
              questions: deduped.questions,
              revisionProposals: deduped.revisionProposals,
              stance,
              evaluation: deduped.evaluation,
              concerns: deduped.concerns,
              improvements: deduped.improvements,
              positives: deduped.positives,
            },
          });

          return { statement, deduped, stance };
        });

        args.emit({
          type: "complete",
          memberId: member.id,
          title: member.title,
          roleKey: member.roleKey,
          stance: persisted.stance,
          content: persisted.deduped,
          statementId: persisted.statement.id,
        });
      } catch (error) {
        if (
          args.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }
        args.emit({
          type: "error",
          memberId: member.id,
          message:
            error instanceof Error ? error.message : "レビュー生成に失敗しました。",
        });
      }
    }),
  );

  if (args.signal?.aborted) return;

  // Re-check: advance only if all specialty reviewers have a statement
  const finalRound = await prisma.meetingRound.findUnique({
    where: { id: round.id },
    include: { statements: true },
  });
  const finalDone = new Set(
    finalRound?.statements
      .map((s) => s.boardMemberId)
      .filter((id): id is string => Boolean(id)) ?? [],
  );
  const allDone = reviewers.every((m) => finalDone.has(m.id));

  if (allDone) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MEETING_STATUS.DISCUSSION,
        currentStep: MEETING_STEP.DISCUSSION,
        errorMessage: null,
      },
    });
    args.emit({ type: "done", nextStatus: MEETING_STATUS.DISCUSSION });
  } else {
    args.emit({
      type: "fatal",
      message:
        "一部の役員レビューが未完了です。「再試行」で残りを生成してください。",
    });
  }
}
