import { z } from "zod";

/** Soft-cap arrays so over-long AI output truncates instead of failing validation. */
function cappedArray<T extends z.ZodTypeAny>(
  itemSchema: T,
  max: number,
  min = 0,
) {
  const base =
    min > 0
      ? z.array(itemSchema).min(min).max(max)
      : z.array(itemSchema).max(max);
  return z.preprocess(
    (value) => (Array.isArray(value) ? value.slice(0, max) : value),
    base,
  );
}

export const stanceSchema = z.preprocess((value) => {
  // Models sometimes emit "accept"; normalize to the canonical enum.
  if (value === "accept") return "approve";
  return value;
}, z.enum(["approve", "conditional", "reject", "hold"]));

export const reviewLevelSchema = z.enum([
  "experiment",
  "standard",
  "strategic",
]);

export const coreConceptSchema = z.object({
  summary: z.string().min(1),
  pillars: z.array(z.string()).min(1).max(6),
});

export const agendaSchema = z.object({
  agenda: z.string(),
  problemsToSolve: z.array(z.string()),
  assumptions: z.array(z.string()),
  constraints: z.array(z.string()),
  decisionCriteria: z.array(z.string()),
  missingInformation: z.array(z.string()),
  reviewLevel: reviewLevelSchema,
  reviewLevelReason: z.string(),
  coreConcept: coreConceptSchema,
});

const LIMITED_CONDITION_HINT =
  /限定|上限|任意|KPI|kpi|期間|週間|週|月間|日間|人数|名|円|時間|予算|パイロット|試行|検証|紙|小規模|1クラス|クラス|まで|以内|条件付き|段階|フェーズ|MVP|mvp/;

function looksLikeLimitedCondition(text: string): boolean {
  return LIMITED_CONDITION_HINT.test(text) && text.trim().length >= 4;
}

type Stance = "approve" | "conditional" | "reject" | "hold";

type ProposalVoteFields = {
  currentProposalVote: Stance;
  revisedProposalVote: Stance | null;
  coreConceptPreserved: boolean;
  coreConceptChangedReason: string | null;
  decisionRationale: string;
  approvalConditions: string[];
  requiredRevisions: string[];
  resubmissionRequired: boolean;
};

function asStance(value: unknown): Stance | null {
  if (value === "accept") return "approve";
  if (
    value === "approve" ||
    value === "conditional" ||
    value === "reject" ||
    value === "hold"
  ) {
    return value;
  }
  return null;
}

/**
 * AI often puts revision-style asks into approvalConditions.
 * Move those to requiredRevisions and adjust the vote so validation can pass.
 */
function normalizeProposalVoteFields(
  value: ProposalVoteFields,
): ProposalVoteFields {
  const limited: string[] = [];
  const revisions = [...value.requiredRevisions];

  for (const condition of value.approvalConditions) {
    if (looksLikeLimitedCondition(condition)) {
      limited.push(condition);
    } else if (condition.trim()) {
      revisions.push(condition);
    }
  }

  const uniqueRevisions = [...new Set(revisions.map((r) => r.trim()))]
    .filter(Boolean)
    .slice(0, 5);
  const uniqueLimited = [...new Set(limited.map((c) => c.trim()))]
    .filter(Boolean)
    .slice(0, 4);

  let next: ProposalVoteFields = {
    ...value,
    approvalConditions: uniqueLimited,
    requiredRevisions: uniqueRevisions,
  };

  if (next.currentProposalVote === "conditional") {
    if (uniqueLimited.length === 0 && uniqueRevisions.length > 0) {
      next = {
        ...next,
        currentProposalVote: "reject",
        revisedProposalVote: next.revisedProposalVote ?? "conditional",
        coreConceptPreserved: false,
        coreConceptChangedReason:
          next.coreConceptChangedReason ??
          "条件付き賛成の内容が核心を変える修正になっていたため、現行案は反対・修正前提に正規化した。",
        resubmissionRequired: true,
        approvalConditions: [],
      };
    } else if (uniqueLimited.length === 0) {
      next = {
        ...next,
        currentProposalVote: "hold",
        resubmissionRequired: false,
        approvalConditions: [],
      };
    } else {
      next = {
        ...next,
        resubmissionRequired: false,
        coreConceptPreserved: true,
        coreConceptChangedReason: null,
      };
    }
  }

  return next;
}

function preprocessVoteInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const currentProposalVote = asStance(record.currentProposalVote);
  if (!currentProposalVote) return value;

  const revisedRaw = record.revisedProposalVote;
  const revisedProposalVote =
    revisedRaw === null || revisedRaw === undefined
      ? null
      : asStance(revisedRaw);

  const approvalConditions = Array.isArray(record.approvalConditions)
    ? record.approvalConditions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const requiredRevisions = Array.isArray(record.requiredRevisions)
    ? record.requiredRevisions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const normalized = normalizeProposalVoteFields({
    currentProposalVote,
    revisedProposalVote,
    coreConceptPreserved: Boolean(record.coreConceptPreserved),
    coreConceptChangedReason:
      typeof record.coreConceptChangedReason === "string"
        ? record.coreConceptChangedReason
        : null,
    decisionRationale:
      typeof record.decisionRationale === "string"
        ? record.decisionRationale
        : "",
    approvalConditions,
    requiredRevisions,
    resubmissionRequired: Boolean(record.resubmissionRequired),
  });

  return { ...record, ...normalized };
}

const proposalVoteFieldsObjectSchema = z
  .object({
    currentProposalVote: stanceSchema,
    revisedProposalVote: stanceSchema.nullable(),
    coreConceptPreserved: z.boolean(),
    coreConceptChangedReason: z.string().nullable(),
    decisionRationale: z.string().min(1).max(800),
    approvalConditions: z.array(z.string()).max(8),
    requiredRevisions: z.array(z.string()).max(8),
    resubmissionRequired: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.currentProposalVote === "conditional") {
      if (!value.coreConceptPreserved) {
        ctx.addIssue({
          code: "custom",
          path: ["currentProposalVote"],
          message:
            "核心を変える修正が必要な場合、現行案への条件付き賛成は不可です。反対または保留にしてください。",
        });
      }
      if (value.resubmissionRequired) {
        ctx.addIssue({
          code: "custom",
          path: ["resubmissionRequired"],
          message:
            "条件付き賛成では resubmissionRequired を false にしてください。再提出が必要なら反対/保留です。",
        });
      }
      if (value.approvalConditions.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["approvalConditions"],
          message:
            "条件付き賛成には、人数/期間/予算/任意参加/KPI/説明時間などの限定条件が必要です。",
        });
      }
    }

    if (!value.coreConceptPreserved) {
      if (
        value.currentProposalVote === "approve" ||
        value.currentProposalVote === "conditional"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["currentProposalVote"],
          message:
            "coreConceptPreserved=false のとき、現行案は原則として反対または保留です。",
        });
      }
      if (!value.resubmissionRequired) {
        ctx.addIssue({
          code: "custom",
          path: ["resubmissionRequired"],
          message: "核心が変わる場合は resubmissionRequired=true にしてください。",
        });
      }
      if (!value.coreConceptChangedReason) {
        ctx.addIssue({
          code: "custom",
          path: ["coreConceptChangedReason"],
          message: "核心が変わる場合は理由を記入してください。",
        });
      }
    }

    if (
      (value.revisedProposalVote === "approve" ||
        value.revisedProposalVote === "conditional") &&
      value.requiredRevisions.length === 0 &&
      !value.coreConceptPreserved
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["requiredRevisions"],
        message:
          "修正版なら賛成可能とする場合は、必要な修正を requiredRevisions に列挙してください。",
      });
    }
  });

/**
 * Shared vote fields: separates vote on current proposal vs revised proposal.
 */
export const proposalVoteFieldsSchema = z.preprocess(
  preprocessVoteInput,
  proposalVoteFieldsObjectSchema,
);

export const initialReviewSchema = z.preprocess(
  preprocessVoteInput,
  proposalVoteFieldsObjectSchema
    .safeExtend({
      positives: cappedArray(z.string(), 3, 1),
      concerns: cappedArray(
        z.object({
          concern: z.string().min(1),
          reason: z.string().min(1),
        }),
        2,
        1,
      ),
      improvements: cappedArray(
        z.object({
          proposal: z.string().min(1),
          expectedEffect: z.string().min(1),
          preservesCoreConcept: z.boolean(),
        }),
        2,
        1,
      ),
      questions: cappedArray(z.string(), 2),
    })
    .transform((value) => ({
      ...value,
      stance: value.currentProposalVote,
      biggestConcern: value.concerns[0]?.concern ?? "",
      evaluation: value.positives.join(" / "),
      revisionProposals: value.improvements.map((i) => i.proposal),
    })),
);

