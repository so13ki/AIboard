/**
 * CEO question repeat guard: block paraphrased OPEN/ANSWERED/RESOLVED re-asks
 * and mark answered after proposer / officer progress.
 */
import assert from "node:assert/strict";
import {
  guardRepeatedCeoQuestion,
  isRepeatedCeoChairUtterance,
  isSameCeoQuestion,
  markOpenQuestionsAnswered,
  markOpenQuestionsAnsweredByOfficerProgress,
  registerOpenCeoQuestion,
} from "../src/lib/meeting/ceo-questions";
import type { CeoQuestion } from "../src/lib/ai/schemas";

const REPEAT =
  "具体的な例外ケースの洗い出しについて、反対役・レッドチームの視点で議論を進めましょう";
const PARAPHRASE =
  "例外ケースの洗い出しを、レッドチームの視点で進めましょう";

assert.ok(isSameCeoQuestion(REPEAT, PARAPHRASE), "paraphrase should match");

{
  const board: CeoQuestion[] = [
    {
      id: "q1",
      text: REPEAT,
      status: "OPEN",
      note: null,
    },
  ];
  const guarded = guardRepeatedCeoQuestion(
    { ceoQuestions: board, messages: [] },
    "nominate",
    PARAPHRASE,
    "例外ケース",
  );
  assert.equal(guarded.suppressed, true);
  assert.equal(guarded.action, "nominate");
  assert.equal(guarded.chairUtterance, null);
}

for (const status of ["ANSWERED", "RESOLVED", "PARKED"] as const) {
  const board: CeoQuestion[] = [
    { id: "q1", text: REPEAT, status, note: "済" },
  ];
  const guarded = guardRepeatedCeoQuestion(
    { ceoQuestions: board, messages: [] },
    "ask_proposer",
    PARAPHRASE,
    "再質問",
  );
  assert.equal(guarded.suppressed, true, `should block ${status}`);
  assert.equal(guarded.chairUtterance, null);
}

{
  // Recent chair facilitate alone is enough to block
  const guarded = guardRepeatedCeoQuestion(
    {
      ceoQuestions: [],
      messages: [
        {
          speakerType: "chair",
          kind: "chat",
          messageType: "facilitate",
          text: REPEAT,
        },
      ],
    },
    "nominate",
    PARAPHRASE,
    "続き",
  );
  assert.equal(guarded.suppressed, true);
}

{
  let board = registerOpenCeoQuestion([], REPEAT);
  assert.equal(board.length, 1);
  assert.equal(board[0]!.status, "OPEN");
  board = markOpenQuestionsAnswered(board, "例外は季節ピークと欠員時です");
  assert.equal(board[0]!.status, "ANSWERED");
  assert.ok(
    isRepeatedCeoChairUtterance({
      ceoQuestions: board,
      messages: [],
      text: PARAPHRASE,
    }),
  );
}

{
  let board = registerOpenCeoQuestion([], REPEAT);
  board = markOpenQuestionsAnsweredByOfficerProgress(
    board,
    [
      {
        speakerType: "chair",
        kind: "chat",
        messageType: "facilitate",
        text: REPEAT,
      },
    ],
    "レッドチームとして欠員時の例外を整理します",
  );
  assert.equal(board[0]!.status, "ANSWERED");
  // Never force RESOLVED
  assert.notEqual(board[0]!.status, "RESOLVED");
}

console.log("check-ceo-question-repeat: ok");
