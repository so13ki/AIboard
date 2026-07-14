import { randomUUID } from "node:crypto";
import { isSimilarPoint, similarityScore } from "@/lib/ai/dedupe";
import type { CeoQuestion } from "@/lib/ai/schemas";

export type ChairLikeMessage = {
  speakerType: string;
  kind?: string | null;
  messageType?: string | null;
  text?: string | null;
};

export type FacilitatorAction =
  | "nominate"
  | "ask_proposer"
  | "chair_nudge"
  | "propose_end"
  | "rare_interrupt";

export function isSameCeoQuestion(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  // Slightly lower threshold so paraphrased repeats still match
  return isSimilarPoint(a, b, 0.42) || similarityScore(a, b) >= 0.5;
}

export function findSimilarCeoQuestion(
  questions: CeoQuestion[],
  text: string,
  statuses?: CeoQuestion["status"][],
): CeoQuestion | undefined {
  return questions.find(
    (q) =>
      (!statuses || statuses.includes(q.status)) &&
      isSameCeoQuestion(q.text, text),
  );
}

export function recentSimilarChairUtterances(
  messages: ChairLikeMessage[],
  text: string,
  limit = 8,
): ChairLikeMessage[] {
  return messages
    .filter(
      (m) =>
        m.speakerType === "chair" &&
        m.kind !== "diagnostic" &&
        Boolean(m.text?.trim()) &&
        isSameCeoQuestion(m.text!, text),
    )
    .slice(-limit);
}

export function isRepeatedCeoChairUtterance(args: {
  ceoQuestions: CeoQuestion[];
  messages: ChairLikeMessage[];
  text: string;
}): boolean {
  const utter = args.text.trim();
  if (!utter) return false;
  if (
    findSimilarCeoQuestion(args.ceoQuestions, utter, [
      "OPEN",
      "ANSWERED",
      "RESOLVED",
      "PARKED",
    ])
  ) {
    return true;
  }
  return recentSimilarChairUtterances(args.messages, utter, 10).length >= 1;
}

/**
 * Hard guard: never re-ask RESOLVED / ANSWERED / OPEN / PARKED, and never
 * repeat the same CEO facilitate utterance (paraphrase included).
 */
export function guardRepeatedCeoQuestion(
  state: { ceoQuestions: CeoQuestion[]; messages: ChairLikeMessage[] },
  action: FacilitatorAction | string,
  chairUtterance: string | null,
  nominateReason: string,
  focusLabel?: string | null,
): {
  action: FacilitatorAction;
  chairUtterance: string | null;
  nominateReason: string;
  suppressed: boolean;
} {
  const asAction = (value: string): FacilitatorAction => {
    if (
      value === "nominate" ||
      value === "ask_proposer" ||
      value === "chair_nudge" ||
      value === "propose_end" ||
      value === "rare_interrupt"
    ) {
      return value;
    }
    return "nominate";
  };

  const utter = (chairUtterance ?? "").trim();
  if (!utter) {
    return {
      action: asAction(action),
      chairUtterance,
      nominateReason,
      suppressed: false,
    };
  }

  const advanceReason = (prefix: string) =>
    focusLabel
      ? `${prefix}。論点「${focusLabel}」を別視点で前進`
      : `${prefix}。新しい視点へ進む`;

  const blockRepeat = (reason: string) => ({
    action: "nominate" as const,
    chairUtterance: null as string | null,
    nominateReason: advanceReason(reason),
    suppressed: true,
  });

  if (findSimilarCeoQuestion(state.ceoQuestions, utter, ["RESOLVED"])) {
    return blockRepeat("RESOLVED質問の再掲を禁止");
  }
  if (findSimilarCeoQuestion(state.ceoQuestions, utter, ["ANSWERED"])) {
    return blockRepeat("ANSWERED質問の繰り返しを禁止");
  }
  if (findSimilarCeoQuestion(state.ceoQuestions, utter, ["OPEN"])) {
    return blockRepeat("OPEN質問の再掲を禁止（回答待ち／議論継続）");
  }
  if (findSimilarCeoQuestion(state.ceoQuestions, utter, ["PARKED"])) {
    return blockRepeat("PARKED質問の再掲を禁止");
  }

  const priorChairs = recentSimilarChairUtterances(state.messages, utter, 10);
  if (priorChairs.length >= 1) {
    return blockRepeat("同一司会発話の繰り返しを禁止");
  }

  if (
    (action === "ask_proposer" || action === "chair_nudge") &&
    findSimilarCeoQuestion(state.ceoQuestions, nominateReason, [
      "OPEN",
      "ANSWERED",
      "RESOLVED",
      "PARKED",
    ])
  ) {
    return blockRepeat("同趣旨の指名理由による再質問を禁止");
  }

  return {
    action: asAction(action),
    chairUtterance,
    nominateReason,
    suppressed: false,
  };
}

export function registerOpenCeoQuestion(
  ceoQuestions: CeoQuestion[],
  text: string,
): CeoQuestion[] {
  const trimmed = text.trim().slice(0, 120);
  if (!trimmed) return ceoQuestions;
  if (findSimilarCeoQuestion(ceoQuestions, trimmed)) return ceoQuestions;
  const next: CeoQuestion = {
    id: `q_${randomUUID().slice(0, 8)}`,
    text: trimmed,
    status: "OPEN",
    note: null,
  };
  return [...ceoQuestions, next].slice(-12);
}

/**
 * After a proposer reply: OPEN → ANSWERED (never force RESOLVED).
 */
export function markOpenQuestionsAnswered(
  ceoQuestions: CeoQuestion[],
  answerText: string,
): CeoQuestion[] {
  const note = answerText.trim().slice(0, 120) || null;
  let matched = false;
  let next = ceoQuestions.map((q) => {
    if (q.status !== "OPEN") return q;
    if (note && isSameCeoQuestion(q.text, note)) {
      matched = true;
      return {
        ...q,
        status: "ANSWERED" as const,
        note: note ?? q.note ?? null,
      };
    }
    return q;
  });
  // Any remaining OPEN still get ANSWERED — proposer spoke; stop re-asking
  next = next.map((q) =>
    q.status === "OPEN"
      ? {
          ...q,
          status: "ANSWERED" as const,
          note:
            note ??
            q.note ??
            (matched ? "企画者回答後に一括ANSWERED" : note),
        }
      : q,
  );
  return next;
}

/** After officers debate a CEO facilitate/ask, mark matching OPEN as ANSWERED. */
export function markOpenQuestionsAnsweredByOfficerProgress(
  ceoQuestions: CeoQuestion[],
  messages: ChairLikeMessage[],
  officerText: string,
): CeoQuestion[] {
  const lastChair = [...messages]
    .reverse()
    .find(
      (m) =>
        m.speakerType === "chair" &&
        m.kind !== "diagnostic" &&
        (m.messageType === "ask_proposer" ||
          m.messageType === "facilitate" ||
          m.messageType === "chair_nudge"),
    );
  const probe = lastChair?.text?.trim() || officerText.trim();
  if (!probe) return ceoQuestions;
  return ceoQuestions.map((q) => {
    if (q.status !== "OPEN") return q;
    if (
      isSameCeoQuestion(q.text, probe) ||
      similarityScore(q.text, officerText) >= 0.35
    ) {
      return {
        ...q,
        status: "ANSWERED" as const,
        note: "役員議論で前進（再質問禁止）",
      };
    }
    return q;
  });
}
