export const MEETING_STATUS = {
  AGENDA: "agenda",
  INITIAL_REVIEW: "initial_review",
  /** AIディスカッション（旧: mutual review / rebuttal） */
  DISCUSSION: "discussion",
  /** ディスカッション中の企画者発言待ち */
  AWAITING_DISCUSSION: "awaiting_discussion",
  PRODUCT_COACH: "product_coach",
  AWAITING_ANSWER: "awaiting_answer",
  CEO_EDIT: "ceo_edit",
  GROWTH_SUMMARY: "growth_summary",
  DECIDED: "decided",
  FAILED: "failed",
  /** @deprecated removed from flow — legacy meetings only */
  RE_REVIEW: "re_review",
  /** @deprecated removed from flow — legacy meetings only */
  PRODUCT_COACH_FOLLOWUP: "product_coach_followup",
  /** @deprecated removed from flow — legacy meetings only */
  AWAITING_ANSWER_2: "awaiting_answer_2",
  /** @deprecated removed from flow — legacy meetings only */
  DECISION: "decision",
  /** @deprecated legacy — treated as DISCUSSION */
  REBUTTAL: "rebuttal",
  /** @deprecated legacy */
  INTERIM: "interim",
} as const;

export type MeetingStatus =
  (typeof MEETING_STATUS)[keyof typeof MEETING_STATUS];

export const MEETING_STEP = {
  AGENDA: "AGENDA",
  INITIAL_REVIEW: "INITIAL_REVIEW",
  DISCUSSION: "DISCUSSION",
  /** @deprecated legacy alias for DISCUSSION */
  REBUTTAL: "REBUTTAL",
  PRODUCT_COACH: "PRODUCT_COACH",
  PROPOSER_ANSWER: "PROPOSER_ANSWER",
  CEO_EDIT: "CEO_EDIT",
  GROWTH_SUMMARY: "GROWTH_SUMMARY",
  /** @deprecated removed from flow — kept for history display */
  RE_REVIEW: "RE_REVIEW",
  /** @deprecated removed from flow — kept for history display */
  PRODUCT_COACH_FOLLOWUP: "PRODUCT_COACH_FOLLOWUP",
  /** @deprecated removed from flow — kept for history display */
  PROPOSER_ANSWER_2: "PROPOSER_ANSWER_2",
  /** @deprecated removed from flow — kept for history display */
  DECISION: "DECISION",
  /** @deprecated legacy */
  INTERIM: "INTERIM",
} as const;

export type MeetingStep = (typeof MEETING_STEP)[keyof typeof MEETING_STEP];

export const STANCE = {
  APPROVE: "approve",
  CONDITIONAL: "conditional",
  REJECT: "reject",
  HOLD: "hold",
} as const;

export type Stance = (typeof STANCE)[keyof typeof STANCE];

export const DECISION_RESULT = {
  APPROVED: "approved",
  CONDITIONAL: "conditional",
  RECONSIDER: "reconsider",
  REJECTED: "rejected",
} as const;

export type DecisionResult =
  (typeof DECISION_RESULT)[keyof typeof DECISION_RESULT];

export const PROJECT_STATUS = {
  DRAFT: "draft",
  IN_REVIEW: "in_review",
  DECIDED: "decided",
} as const;

/** Active growth-review flow (7 steps). */
export const FLOW_STEPS: MeetingStep[] = [
  MEETING_STEP.AGENDA,
  MEETING_STEP.INITIAL_REVIEW,
  MEETING_STEP.DISCUSSION,
  MEETING_STEP.PRODUCT_COACH,
  MEETING_STEP.PROPOSER_ANSWER,
  MEETING_STEP.CEO_EDIT,
  MEETING_STEP.GROWTH_SUMMARY,
];

export const STEP_LABELS: Record<MeetingStep, string> = {
  AGENDA: "論点整理",
  INITIAL_REVIEW: "役員レビュー",
  DISCUSSION: "AIディスカッション",
  REBUTTAL: "AIディスカッション",
  PRODUCT_COACH: "企画推進役",
  PROPOSER_ANSWER: "企画者回答",
  CEO_EDIT: "CEO編集",
  GROWTH_SUMMARY: "育成サマリー",
  RE_REVIEW: "再レビュー(旧)",
  PRODUCT_COACH_FOLLOWUP: "企画推進役(再・旧)",
  PROPOSER_ANSWER_2: "企画者回答(再・旧)",
  DECISION: "参考採決(旧)",
  INTERIM: "中間整理(旧)",
};

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  agenda: "論点整理",
  initial_review: "役員レビュー",
  discussion: "AIディスカッション",
  awaiting_discussion: "ディスカッション中・企画者発言待ち",
  rebuttal: "AIディスカッション",
  product_coach: "企画推進役",
  awaiting_answer: "企画者回答待ち",
  ceo_edit: "CEO編集",
  growth_summary: "育成サマリー",
  decided: "完了",
  failed: "エラー",
  re_review: "再レビュー(旧)",
  product_coach_followup: "企画推進役(再・旧)",
  awaiting_answer_2: "企画者回答待ち(再・旧)",
  decision: "参考採決(旧)",
  interim: "中間整理(旧)",
};

export const STANCE_LABELS: Record<Stance, string> = {
  approve: "賛成",
  conditional: "条件付き賛成",
  reject: "反対",
  hold: "保留",
};

export const DECISION_LABELS: Record<DecisionResult, string> = {
  approved: "可決（参考）",
  conditional: "条件付き可決（参考）",
  reconsider: "再審議（参考）",
  rejected: "否決（参考）",
};

/** Officers who write specialty reviews (exclude CEO, coach, balancer). */
export function isSpecialtyReviewer(member: {
  isChairperson: boolean;
  roleKey: string;
}): boolean {
  if (member.isChairperson) return false;
  if (member.roleKey === "ceo") return false;
  if (member.roleKey === "product_coach") return false;
  if (member.roleKey === "quality_balancer") return false;
  return true;
}

/** Who can speak in the AI discussion (excl. chair & coach). */
export function isDiscussionSpeaker(member: {
  isChairperson: boolean;
  roleKey: string;
}): boolean {
  if (member.isChairperson) return false;
  if (member.roleKey === "ceo") return false;
  if (member.roleKey === "product_coach") return false;
  return true;
}
