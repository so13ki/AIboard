import { prisma } from "@/lib/db";
import { runProductCoach } from "@/lib/ai/run-board-member";
import {
  runAgenda,
  runCeoEdit,
  runGrowthSummary,
} from "@/lib/ai/run-chairperson";
import type {
  CompanyContext,
  MemberContext,
  ProjectContext,
} from "@/lib/ai/prompts";
import type { ReviewLevel } from "@/lib/ai/role-focus";
import {
  MEETING_STATUS,
  MEETING_STEP,
  PROJECT_STATUS,
  isDiscussionSpeaker,
  isSpecialtyReviewer,
  type MeetingStatus,
} from "@/lib/meeting/constants";
import {
  appendProposerDiscussionReply,
  runDiscussionBatch,
} from "@/lib/meeting/run-discussion";
import type { Prisma } from "@/generated/prisma/client";

type Json = Prisma.InputJsonValue;
type MeetingBundle = Awaited<ReturnType<typeof loadMeetingBundle>>;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
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

function toCompanyContext(company: {
  name: string;
  philosophy: string;
  vision: string;
  values: unknown;
  culture: string;
  principles: string;
  prohibitions: string;
}): CompanyContext {
  return {
    name: company.name,
    philosophy: company.philosophy,
    vision: company.vision,
    values: asStringArray(company.values),
    culture: company.culture,
    principles: company.principles,
    prohibitions: company.prohibitions,
  };
}

