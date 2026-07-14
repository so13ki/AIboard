/**
 * Unit checks for AI Debugger (no network).
 */
import assert from "node:assert/strict";
import {
  analyzeDiscussionTurn,
  applySafeRepair,
  computeQualityScores,
  createDebuggerState,
  formatQualitySummary,
  hydrateFinding,
  mergeFindings,
  parseDebuggerState,
} from "../src/lib/meeting/ai-debugger";

function baseCtx(over: Partial<Parameters<typeof analyzeDiscussionTurn>[0]> = {}) {
  return {
    messages: [] as Parameters<typeof analyzeDiscussionTurn>[0]["messages"],
    activeTheme: "利益性",
    unresolvedIssues: ["Premium人数予測"],
    resolvedIssues: ["開発費"],
    openTopics: [
      {
        id: "dev",
        label: "開発費",
        status: "resolved" as const,
        note: null,
      },
      {
        id: "prem",
        label: "Premium人数予測",
        status: "unresolved" as const,
        note: null,
      },
    ],
    ceoQuestions: [
      {
        id: "q1",
        text: "追加費用と期待収益は？",
        status: "RESOLVED" as const,
        note: "十分",
      },
    ],
    decisions: ["紙運用"],
    rejectedItems: ["アプリ化"],
    currentVersion: 2,
    reviewLevel: "experiment" as const,
    ...over,
  };
}

{
  const dbg = createDebuggerState("PASSIVE");
  assert.equal(dbg.mode, "PASSIVE");
  assert.equal(parseDebuggerState(null).mode, "PASSIVE");
  assert.equal(parseDebuggerState({ mode: "ACTIVE" }).mode, "ACTIVE");
}

{
  // Repeat question
  const msgs = [
    {
      id: "1",
      speakerType: "chair",
      text: "追加費用と期待収益について教えてください？",
      messageType: "ask_proposer",
    },
    {
      id: "2",
      speakerType: "proposer",
      text: "実験なので費用はほぼゼロです",
    },
    {
      id: "3",
      speakerType: "chair",
      text: "追加費用と期待収益はどう見ていますか？",
      messageType: "ask_proposer",
    },
    {
      id: "4",
      speakerType: "chair",
      text: "追加費用と期待収益の見立てをください",
      messageType: "ask_proposer",
    },
  ];
  const findings = analyzeDiscussionTurn(
    baseCtx({ messages: msgs }),
    createDebuggerState("PASSIVE"),
  );
  assert.ok(
    findings.some((f) => f.ruleId === "repeat_question"),
    "should detect repeat questions",
  );
}

{
  // Rejected re-proposal
  const findings = analyzeDiscussionTurn(
    baseCtx({
      messages: [
        {
          id: "a",
          speakerType: "board_member",
          roleKey: "cto",
          text: "やっぱりアプリ化した方がいいと思います",
          moveType: "alternative",
        },
      ],
    }),
    createDebuggerState("PASSIVE"),
  );
  assert.ok(
    findings.some((f) => f.ruleId === "rereject_proposal"),
    "should detect rejected re-proposal",
  );
}

{
  // RESOLVED re-ask
  const findings = analyzeDiscussionTurn(
    baseCtx({
      messages: [
        {
          id: "c",
          speakerType: "chair",
          text: "追加費用と期待収益は？",
          messageType: "ask_proposer",
        },
      ],
    }),
    createDebuggerState("PASSIVE"),
  );
  assert.ok(
    findings.some((f) => f.ruleId === "status_transition"),
    "should detect RESOLVED re-ask",
  );
}

{
  // Experiment ROI demand
  const findings = analyzeDiscussionTurn(
    baseCtx({
      messages: [
        {
          id: "r",
          speakerType: "board_member",
          roleKey: "cfo",
          text: "ROIと回収期間を数値で示してください",
          moveType: "question",
        },
      ],
      reviewLevel: "experiment",
    }),
    createDebuggerState("PASSIVE"),
  );
  assert.ok(
    findings.some((f) => f.ruleId === "immature_roi_demand"),
    "should flag ROI demand in experiment",
  );
}

