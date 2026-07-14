import assert from "node:assert/strict";
import {
  dedupeStrings,
  isSimilarPoint,
  isValueCuttingAlternative,
  isWeakRebuttalText,
  reduceReviewOverlap,
} from "../src/lib/ai/dedupe";
import {
  agendaSchema,
  ceoEditSchema,
  discussionBriefSummarySchema,
  discussionFacilitatorSchema,
  discussionUtteranceSchema,
  initialReviewSchema,
  interimSchema,
  issueDebateTurnSchema,
  issueExtractionSchema,
  planUpdateDetectionSchema,
  productCoachSchema,
  qualityBalancerSchema,
  rebuttalSchema,
} from "../src/lib/ai/schemas";
import { assignRebuttalTargets } from "../src/lib/meeting/assign-rebuttal-targets";

function testDedupe() {
  assert.equal(
    isSimilarPoint("達成条件を具体化してほしい", "各ステージの判定基準は何か"),
    true,
  );
  assert.equal(
    isSimilarPoint("紙で小規模試行する", "独立した収益モデルを作れ"),
    false,
  );

  const deduped = dedupeStrings([
    "達成条件が不明瞭",
    "評価基準が不明瞭",
    "現場負荷が増える",
  ]);
  assert.equal(deduped.length, 2);

  const reduced = reduceReviewOverlap(
    {
      biggestConcern: "達成条件が不足している",
      questions: ["判定基準は何か", "誰が認定するのか"],
      revisionProposals: ["紙運用から始める"],
    },
    [
      {
        biggestConcern: "評価基準が不明瞭",
        questions: ["進捗条件を明示してほしい"],
        revisionProposals: [],
      },
    ],
  );
  assert.ok(reduced.questions.includes("誰が認定するのか"));
  assert.ok(!reduced.questions.some((q) => q.includes("判定基準")));
}

function testAssignment() {
  const candidates = [
    {
      memberId: "cfo",
      memberTitle: "CFO",
      roleKey: "cfo",
      stance: "conditional",
      biggestConcern: "予算上限",
      revisionProposals: ["紙で試す"],
      priorities: ["営業利益"],
    },
    {
      memberId: "mkt",
      memberTitle: "マーケティング",
      roleKey: "marketing",
      stance: "approve",
      biggestConcern: "訴求",
      revisionProposals: ["説明会"],
      priorities: ["顧客獲得"],
    },
    {
      memberId: "ops",
      memberTitle: "現場",
      roleKey: "operations",
      stance: "reject",
      biggestConcern: "負荷",
      revisionProposals: ["マニュアル"],
      priorities: ["現場負荷"],
    },
    {
      memberId: "cto",
      memberTitle: "CTO",
      roleKey: "cto",
      stance: "conditional",
      biggestConcern: "システム化不要",
      revisionProposals: ["紙運用"],
      priorities: ["開発工数"],
    },
    {
      memberId: "cust",
      memberTitle: "顧客代表",
      roleKey: "customer",
      stance: "hold",
      biggestConcern: "劣等感",
      revisionProposals: ["任意参加"],
      priorities: ["納得感"],
    },
    {
      memberId: "red",
      memberTitle: "レッドチーム",
      roleKey: "redteam",
      stance: "reject",
      biggestConcern: "形骸化",
      revisionProposals: ["最悪ケース検証"],
      priorities: ["最悪ケース"],
    },
  ];

  const map = assignRebuttalTargets(candidates, 2);
  assert.equal(map.size, candidates.length);

  const targetCounts = new Map<string, number>();
  for (const targetId of map.values()) {
    targetCounts.set(targetId, (targetCounts.get(targetId) ?? 0) + 1);
  }
  for (const [id, count] of targetCounts) {
    assert.ok(count <= 2, `${id} targeted ${count} times`);
  }
  assert.ok(targetCounts.size >= 3, "targets should be diversified");
}