function toProjectContext(project: {
  title: string;
  background: string;
  problem: string;
  content: string;
  targetCustomer: string;
  expectedEffect: string;
  estimatedCost: string;
  constraints: string;
  discussionPoints: string;
}): ProjectContext {
  return {
    title: project.title,
    background: project.background,
    problem: project.problem,
    content: project.content,
    targetCustomer: project.targetCustomer,
    expectedEffect: project.expectedEffect,
    estimatedCost: project.estimatedCost,
    constraints: project.constraints,
    discussionPoints: project.discussionPoints,
  };
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

function findProductCoach(meeting: MeetingBundle) {
  const coach = meeting.project.company.boardMembers.find(
    (m) => m.roleKey === "product_coach",
  );
  if (!coach) {
    throw new Error(
      "企画推進役（product_coach）が未設定です。seed を実行して役員を追加してください。",
    );
  }
  return coach;
}

function latestCoachRound(meeting: MeetingBundle) {
  return (
    getRound(meeting, MEETING_STEP.PRODUCT_COACH_FOLLOWUP) ??
    getRound(meeting, MEETING_STEP.PRODUCT_COACH) ??
    getRound(meeting, MEETING_STEP.INTERIM)
  );
}

function latestProposerAnswerRound(meeting: MeetingBundle) {
  return (
    getRound(meeting, MEETING_STEP.PROPOSER_ANSWER_2) ??
    getRound(meeting, MEETING_STEP.PROPOSER_ANSWER)
  );
}

async function loadMeetingBundle(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      project: {
        include: {
          company: {
            include: {
              boardMembers: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      rounds: {
        include: {
          statements: {
            include: { boardMember: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { roundNumber: "asc" },
      },
      decision: true,
    },
  });

  if (!meeting) {
    throw new Error("会議が見つかりません。");
  }

  return meeting;
}

function getRound(meeting: MeetingBundle, step: string) {
  return meeting.rounds.find((round) => round.step === step);
}

export async function startMeeting(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      company: {
        include: { boardMembers: true },
      },
    },
  });

  if (!project) {
    throw new Error("企画が見つかりません。");
  }

  if (!project.company.boardMembers.some((m) => m.isChairperson)) {
    throw new Error("CEO（編集者）が設定されていません。");
  }

  if (!project.company.boardMembers.some((m) => m.roleKey === "product_coach")) {
    throw new Error(
      "企画推進役が設定されていません。seed を再実行するか役員を追加してください。",
    );
  }

  const meeting = await prisma.meeting.create({
    data: {
      projectId,
      status: MEETING_STATUS.AGENDA,
      currentStep: MEETING_STEP.AGENDA,
    },
  });

  await prisma.project.update({
    where: { id: projectId },
    data: { status: PROJECT_STATUS.IN_REVIEW },
  });

  return advanceMeeting(meeting.id);
}

export async function advanceMeeting(meetingId: string) {
  const meeting = await loadMeetingBundle(meetingId);
  const status = meeting.status as MeetingStatus;

  if (status === MEETING_STATUS.DECIDED) {
    return meeting;
  }

  if (
    status === MEETING_STATUS.AWAITING_ANSWER ||
    status === MEETING_STATUS.AWAITING_ANSWER_2 ||
    status === MEETING_STATUS.AWAITING_DISCUSSION
  ) {
    throw new Error("企画者の回答を待っています。回答を送信してください。");
  }

  try {
    switch (status) {
      case MEETING_STATUS.AGENDA:
        return await runAgendaStep(meeting);
      case MEETING_STATUS.INITIAL_REVIEW:
        return await runInitialReviewStep(meeting);
      case MEETING_STATUS.DISCUSSION:
      case MEETING_STATUS.REBUTTAL:
        return await runDiscussionStep(meeting);
      case MEETING_STATUS.PRODUCT_COACH:
      case MEETING_STATUS.INTERIM:
        return await runProductCoachStep(meeting);
      case MEETING_STATUS.CEO_EDIT:
        return await runCeoEditStep(meeting);
      case MEETING_STATUS.GROWTH_SUMMARY:
      case MEETING_STATUS.DECISION:
        // DECISION is legacy; run growth summary instead of reference vote
        return await runGrowthSummaryStep(meeting.id);
      case MEETING_STATUS.RE_REVIEW:
      case MEETING_STATUS.PRODUCT_COACH_FOLLOWUP:
        // Legacy mid-flow: jump to CEO edit
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: {
            status: MEETING_STATUS.CEO_EDIT,
            currentStep: MEETING_STEP.CEO_EDIT,
            errorMessage: null,
          },
        });
        return await runCeoEditStep(await loadMeetingBundle(meeting.id));
      default:
        throw new Error(`このステータスでは進行できません: ${status}`);
    }
  } catch (error) {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: MEETING_STATUS.FAILED,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

async function runAgendaStep(meeting: MeetingBundle) {
  const company = toCompanyContext(meeting.project.company);
  const project = toProjectContext(meeting.project);
  const chair = meeting.project.company.boardMembers.find((m) => m.isChairperson);
  if (!chair) throw new Error("CEOが見つかりません。");

  const agenda = await runAgenda({
    company,
    project,
    chair: toMemberContext(chair),
  });

  await prisma.$transaction(async (tx) => {
    const round = await tx.meetingRound.create({
      data: {
        meetingId: meeting.id,
        step: MEETING_STEP.AGENDA,
        roundNumber: 1,
        summary: agenda as Json,
      },
    });

    await tx.statement.create({
      data: {
        meetingRoundId: round.id,
        boardMemberId: chair.id,
        speakerType: "board_member",
        content: agenda as Json,
        rawText: agenda.agenda,
      },
    });

    await tx.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MEETING_STATUS.INITIAL_REVIEW,
        currentStep: MEETING_STEP.INITIAL_REVIEW,
        errorMessage: null,
      },
    });
  });

  return loadMeetingBundle(meeting.id);
}

async function runInitialReviewStep(meeting: MeetingBundle) {
  // Generation is client-driven via /reviews/stream (parallel, arrival-order UI).
  // Advance only finalizes if statements are already complete; otherwise ensure round.
  const agendaRound = getRound(meeting, MEETING_STEP.AGENDA);
  if (!agendaRound?.summary) {
    throw new Error("議題整理が未完了です。");
  }

  const reviewers = meeting.project.company.boardMembers.filter(isSpecialtyReviewer);
  let round = getRound(meeting, MEETING_STEP.INITIAL_REVIEW);

  if (!round) {
    await prisma.meetingRound.create({
      data: {
        meetingId: meeting.id,
        step: MEETING_STEP.INITIAL_REVIEW,
        roundNumber: 2,
      },
    });
    return loadMeetingBundle(meeting.id);
  }

  const doneIds = new Set(
    round.statements
      .map((s) => s.boardMemberId)
      .filter((id): id is string => Boolean(id)),
  );
  const allDone =
    reviewers.length > 0 && reviewers.every((m) => doneIds.has(m.id));

  if (allDone) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MEETING_STATUS.DISCUSSION,
        currentStep: MEETING_STEP.DISCUSSION,
        errorMessage: null,
      },
    });
  }

  return loadMeetingBundle(meeting.id);
}