export const triageTypeSchema = z.enum([
  "important",
  "over_quality",
  "mvp_unnecessary",
  "future_ok",
  "side_effect",
  "priority_shift",
  "better_alternative",
]);

/** Mutual review (formerly rebuttal) — triage important issues. */
export const rebuttalSchema = z
  .object({
    referencedMemberTitle: z.string().min(1),
    triageType: triageTypeSchema,
    importantPoint: z.string().min(1),
    triageReason: z.string().min(1),
    recommendation: z.string().min(1),
    agreeingPoints: cappedArray(z.string(), 2),
    disagreeingPoints: cappedArray(z.string(), 1),
    overlookedPoints: cappedArray(z.string(), 2),
    decisionChanged: z.boolean(),
    previousDecision: stanceSchema,
    currentDecision: stanceSchema,
    changedCondition: z.string().min(1),
    questionsForProposer: cappedArray(z.string(), 2),
    // legacy compatibility
    disagreementType: z.string().optional(),
    rejectedClaim: z.string().optional(),
    choiceConflict: z.string().optional(),
    opponentClaim: z.string().optional(),
    counterpoint: z.string().optional(),
    counterReason: z.string().optional(),
    alternative: z.string().optional(),
    rebuttalType: z.string().optional(),
    stanceChanged: z.boolean().optional(),
    currentStance: stanceSchema.optional(),
    changeReason: z.string().optional(),
  })
  .transform((value) => ({
    ...value,
    disagreementType: value.disagreementType ?? value.triageType,
    rejectedClaim: value.rejectedClaim ?? value.importantPoint,
    opponentClaim: value.opponentClaim ?? value.importantPoint,
    counterpoint: value.counterpoint ?? value.recommendation,
    counterReason: value.counterReason ?? value.triageReason,
    alternative: value.alternative ?? value.recommendation,
    choiceConflict: value.choiceConflict ?? value.importantPoint,
    rebuttalType: value.rebuttalType ?? value.triageType,
    stanceChanged: value.stanceChanged ?? value.decisionChanged,
    currentStance: value.currentStance ?? value.currentDecision,
    changeReason: value.changeReason ?? value.changedCondition,
  }));

export const voteQuestionSchema = z.object({
  question: z.string().min(1),
  whyNeeded: z.string().min(1),
  affectedMembers: z.array(z.string()).max(7),
  canValidateInPilot: z.boolean(),
});

export const chairRecommendationSchema = z.enum([
  "approve",
  "conditional",
  "pilot",
  "hold",
  "reject",
]);

/** @deprecated replaced by productCoachSchema */
export const interimSchema = z.object({
  consensusPoints: z.array(z.string()).max(5),
  disputedPoints: z.array(z.string()).max(3),
  fatalConcerns: z.array(z.string()).max(3),
  questionsBeforeVote: z.array(voteQuestionSchema).max(5),
  itemsToValidateInPilot: z.array(z.string()).max(5),
  chairRecommendation: chairRecommendationSchema,
  chairRecommendationReason: z.string(),
});

export const productCoachSchema = z.object({
  reviewSummary: z.string().min(1),
  priorityTop3: z.array(z.string()).min(1).max(3),
  fixNow: z.array(z.string()).min(1).max(5),
  deferLater: z.array(z.string()).max(5),
  adviceToProposer: z.string().min(1),
  revisedDraft: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    keyChanges: z.array(z.string()).max(5),
    openQuestions: z.array(z.string()).max(3),
  }),
});

export const proposerAnswerSchema = z.object({
  rebuttal: z.string(),
  additionalInfo: z.string(),
  revisedPlan: z.string(),
});

export const reReviewSchema = z.preprocess(
  preprocessVoteInput,
  proposalVoteFieldsObjectSchema
    .safeExtend({
      positives: cappedArray(z.string(), 3),
      concerns: cappedArray(
        z.object({
          concern: z.string().min(1),
          reason: z.string().min(1),
        }),
        2,
      ),
      improvements: cappedArray(
        z.object({
          proposal: z.string().min(1),
          expectedEffect: z.string().min(1),
          preservesCoreConcept: z.boolean(),
        }),
        2,
      ),
      questions: cappedArray(z.string(), 2),
      stanceChanged: z.boolean(),
      changeReason: z.string(),
      remainingConcerns: cappedArray(z.string(), 3),
    })
    .transform((value) => ({
      ...value,
      finalStance: value.currentProposalVote,
    })),
);