{
  // Bounce to asker
  const findings = analyzeDiscussionTurn(
    baseCtx({
      messages: [
        {
          id: "b1",
          speakerType: "board_member",
          roleKey: "cfo",
          text: "費用は大丈夫そう",
        },
      ],
      lastFacilitatorAction: "nominate",
      lastAskerRole: "cfo",
      lastRoutedRole: "cfo",
    }),
    createDebuggerState("PASSIVE"),
  );
  assert.ok(
    findings.some((f) => f.ruleId === "bounce_to_asker"),
    "should detect bounce to asker",
  );
}

{
  // OFF mode emits nothing
  const findings = analyzeDiscussionTurn(
    baseCtx({
      messages: [
        {
          id: "x",
          speakerType: "chair",
          text: "追加費用と期待収益について教えてください？",
          messageType: "ask_proposer",
        },
      ],
    }),
    createDebuggerState("OFF"),
  );
  assert.equal(findings.length, 0);
}

{
  // Safe repair: rebuild memory
  const state = {
    unresolvedIssues: ["開発費"],
    resolvedIssues: ["開発費"],
    openTopics: [
      {
        id: "dev",
        label: "開発費",
        status: "resolved" as const,
        note: null,
      },
    ],
    ceoQuestions: [],
    forcedNextRoleKey: null as string | null,
    forcedNominateReason: null as string | null,
    currentVersion: 2,
    activeGenerationId: "g1" as string | null,
    pendingSpeak: { x: 1 } as unknown,
  };
  const finding = hydrateFinding({
    id: "f1",
    ruleId: "memory_inconsistency",
    severity: "warning" as const,
    title: "不整合",
    detection: "test",
    expectedState: "",
    currentState: "",
    estimatedCauses: [],
    improvements: [],
    fixTargets: [],
    cursorPrompt: "",
    autoRepairLabel: null,
    causes: [],
    impact: "",
    recommendations: [],
    relatedMessageIds: [],
    relatedIssueIds: ["開発費"],
    relatedPlanVersion: 2,
    autoRepairable: true,
    repairKind: "rebuild_meeting_memory" as const,
    status: "open" as const,
    createdAt: new Date().toISOString(),
    fingerprint: "x",
  });
  const result = applySafeRepair({
    finding,
    action: "confirm",
    state,
    availableRoleKeys: ["cfo", "marketing"],
    recentRoleKeys: ["cfo"],
  });
  assert.ok(result.note.includes("再同期"));
  assert.ok(!state.unresolvedIssues.includes("開発費") || state.resolvedIssues.includes("開発費"));
}

{
  const dbg = createDebuggerState("PASSIVE");
  const added = mergeFindings(dbg, [
    hydrateFinding({
      id: "1",
      ruleId: "repeat_question",
      severity: "warning",
      title: "t",
      detection: "d",
      expectedState: "",
      currentState: "",
      estimatedCauses: [],
      improvements: [],
      fixTargets: [],
      cursorPrompt: "",
      autoRepairLabel: null,
      causes: [],
      impact: "",
      recommendations: [],
      relatedMessageIds: [],
      relatedIssueIds: [],
      relatedPlanVersion: 1,
      autoRepairable: true,
      repairKind: "block_repeat_question",
      status: "open",
      createdAt: new Date().toISOString(),
      fingerprint: "fp1",
    }),
  ]);
  assert.equal(added.length, 1);
  assert.ok(added[0]!.estimatedCauses.length > 0);
  assert.ok(added[0]!.cursorPrompt.includes("Cursor修正プロンプト"));
  assert.ok(added[0]!.improvements.length > 0);
  const again = mergeFindings(dbg, added);
  assert.equal(again.length, 0, "fingerprint suppresses duplicates");
}

{
  const findings = analyzeDiscussionTurn(
    baseCtx({
      messages: [
        {
          id: "r1",
          speakerType: "board_member",
          roleKey: "cfo",
          text: "ブランドイメージだけが心配です",
          moveType: "expand",
        },
      ],
    }),
    createDebuggerState("PASSIVE"),
  );
  const role = findings.find((f) => f.ruleId === "role_mismatch");
  if (role) {
    assert.ok(role.fixTargets.includes("Role Prompt"));
    assert.ok(role.cursorPrompt.includes("Role Prompt"));
    assert.equal(role.autoRepairable, false);
  }
}

{
  const scores = computeQualityScores(baseCtx(), createDebuggerState());
  const summary = formatQualitySummary(scores);
  assert.ok(summary.includes("前進率"));
  assert.ok(summary.includes("重複率"));
}

console.log("ai-debugger checks passed");