async function runDiscussionStep(meeting: MeetingBundle) {
  const agendaRound = getRound(meeting, MEETING_STEP.AGENDA);
  const chair = meeting.project.company.boardMembers.find((m) => m.isChairperson);
  if (!chair) throw new Error("CEOが見つかりません。");

  const speakers = meeting.project.company.boardMembers.filter(isDiscussionSpeaker);
  if (speakers.length < 2) {
    throw new Error(
      "壁打ち参加者（役員）が不足しています。Quality Balancerを含む役員をseedしてください。",
    );
  }

  await runDiscussionBatch({
    meetingId: meeting.id,
    company: toCompanyContext(meeting.project.company),
    project: toProjectContext(meeting.project),
    reviewLevel: extractReviewLevel(agendaRound?.summary),
    chair,
    speakers,
    projectId: meeting.projectId,
  });

  return loadMeetingBundle(meeting.id);
}

export async function submitDiscussionReply(
  meetingId: string,
  reply: { message: string; revisedPlan?: string },
) {
  const meeting = await loadMeetingBundle(meetingId);
  if (
    meeting.status !== MEETING_STATUS.AWAITING_DISCUSSION &&
    meeting.status !== MEETING_STATUS.DISCUSSION
  ) {
    throw new Error("現在は壁打ち中の企画者発言を受け付けていません。");
  }

  await appendProposerDiscussionReply({
    meetingId,
    message: reply.message,
    revisedPlan: reply.revisedPlan,
  });

  return loadMeetingBundle(meetingId);
}


async function runProductCoachStep(meeting: MeetingBundle) {
  const agendaRound = getRound(meeting, MEETING_STEP.AGENDA);
  const reviewRound = getRound(meeting, MEETING_STEP.INITIAL_REVIEW);
  const discussionRound =
    getRound(meeting, MEETING_STEP.DISCUSSION) ??
    getRound(meeting, MEETING_STEP.REBUTTAL);

  if (!reviewRound) {
    throw new Error("役員レビューが未完了です。");
  }

  const coach = findProductCoach(meeting);
  const coachOutput = await runProductCoach({
    company: toCompanyContext(meeting.project.company),
    project: toProjectContext(meeting.project),
    coach: toMemberContext(coach),
    reviews: reviewRound.statements.map((s) => ({
      memberTitle: s.boardMember?.title,
      content: s.content,
    })),
    mutualReviews: discussionRound?.summary
      ? [discussionRound.summary]
      : (discussionRound?.statements.map((s) => ({
          memberTitle: s.boardMember?.title,
          content: s.content,
        })) ?? []),
    reviewLevel: extractReviewLevel(agendaRound?.summary),
    roundLabel: "ディスカッション後の論点・宿題整理",
  });

  await prisma.$transaction(async (tx) => {
    const round = await tx.meetingRound.create({
      data: {
        meetingId: meeting.id,
        step: MEETING_STEP.PRODUCT_COACH,
        roundNumber: 4,
        summary: coachOutput as Json,
      },
    });

    await tx.statement.create({
      data: {
        meetingRoundId: round.id,
        boardMemberId: coach.id,
        speakerType: "board_member",
        content: coachOutput as Json,
        rawText: coachOutput.reviewSummary,
      },
    });

    await tx.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MEETING_STATUS.AWAITING_ANSWER,
        currentStep: MEETING_STEP.PROPOSER_ANSWER,
        errorMessage: null,
      },
    });
  });

  return loadMeetingBundle(meeting.id);
}

export async function submitProposerAnswer(
  meetingId: string,
  answer: {
    rebuttal: string;
    additionalInfo: string;
    revisedPlan: string;
  },
) {
  const meeting = await loadMeetingBundle(meetingId);
  const canAnswer =
    meeting.status === MEETING_STATUS.AWAITING_ANSWER ||
    meeting.status === MEETING_STATUS.AWAITING_ANSWER_2;

  if (!canAnswer) {
    throw new Error("現在は企画者回答を受け付けていません。");
  }

  await prisma.$transaction(async (tx) => {
    const round = await tx.meetingRound.create({
      data: {
        meetingId,
        step: MEETING_STEP.PROPOSER_ANSWER,
        roundNumber: 5,
        summary: answer as Json,
      },
    });

    await tx.statement.create({
      data: {
        meetingRoundId: round.id,
        speakerType: "proposer",
        content: answer as Json,
        rawText: [
          answer.rebuttal,
          answer.additionalInfo,
          answer.revisedPlan,
        ].join("\n\n"),
      },
    });

    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: MEETING_STATUS.CEO_EDIT,
        currentStep: MEETING_STEP.CEO_EDIT,
        errorMessage: null,
      },
    });
  });

  return loadMeetingBundle(meetingId);
}