export const decisionSchema = z.preprocess(
  preprocessVoteInput,
  z.object({
    result: z.enum(["approved", "conditional", "reconsider", "rejected"]),
    conditions: z.array(z.string()),
    mainReasons: z.array(z.string()),
    strengthenedPoints: z.array(z.string()),
    remainingRisks: z.array(z.string()),
    nextActions: z.array(z.string()).max(5),
    kpisToVerify: z.array(z.string()),
    currentProposalVote: stanceSchema,
    revisedProposalVote: stanceSchema.nullable(),
    coreConceptPreserved: z.boolean(),
    coreConceptChangedReason: z.string().nullable(),
    decisionRationale: z.string().min(1),
    approvalConditions: z.array(z.string()).max(8),
    requiredRevisions: z.array(z.string()).max(8),
    resubmissionRequired: z.boolean(),
    note: z
      .string()
      .optional()
      .describe("採決は参考情報であることの注記"),
  }),
);

export const deferCategorySchema = z.enum([
  "mvp_unnecessary",
  "against_simply",
  "future_phase",
  "unclear_effect",
  "ops_load",
  "other",
]);

export const ceoEditSchema = z.object({
  coreValue: z.string().min(1).max(200),
  adoptedImprovements: z
    .array(
      z.object({
        proposal: z.string().min(1),
        reason: z.string().min(1),
        sourceHint: z.string().optional(),
      }),
    )
    .max(3),
  /** 価値はあるが今回はやらない */
  heldImprovements: z
    .array(
      z.object({
        proposal: z.string().min(1),
        reason: z.string().min(1),
        sourceHint: z.string().optional(),
      }),
    )
    .max(5),
  deferredImprovements: z
    .array(
      z.object({
        proposal: z.string().min(1),
        reason: z.string().min(1),
        deferCategory: deferCategorySchema,
        sourceHint: z.string().optional(),
      }),
    )
    .max(5),
  editComment: z.string().min(1),
  futureBacklog: z.array(z.string()).max(8),
  editedPlan: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    scope: z.string().min(1),
    outOfScope: z.string().min(1),
    successCriteria: z.array(z.string()).max(5),
    operations: z.string().min(1),
  }),
  simplyCheck: z.object({
    complexityReduced: z.boolean(),
    valuePreserved: z.boolean(),
    explanation: z.string().min(1),
  }),
});

export const growthSummarySchema = z.object({
  beforeSummary: z.string().min(1),
  newPerspectives: z.array(z.string()).max(8),
  adoptedByProposer: z.array(z.string()).max(8),
  afterSummary: z.string().min(1),
  valueImproved: z.array(z.string()).max(5),
  concernsResolved: z.array(z.string()).max(5),
  remainingIssues: z.array(z.string()).max(5),
  backlog: z.array(z.string()).max(8),
  nextActions: z.array(z.string()).min(1).max(5),
});

const WEAK_ISSUE_TURN =
  /この懸念は重要|同意する|追加で検討|さらに検討|妥当である|参考になる|も重要/;

/** Chair extracts up to 3 conflict issues from Step 2 reviews. */
export const issueExtractionSchema = z.object({
  issues: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        conflictSummary: z.string().min(1).max(150),
        options: z
          .array(
            z.object({
              key: z.enum(["A", "B", "C"]),
              label: z.string().min(1).max(80),
            }),
          )
          .min(2)
          .max(3),
        participantRoleKeys: z.array(z.string().min(1)).length(2),
        whyTheseParticipants: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(3),
});

