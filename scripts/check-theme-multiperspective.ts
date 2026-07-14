/**
 * Theme multi-perspective: Theme must not lock to a single role (esp. profit→CFO).
 */
import assert from "node:assert/strict";
import {
  detectThemeMonopoly,
  isProfitLikeTheme,
  pickPerspectiveOfficer,
  PROFIT_PERSPECTIVE_ORDER,
} from "../src/lib/meeting/discussion-themes";
import {
  analyzeDiscussionTurn,
  createDebuggerState,
  hydrateFinding,
} from "../src/lib/meeting/ai-debugger";

assert.equal(isProfitLikeTheme("利益・ROI"), true);
assert.equal(isProfitLikeTheme("利益性"), true);
assert.equal(isProfitLikeTheme("顧客体験"), false);

{
  const available = [
    "cfo",
    "marketing",
    "customer",
    "cto",
    "operations",
    "redteam",
    "quality_balancer",
  ];
  // After CFO spoke, next must not be CFO again
  const next = pickPerspectiveOfficer({
    availableRoleKeys: available,
    recentRoleKeys: ["cfo", "cfo"],
    avoidRoleKey: "cfo",
    themeLabel: "利益・ROI",
    banRoleKey: "cfo",
  });
  assert.ok(next);
  assert.notEqual(next, "cfo");
  assert.ok(
    (PROFIT_PERSPECTIVE_ORDER as readonly string[]).includes(next!),
    "should pick a profit-perspective role",
  );
}

{
  // Rotate through missing perspectives
  const available = ["cfo", "marketing", "customer", "cto", "operations"];
  const first = pickPerspectiveOfficer({
    availableRoleKeys: available,
    recentRoleKeys: [],
    themeLabel: "利益性",
  });
  // With empty recent, prefer first missing in order → cfo is ok as first voice
  assert.ok(first);

  const second = pickPerspectiveOfficer({
    availableRoleKeys: available,
    recentRoleKeys: ["cfo"],
    avoidRoleKey: "cfo",
    themeLabel: "利益性",
  });
  assert.notEqual(second, "cfo");
  assert.ok(["marketing", "customer", "cto", "operations"].includes(second!));
}

{
  const mono = detectThemeMonopoly({
    recentRoleKeys: ["cfo", "cfo", "cfo", "marketing"],
    threshold: 3,
  });
  assert.equal(mono.monopolized, true);
  assert.equal(mono.roleKey, "cfo");
  assert.ok(mono.count >= 3);
}

{
  // Debugger detects Theme monopoly at 3
  const findings = analyzeDiscussionTurn(
    {
      messages: [
        { id: "1", speakerType: "board_member", roleKey: "cfo", text: "ROIは？" },
        { id: "2", speakerType: "board_member", roleKey: "cfo", text: "回収は？" },
        { id: "3", speakerType: "board_member", roleKey: "cfo", text: "損失上限は？" },
      ],
      activeTheme: "利益・ROI",
      unresolvedIssues: ["収益モデル"],
      resolvedIssues: [],
      openTopics: [],
      ceoQuestions: [],
      decisions: [],
      rejectedItems: [],
      currentVersion: 1,
      reviewLevel: "experiment",
    },
    createDebuggerState("PASSIVE"),
  );
  assert.ok(
    findings.some((f) => f.ruleId === "over_nominate"),
    "should detect theme monopoly",
  );
  const f = hydrateFinding(findings.find((x) => x.ruleId === "over_nominate")!);
  assert.equal(f.autoRepairable, true);
  assert.equal(f.repairKind, "reselect_next_speaker");
}

{
  // Experiment ROI demand → park_numeric repairable
  const findings = analyzeDiscussionTurn(
    {
      messages: [
        {
          id: "r",
          speakerType: "board_member",
          roleKey: "cfo",
          text: "ROIと回収期間を数値で示してください",
          moveType: "question",
        },
      ],
      activeTheme: "利益性",
      unresolvedIssues: [],
      resolvedIssues: [],
      openTopics: [],
      ceoQuestions: [
        { id: "q1", text: "ROIはいくら？", status: "OPEN", note: null },
      ],
      decisions: [],
      rejectedItems: [],
      currentVersion: 1,
      reviewLevel: "experiment",
    },
    createDebuggerState("PASSIVE"),
  );
  const roi = findings.find((f) => f.ruleId === "immature_roi_demand");
  assert.ok(roi);
  assert.equal(roi!.repairKind, "park_numeric_questions");
}

console.log("theme multi-perspective checks passed");