/** Skip proposer answer when no homework is needed; go straight to CEO edit. */
export async function skipProposerAnswer(meetingId: string) {
  const meeting = await loadMeetingBundle(meetingId);
  if (
    meeting.status !== MEETING_STATUS.AWAITING_ANSWER &&
    meeting.status !== MEETING_STATUS.AWAITING_ANSWER_2
  ) {
    throw new Error("現在は企画者回答ステップではありません。");
  }

  const skipped = {
    rebuttal: "（スキップ）追加の回答はありません。ディスカッション内容で進めてください。",
    additionalInfo: "",
    revisedPlan: "",
    skipped: true,
  };

  await prisma.$transaction(async (tx) => {
    const round = await tx.meetingRound.create({
      data: {
        meetingId,
        step: MEETING_STEP.PROPOSER_ANSWER,
        roundNumber: 5,
        summary: skipped as Json,
      },
    });

    await tx.statement.create({
      data: {
        meetingRoundId: round.id,
        speakerType: "proposer",
        content: skipped as Json,
        rawText: skipped.rebuttal,
      },
    });

    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: MEETING_STATUS.CEO_EDIT,
        currentStep: MEETING_STEP.CEO_EDIT,
        errorMessage: null,
      },
    });
  });

  return loadMeetingBundle(meetingId);
}

async function runCeoEditStep(meeting: MeetingBundle) {
  const agendaRound = getRound(meeting, MEETING_STEP.AGENDA);
  const coachRound = latestCoachRound(meeting);
  const answerRound = latestProposerAnswerRound(meeting);
  const reviewRound = getRound(meeting, MEETING_STEP.INITIAL_REVIEW);
  const discussionRound =
    getRound(meeting, MEETING_STEP.DISCUSSION) ??
    getRound(meeting, MEETING_STEP.REBUTTAL);
  if (!coachRound) {
    throw new Error("CEO編集に必要なデータが不足しています（企画推進役）。");
  }

  const chair = meeting.project.company.boardMembers.find((m) => m.isChairperson);
  if (!chair) throw new Error("CEOが見つかりません。");

  const proposerAnswer =
    answerRound?.summary ??
    {
      rebuttal: "（企画者回答なし — ディスカッション内容を優先）",
      additionalInfo: "",
      revisedPlan: "",
    };

  const ceoEdit = await runCeoEdit({
    company: toCompanyContext(meeting.project.company),
    project: toProjectContext(meeting.project),
    chair: toMemberContext(chair),
    interim: coachRound.summary,
    proposerAnswer,
    reReviews:
      reviewRound?.statements.map((s) => ({
        memberTitle: s.boardMember?.title,
        content: s.content,
      })) ?? [],
    rebuttals: discussionRound?.summary
      ? [discussionRound.summary]
      : (discussionRound?.statements.map((s) => ({
          memberTitle: s.boardMember?.title,
          content: s.content,
        })) ?? []),
    reviewLevel: extractReviewLevel(agendaRound?.summary),
  });

  await prisma.$transaction(async (tx) => {
    const round = await tx.meetingRound.create({
      data: {
        meetingId: meeting.id,
        step: MEETING_STEP.CEO_EDIT,
        roundNumber: 6,
        summary: ceoEdit as Json,
      },
    });

    await tx.statement.create({
      data: {
        meetingRoundId: round.id,
        boardMemberId: chair.id,
        speakerType: "board_member",
        content: ceoEdit as Json,
        rawText: ceoEdit.coreValue,
      },
    });

    await tx.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MEETING_STATUS.GROWTH_SUMMARY,
        currentStep: MEETING_STEP.GROWTH_SUMMARY,
        errorMessage: null,
      },
    });
  });

  return loadMeetingBundle(meeting.id);
}