/** One short debate turn in an issue thread (max 2 exchanges). */
export const issueDebateTurnSchema = z
  .object({
    turnType: z.enum(["claim", "rebuttal", "re_rebuttal"]),
    claim: z.string().min(1).max(150),
    counterToOpponent: z.string().max(150),
    alternative: z.string().min(1).max(100),
    judgmentCondition: z.string().min(1).max(100),
    preferredOptionKey: z.enum(["A", "B", "C"]),
    voteChanged: z.boolean(),
    conditionChanged: z.boolean(),
    previousVote: stanceSchema,
    currentVote: stanceSchema,
    previousCondition: z.string().max(100),
    currentCondition: z.string().max(100),
  })
  .superRefine((value, ctx) => {
    const blob = `${value.claim}${value.counterToOpponent}${value.alternative}`;
    if (WEAK_ISSUE_TURN.test(blob) && blob.length < 40) {
      ctx.addIssue({
        code: "custom",
        path: ["claim"],
        message:
          "弱い同意・要約のみの発言は禁止です。選択肢と具体的条件で主張してください。",
      });
    }
    if (value.turnType !== "claim" && !value.counterToOpponent.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["counterToOpponent"],
        message: "反論ターンでは counterToOpponent が必須です。",
      });
    }
  })
  .transform((value) => ({
    ...value,
    // display helpers
    decisionChanged: value.voteChanged,
    changedCondition: value.currentCondition,
    previousDecision: value.previousVote,
    currentDecision: value.currentVote,
  }));

/** Chair closes each issue with concrete options for the proposer. */
export const issueChairSummarySchema = z.object({
  conflictPoint: z.string().min(1).max(150),
  optionA: z.string().min(1).max(100),
  optionB: z.string().min(1).max(100),
  optionAPros: z.array(z.string().max(80)).min(1).max(3),
  optionACons: z.array(z.string().max(80)).min(1).max(3),
  optionBPros: z.array(z.string().max(80)).min(1).max(3),
  optionBCons: z.array(z.string().max(80)).min(1).max(3),
  recommendation: z.string().min(1).max(150),
  proposerMustDecide: z.string().min(1).max(150),
});

/** Quality Balancer: cut over-quality / complexity / non-MVP. */
export const qualityBalancerSchema = z.object({
  keptChoices: z.array(z.string().max(100)).min(1).max(2),
  cutItems: z
    .array(
      z.object({
        item: z.string().min(1).max(100),
        reason: z.enum([
          "over_quality",
          "complicates",
          "mvp_unnecessary",
          "future_ok",
        ]),
      }),
    )
    .max(5),
  simplyNote: z.string().min(1).max(200),
});

export type IssueExtractionOutput = z.infer<typeof issueExtractionSchema>;
export type IssueDebateTurnOutput = z.infer<typeof issueDebateTurnSchema>;
export type IssueChairSummaryOutput = z.infer<typeof issueChairSummarySchema>;
export type QualityBalancerOutput = z.infer<typeof qualityBalancerSchema>;

const REVIEW_LIKE_BANNED =
  /検討が必要|重要な論点|比較実験|マニュアルを作|不足しています|追加で検討|さらに調査/;

/** Chair picks next speaker dynamically (or asks proposer / proposes end). */
export const discussionTopicStatusSchema = z.enum([
  "unresolved",
  "discussing",
  "resolved",
]);

export const discussionTopicSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  status: discussionTopicStatusSchema,
  note: z.string().max(120).nullable().optional(),
});

export const discussionFacilitatorSchema = z.object({
  action: z.enum([
    "nominate",
    "ask_proposer",
    "chair_nudge",
    "propose_end",
    "rare_interrupt",
  ]),
  nextSpeakerRoleKey: z.string().nullable(),
  nominateReason: z.string().max(120),
  chairUtterance: z.string().max(150).nullable(),
  endReason: z.string().max(150).nullable(),
  /** rare_interrupt: who barges in after the nominated speaker (optional) */
  interruptRoleKey: z.string().nullable().optional(),
  /**
   * Full CEO issue board (all unresolved + resolved). Soft-capped.
   * Meeting may propose_end only when every topic is resolved.
   */
  openTopics: cappedArray(discussionTopicSchema, 12, 1),
  /**
   * Top-priority unresolved labels for the UI (importance order). Soft-capped at 4.
   * Subset of openTopics that are unresolved/discussing — never drops the full board.
   */
  priorityIssues: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    cappedArray(z.string().min(1).max(80), 4),
  ),
  /** Confirmed premises everyone must respect going forward. */
  decisions: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    cappedArray(z.string().min(1).max(80), 10),
  ),
  /** Explicitly rejected ideas — must not be re-proposed. */
  rejectedItems: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    cappedArray(z.string().min(1).max(80), 10),
  ),
  /** True when the current topic is looping without new info — may mark it resolved. */
  repetitionDetected: z.boolean(),
});