function testSchemas() {
  const agenda = agendaSchema.parse({
    agenda: "テスト議題",
    problemsToSolve: ["課題"],
    assumptions: ["前提"],
    constraints: ["制約"],
    decisionCriteria: ["基準"],
    missingInformation: ["不足"],
    reviewLevel: "experiment",
    reviewLevelReason: "少額で撤回可能",
    coreConcept: {
      summary: "初心者向けチャレンジシートを500円で販売し継続率を上げる",
      pillars: ["初心者向け", "紙媒体", "500円で販売", "継続率向上"],
    },
  });
  assert.equal(agenda.reviewLevel, "experiment");
  assert.equal(agenda.coreConcept.pillars.length, 4);

  const review = initialReviewSchema.parse({
    currentProposalVote: "reject",
    revisedProposalVote: "conditional",
    coreConceptPreserved: false,
    coreConceptChangedReason: "無料併設は500円販売の核心を変える",
    decisionRationale:
      "現行の有料販売案は価格インセンティブが不明瞭。無料併設は別企画になるため現行案は反対。任意購入・人数限定なら再提出後に条件付き検討可。",
    approvalConditions: [],
    requiredRevisions: ["任意購入にする", "20名限定", "4週間検証"],
    resubmissionRequired: true,
    positives: ["紙で小さく試せる"],
    concerns: [
      {
        concern: "有料販売の必然性",
        reason: "価格インセンティブが顧客行動と結びついていない",
      },
    ],
    improvements: [
      {
        proposal: "任意購入で検証する",
        expectedEffect: "核心を保ったまま価格感度を測れる",
        preservesCoreConcept: true,
      },
    ],
    questions: ["誰が販売するか"],
  });
  assert.equal(review.stance, "reject");
  assert.equal(review.currentProposalVote, "reject");
  assert.equal(review.resubmissionRequired, true);
  assert.equal(review.biggestConcern, "有料販売の必然性");

  const normalized = initialReviewSchema.parse({
    currentProposalVote: "conditional",
    revisedProposalVote: null,
    coreConceptPreserved: false,
    coreConceptChangedReason: "無料化",
    decisionRationale: "改善案があるので条件付き",
    approvalConditions: ["無料版を併設する"],
    requiredRevisions: [],
    resubmissionRequired: false,
    positives: ["x"],
    concerns: [{ concern: "y", reason: "z" }],
    improvements: [
      {
        proposal: "a",
        expectedEffect: "b",
        preservesCoreConcept: false,
      },
    ],
    questions: [],
  });
  assert.equal(normalized.currentProposalVote, "reject");
  assert.equal(normalized.resubmissionRequired, true);
  assert.ok(normalized.requiredRevisions.includes("無料版を併設する"));

  const rebuttal = rebuttalSchema.parse({
    referencedMemberTitle: "CFO",
    triageType: "over_quality",
    importantPoint: "独立収益モデルが必要",
    triageReason: "低コスト施策に独立収益を要求するのは過剰品質",
    recommendation: "予算上限と成功条件だけ先に決め、紙運用で検証する",
    agreeingPoints: ["損失上限は確認すべき"],
    disagreeingPoints: ["独立収益モデル必須という前提は誤り"],
    overlookedPoints: ["既存顧客の解約抑制効果"],
    decisionChanged: true,
    previousDecision: "hold",
    currentDecision: "conditional",
    changedCondition: "独立収益の提出を条件から外し、予算上限と試行KPIを条件にした",
    questionsForProposer: ["予算上限はいくらか"],
  });
  assert.equal(rebuttal.triageType, "over_quality");
  assert.equal(rebuttal.currentStance, "conditional");
  assert.equal(rebuttal.decisionChanged, true);

  assert.equal(isWeakRebuttalText("相手の指摘は妥当で重要である"), true);
  assert.equal(isWeakRebuttalText("〜だけでなく、現場視点も重要"), true);
  assert.equal(
    isWeakRebuttalText(
      "相手の前提は誤っている。独立収益モデル必須ではなく、試行後に判断すべき",
    ),
    false,
  );
  assert.equal(
    isValueCuttingAlternative("競技志向でない子どもへの配慮を最小限にする"),
    true,
  );

  const interim = interimSchema.parse({
    consensusPoints: ["理念には整合"],
    disputedPoints: ["システム化の要否"],
    fatalConcerns: ["劣等感の発生"],
    questionsBeforeVote: [
      {
        question: "認定者は誰か",
        whyNeeded: "現場負荷と摩擦の見積に必要",
        affectedMembers: ["現場責任者", "顧客代表"],
        canValidateInPilot: false,
      },
    ],
    itemsToValidateInPilot: ["保護者の受け止め"],
    chairRecommendation: "pilot",
    chairRecommendationReason: "紙で小さく試せる",
  });
  assert.equal(interim.chairRecommendation, "pilot");

  const coach = productCoachSchema.parse({
    reviewSummary: "財務と現場の懸念が中心。訴求は概ね良い。",
    priorityTop3: ["認定者を明確化", "紙運用で試す", "KPIを1つに絞る"],
    fixNow: ["認定者を1名に固定する"],
    deferLater: ["Web化"],
    adviceToProposer: "まず運用を単純化し、価値仮説だけ残してください。",
    revisedDraft: {
      title: "紙運用パイロット",
      summary: "1クラスで紙の4ステージを試験する",
      keyChanges: ["認定者固定"],
      openQuestions: ["保護者説明の時間"],
    },
  });
  assert.equal(coach.priorityTop3.length, 3);

  const issues = issueExtractionSchema.parse({
    issues: [
      {
        title: "無料と有料の提供順",
        conflictSummary: "同時提供か期間分離かで検証設計が変わる",
        options: [
          { key: "A", label: "無料版と有料版を同時提供する" },
          { key: "B", label: "期間を分けて一種類ずつ試す" },
        ],
        participantRoleKeys: ["cfo", "marketing"],
        whyTheseParticipants: "価格と訴求の対立だから",
      },
    ],
  });
  assert.equal(issues.issues[0].options.length, 2);

  const turn = issueDebateTurnSchema.parse({
    turnType: "rebuttal",
    claim: "同時提供は比較が濁るので期間分離が良い",
    counterToOpponent: "同時提供はチャネル混乱を起こし測定不能になる",
    alternative: "2週間ずつ順に試す",
    judgmentCondition: "比較可能なKPIが取れること",
    preferredOptionKey: "B",
    voteChanged: false,
    conditionChanged: true,
    previousVote: "conditional",
    currentVote: "conditional",
    previousCondition: "任意購入",
    currentCondition: "2週間分離試行",
  });
  assert.equal(turn.voteChanged, false);
  assert.equal(turn.conditionChanged, true);

  const balancer = qualityBalancerSchema.parse({
    keptChoices: ["期間を分けて一種類ずつ試す"],
    cutItems: [
      { item: "同時にアプリ化", reason: "mvp_unnecessary" },
    ],
    simplyNote: "紙検証の範囲に戻す",
  });
  assert.equal(balancer.cutItems[0].reason, "mvp_unnecessary");

  const fac = discussionFacilitatorSchema.parse({
    action: "nominate",
    nextSpeakerRoleKey: "marketing",
    nominateReason: "CFOの利益論に顧客獲得側から返す番",
    chairUtterance: null,
    endReason: null,
    openTopics: [
      { id: "price", label: "価格設定", status: "discussing", note: null },
      { id: "ops", label: "現場運用", status: "unresolved", note: null },
      { id: "brand", label: "ブランド影響", status: "resolved", note: "懸念は小さい" },
      { id: "kpi", label: "KPI", status: "unresolved", note: null },
      { id: "staff", label: "スタッフ教育", status: "unresolved", note: null },
      { id: "parent", label: "保護者説明", status: "unresolved", note: null },
    ],
    priorityIssues: ["価格設定", "現場運用", "スタッフ教育", "KPI"],
    ceoQuestions: [
      { id: "q1", text: "価格は無料から試す？", status: "RESOLVED", note: "無料パイロットで合意" },
      { id: "q2", text: "スタッフ教育はどうする？", status: "OPEN", note: null },
      { id: "q3", text: "KPIは何を見る？", status: "ANSWERED", note: "継続率を見る" },
    ],
    routingKind: "brand",
    activeTheme: "利益性",
    themeAction: "continue",
    unresolvedIssues: ["Premium人数予測", "収益モデル", "現場運用", "スタッフ教育", "KPI"],
    resolvedIssues: ["開発費", "運用負荷"],
    decisions: ["紙運用", "マニュアルは作らない"],
    rejectedItems: ["アプリ化", "詳細マニュアル作成"],
    repetitionDetected: false,
  });
  assert.equal(fac.action, "nominate");
  assert.equal(fac.routingKind, "brand");
  assert.equal(fac.activeTheme, "利益性");
  assert.equal(fac.themeAction, "continue");
  assert.equal(fac.unresolvedIssues.length, 5);
  assert.equal(fac.resolvedIssues[0], "開発費");
  assert.equal(fac.openTopics.filter((t) => t.status !== "resolved").length, 5);
  assert.equal(fac.priorityIssues.length, 4);
  assert.equal(fac.ceoQuestions.filter((q) => q.status === "RESOLVED").length, 1);
  assert.equal(fac.decisions.length, 2);
  assert.equal(fac.rejectedItems[0], "アプリ化");

  // Legacy themeAction aliases still parse
  const legacyClose = discussionFacilitatorSchema.parse({
    action: "nominate",
    nextSpeakerRoleKey: "cfo",
    nominateReason: "次テーマへ",
    chairUtterance: "利益性については概ね整理できました。",
    endReason: null,
    openTopics: [
      { id: "price", label: "価格設定", status: "resolved", note: null },
    ],
    priorityIssues: [],
    activeTheme: "顧客体験",
    themeAction: "close_and_advance",
    unresolvedIssues: ["顧客体験"],
    resolvedIssues: ["利益性"],
    decisions: [],
    rejectedItems: [],
    repetitionDetected: false,
  });
  assert.equal(legacyClose.themeAction, "close_theme");
  assert.equal(legacyClose.activeTheme, "顧客体験");

  // Soft-cap: excess openIssues / priorityIssues truncate instead of failing
  const brief = discussionBriefSummarySchema.parse({
    currentPlan: "紙運用パイロット",
    agreedPoints: ["紙運用", "マニュアルなし"],
    openIssues: [
      "価格",
      "KPI",
      "スタッフ教育",
      "保護者説明",
      "時間帯",
      "対象学年",
      "特典設計",
      "告知チャネル",
      "効果測定",
      "次回レビュー",
      "これは切られる11件目",
    ],
    priorityIssues: ["価格", "KPI", "スタッフ教育", "保護者説明", "余剰"],
    nextQuestion: "価格は無料から試す？",
  });
  assert.equal(brief.openIssues.length, 10);
  assert.equal(brief.priorityIssues.length, 4);
  assert.equal(brief.priorityIssues[0], "価格");

  const utter = discussionUtteranceSchema.parse({
    text: "利益より認知では？無料で広げてから課金でもよくない？",
    addressTo: "officer",
    addressRoleKey: "cfo",
    moveType: "counter",
  });
  assert.equal(utter.moveType, "counter");

  const accept = discussionUtteranceSchema.parse({
    text: "なるほど、既存判定なら運用は増えない。次はラウンジ混雑時の動線が気になる。",
    addressTo: "all",
    addressRoleKey: null,
    moveType: "accept",
  });
  assert.equal(accept.moveType, "accept");

  const planUpdate = planUpdateDetectionSchema.parse({
    planUpdated: true,
    changes: ["無料版を追加", "価格を300円へ変更"],
    updatedPlanSummary: "紙運用のパイロットに無料版を併設し、有料は300円。",
    chairNote: "これ以降は Version2 前提でお願いします。",
  });
  assert.equal(planUpdate.planUpdated, true);
  assert.equal(planUpdate.changes.length, 2);

  const planUnchanged = planUpdateDetectionSchema.parse({
    planUpdated: false,
    changes: [],
    updatedPlanSummary: "",
    chairNote: "",
  });
  assert.equal(planUnchanged.planUpdated, false);
  assert.equal(planUnchanged.updatedPlanSummary, null);
  assert.equal(planUnchanged.chairNote, null);

  const planNullSummary = planUpdateDetectionSchema.parse({
    planUpdated: true,
    changes: ["保証金方式へ変更"],
    updatedPlanSummary: null,
    chairNote: null,
  });
  assert.equal(planNullSummary.updatedPlanSummary, null);
}