async function runGrowthSummaryStep(meetingId: string) {
  let meeting = await loadMeetingBundle(meetingId);
  let ceoEditRound = getRound(meeting, MEETING_STEP.CEO_EDIT);

  if (!ceoEditRound?.summary) {
    meeting = await runCeoEditStep(meeting);
    ceoEditRound = getRound(meeting, MEETING_STEP.CEO_EDIT);
  }

  const coachRound = latestCoachRound(meeting);
  const answer1 = getRound(meeting, MEETING_STEP.PROPOSER_ANSWER);
  const answer2 = getRound(meeting, MEETING_STEP.PROPOSER_ANSWER_2);
  if (!coachRound || !ceoEditRound?.summary) {
    throw new Error(
      "育成サマリーに必要なデータが不足しています。CEO編集を先に完了してください。",
    );
  }

  const chair = meeting.project.company.boardMembers.find((m) => m.isChairperson);
  if (!chair) throw new Error("CEOが見つかりません。");

  const growth = await runGrowthSummary({
    company: toCompanyContext(meeting.project.company),
    project: toProjectContext(meeting.project),
    chair: toMemberContext(chair),
    coach: coachRound.summary,
    proposerAnswers: [answer1?.summary, answer2?.summary].filter(Boolean),
    ceoEdit: ceoEditRound.summary,
  });

  await prisma.$transaction(async (tx) => {
    const growthRound = await tx.meetingRound.create({
      data: {
        meetingId,
        step: MEETING_STEP.GROWTH_SUMMARY,
        roundNumber: 7,
        summary: growth as Json,
      },
    });

    await tx.statement.create({
      data: {
        meetingRoundId: growthRound.id,
        boardMemberId: chair.id,
        speakerType: "board_member",
        content: growth as Json,
        rawText: growth.afterSummary,
      },
    });

    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: MEETING_STATUS.DECIDED,
        currentStep: MEETING_STEP.GROWTH_SUMMARY,
        errorMessage: null,
      },
    });

    await tx.project.update({
      where: { id: meeting.projectId },
      data: { status: PROJECT_STATUS.DECIDED },
    });
  });

  return loadMeetingBundle(meetingId);
}

export async function retryFailedMeeting(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new Error("会議が見つかりません。");
  if (meeting.status !== MEETING_STATUS.FAILED) {
    throw new Error("失敗状態の会議のみ再試行できます。");
  }

  const restoreMap: Record<string, MeetingStatus> = {
    [MEETING_STEP.AGENDA]: MEETING_STATUS.AGENDA,
    [MEETING_STEP.INITIAL_REVIEW]: MEETING_STATUS.INITIAL_REVIEW,
    [MEETING_STEP.DISCUSSION]: MEETING_STATUS.DISCUSSION,
    [MEETING_STEP.REBUTTAL]: MEETING_STATUS.DISCUSSION,
    [MEETING_STEP.PRODUCT_COACH]: MEETING_STATUS.PRODUCT_COACH,
    [MEETING_STEP.INTERIM]: MEETING_STATUS.PRODUCT_COACH,
    [MEETING_STEP.PROPOSER_ANSWER]: MEETING_STATUS.AWAITING_ANSWER,
    [MEETING_STEP.RE_REVIEW]: MEETING_STATUS.CEO_EDIT,
    [MEETING_STEP.PRODUCT_COACH_FOLLOWUP]: MEETING_STATUS.CEO_EDIT,
    [MEETING_STEP.PROPOSER_ANSWER_2]: MEETING_STATUS.CEO_EDIT,
    [MEETING_STEP.CEO_EDIT]: MEETING_STATUS.CEO_EDIT,
    [MEETING_STEP.DECISION]: MEETING_STATUS.GROWTH_SUMMARY,
    [MEETING_STEP.GROWTH_SUMMARY]: MEETING_STATUS.GROWTH_SUMMARY,
  };

  const restored = restoreMap[meeting.currentStep] ?? MEETING_STATUS.AGENDA;

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: restored,
      errorMessage: null,
    },
  });

  if (
    restored === MEETING_STATUS.AWAITING_ANSWER ||
    restored === MEETING_STATUS.AWAITING_ANSWER_2 ||
    restored === MEETING_STATUS.AWAITING_DISCUSSION
  ) {
    return loadMeetingBundle(meetingId);
  }

  return advanceMeeting(meetingId);
}