export const proposerIntentSchema = z.enum([
  "question",
  "objection",
  "clarification",
  "proposal_change",
  "topic_change",
  "pause_request",
  "summary_request",
  "decision",
  "end_request",
]);

export const interruptClassificationSchema = z.object({
  intent: proposerIntentSchema,
  preferredNextRoleKey: z.string().nullable(),
  overrideTargetReason: z.string().max(120).nullable(),
  chairUtterance: z.string().min(1).max(150),
  needsPlanUpdateReview: z.boolean(),
});

export const discussionBriefSummarySchema = z.object({
  currentPlan: z.string().min(1).max(300),
  agreedPoints: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    cappedArray(z.string().max(100), 8),
  ),
  /** Full remaining issues (discussion depth). Soft-capped — excess is truncated, not rejected. */
  openIssues: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    cappedArray(z.string().max(100), 10),
  ),
  /** Top-priority issues for the screen / next focus (importance order). Soft-capped at 4. */
  priorityIssues: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    cappedArray(z.string().max(100), 4),
  ),
  nextQuestion: z.string().min(1).max(150),
});

/** One natural wall-punch utterance (max 150 chars). */
export const discussionUtteranceSchema = z
  .object({
    text: z.string().min(1).max(150),
    addressTo: z.enum(["proposer", "officer", "all"]),
    addressRoleKey: z.string().nullable(),
    moveType: z.enum([
      "question",
      "counter",
      "alternative",
      "challenge_premise",
      "expand",
      "brake",
    ]),
  })
  .superRefine((value, ctx) => {
    if (REVIEW_LIKE_BANNED.test(value.text)) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message:
          "レビュー口調は禁止です。自然な質問・反論・別案・前提疑いに言い換えてください。",
      });
    }
  });

export const discussionReplySchema = z.object({
  message: z.string().min(1).max(800),
  revisedPlan: z.string().max(2000).optional(),
});

/** Chair detects mid-meeting plan changes from the proposer's utterance. */
export const planUpdateDetectionSchema = z.object({
  planUpdated: z.boolean(),
  changes: z
    .array(z.string().min(1).max(80))
    .max(6)
    .describe("例: 無料版を追加 / 価格を300円へ変更 / 紙検証のみに縮小"),
  /**
   * Updated plan overview. Optional — null/empty when the plan itself is unchanged
   * or only minor tweaks that don't need a full rewrite.
   */
  updatedPlanSummary: z.preprocess((value) => {
    if (value === "" || value === undefined) return null;
    return value;
  }, z.string().max(600).nullable()),
  chairNote: z.preprocess((value) => {
    if (value === "" || value === undefined) return null;
    return value;
  }, z.string().max(120).nullable()),
});

export type DiscussionFacilitatorOutput = z.infer<
  typeof discussionFacilitatorSchema
>;
export type DiscussionTopic = z.infer<typeof discussionTopicSchema>;
export type DiscussionUtteranceOutput = z.infer<typeof discussionUtteranceSchema>;
export type DiscussionReplyInput = z.infer<typeof discussionReplySchema>;
export type PlanUpdateDetectionOutput = z.infer<typeof planUpdateDetectionSchema>;
export type InterruptClassificationOutput = z.infer<
  typeof interruptClassificationSchema
>;
export type DiscussionBriefSummaryOutput = z.infer<
  typeof discussionBriefSummarySchema
>;

export type ReviewLevel = z.infer<typeof reviewLevelSchema>;
export type CoreConcept = z.infer<typeof coreConceptSchema>;
export type AgendaOutput = z.infer<typeof agendaSchema>;
export type InitialReviewOutput = z.infer<typeof initialReviewSchema>;
export type RebuttalOutput = z.infer<typeof rebuttalSchema>;
export type InterimOutput = z.infer<typeof interimSchema>;
export type ProductCoachOutput = z.infer<typeof productCoachSchema>;
export type ProposerAnswerInput = z.infer<typeof proposerAnswerSchema>;
export type ReReviewOutput = z.infer<typeof reReviewSchema>;
export type DecisionOutput = z.infer<typeof decisionSchema>;
export type CeoEditOutput = z.infer<typeof ceoEditSchema>;
export type GrowthSummaryOutput = z.infer<typeof growthSummarySchema>;
export type ChairRecommendation = z.infer<typeof chairRecommendationSchema>;