function testCeoEditSchema() {
  const edit = ceoEditSchema.parse({
    coreValue: "初心者が迷わず次回来館すること",
    adoptedImprovements: [
      {
        proposal: "認定はコーチ1名が兼務し紙で記録する",
        reason: "MVPの本質である成長可視化に直結し運用が単純",
        sourceHint: "現場責任者",
      },
    ],
    heldImprovements: [
      {
        proposal: "保護者向け月次レポート",
        reason: "価値はあるが今回はやらない",
        sourceHint: "マーケティング",
      },
    ],
    deferredImprovements: [
      {
        proposal: "Web化",
        reason: "MVPの目的に直接寄与しない",
        deferCategory: "future_phase",
      },
      {
        proposal: "ポイント制度",
        reason: "複雑さを増やしM(Simply)に反する",
        deferCategory: "against_simply",
      },
    ],
    editComment: "価値を保ちつつ工程を減らす編集にした。",
    futureBacklog: ["Web化", "AI推薦", "ランキング", "ポイント制度"],
    editedPlan: {
      title: "キッズ4ステージ紙運用パイロット",
      summary: "1クラスで紙の4ステージを試験し、次回来館の動機を検証する",
      scope: "紙カード、簡易認定、保護者向け1枚説明",
      outOfScope: "Web、AI、ランキング、ポイント",
      successCriteria: ["次回来館率が下がらない", "説明時間が増えない"],
      operations: "担当コーチが週1回まとめて認定し、保護者説明は既存口頭＋1枚紙",
    },
    simplyCheck: {
      complexityReduced: true,
      valuePreserved: true,
      explanation: "役割を兼務に整理し、機能追加ではなく運用単純化で価値を維持",
    },
  });
  assert.equal(edit.adoptedImprovements.length, 1);
  assert.equal(edit.heldImprovements.length, 1);
  assert.equal(edit.deferredImprovements.length, 2);
  assert.ok(edit.futureBacklog.includes("Web化"));
}

testDedupe();
testAssignment();
testSchemas();
testCeoEditSchema();
console.log("ai-quality checks passed");
