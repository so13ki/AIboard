import {
  CEO_EDITOR_RULES,
  CHAIR_FACILITATOR_RULES,
  COMMON_OFFICER_RULES,
  DISCUSSION_RULES,
  formatReviewLevelGuidance,
  getRoleFocus,
  GROWTH_SYSTEM_PHILOSOPHY,
  MUTUAL_REVIEW_RULES,
  PRODUCT_COACH_RULES,
  QUALITY_BALANCER_RULES,
  QRIMO_SIMPLY_RULES,
  QRIMO_VALUES,
  STANCE_DECISION_RULES,
  type ReviewLevel,
} from "./role-focus";

export type CompanyContext = {
  name: string;
  philosophy: string;
  vision: string;
  values: string[];
  culture: string;
  principles: string;
  prohibitions: string;
};

export type MemberContext = {
  title: string;
  roleKey: string;
  description: string;
  priorities: string[];
  checkItems: string[] | null;
  behaviorRules: string[];
  isChairperson: boolean;
};

export type ProjectContext = {
  title: string;
  background: string;
  problem: string;
  content: string;
  targetCustomer: string;
  expectedEffect: string;
  estimatedCost: string;
  constraints: string;
  discussionPoints: string;
};

export function formatCompany(company: CompanyContext): string {
  return [
    `会社名: ${company.name}`,
    `経営理念: ${company.philosophy}`,
    `ビジョン: ${company.vision}`,
    `バリュー:\n${company.values.map((v) => `- ${v}`).join("\n")}`,
    `組織文化: ${company.culture}`,
    `絶対に守る原則: ${company.principles}`,
    `禁止事項: ${company.prohibitions}`,
  ].join("\n");
}

export function formatProject(project: ProjectContext): string {
  return [
    `企画名: ${project.title}`,
    `背景: ${project.background}`,
    `解決したい課題: ${project.problem}`,
    `企画内容: ${project.content}`,
    `対象顧客: ${project.targetCustomer}`,
    `期待する効果: ${project.expectedEffect}`,
    `想定コスト: ${project.estimatedCost}`,
    `制約: ${project.constraints}`,
    `特に議論したい点: ${project.discussionPoints}`,
  ].join("\n");
}

export function formatMember(member: MemberContext): string {
  const lines = [
    `役職: ${member.title}`,
    `役割キー: ${member.roleKey}`,
    `説明: ${member.description}`,
    `最優先事項/KPI:\n${member.priorities.map((p) => `- ${p}`).join("\n")}`,
  ];
  if (member.checkItems?.length) {
    lines.push(
      `必ず確認すること:\n${member.checkItems.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  lines.push(
    `行動ルール:\n${member.behaviorRules.map((r) => `- ${r}`).join("\n")}`,
  );
  lines.push(getRoleFocus(member.roleKey));
  lines.push(GROWTH_SYSTEM_PHILOSOPHY);
  lines.push(QRIMO_VALUES);
  lines.push(COMMON_OFFICER_RULES);
  lines.push(STANCE_DECISION_RULES);
  if (member.roleKey === "product_coach") {
    lines.push(PRODUCT_COACH_RULES);
  }
  if (member.roleKey === "quality_balancer") {
    lines.push(QUALITY_BALANCER_RULES);
    lines.push(QRIMO_SIMPLY_RULES);
  }
  if (member.isChairperson || member.roleKey === "ceo") {
    lines.push(QRIMO_SIMPLY_RULES);
    lines.push(CEO_EDITOR_RULES);
    lines.push(CHAIR_FACILITATOR_RULES);
  }
  return lines.join("\n");
}

function formatPriorReviews(priorReviews: unknown[]): string {
  if (!priorReviews.length) {
    return "（まだ他役員のレビューはありません）";
  }
  return JSON.stringify(priorReviews, null, 2);
}

function coreFromAgenda(agenda: unknown): unknown {
  if (agenda && typeof agenda === "object" && "coreConcept" in agenda) {
    return (agenda as { coreConcept: unknown }).coreConcept;
  }
  return null;
}

export const prompts = {
  agendaUser(company: CompanyContext, project: ProjectContext): string {
    return [
      "あなたはCEO・編集者です。企画育成レビューの開始にあたり論点を整理してください。",
      "採点ではなく、育てるための論点整理です。",
      "",
      QRIMO_VALUES,
      "",
      "審査レベルと企画の核心(coreConcept)を抽出してください。",
      "",
      "## 会社設定",
      formatCompany(company),
      "",
      "## 企画",
      formatProject(project),
      "",
      "次のJSON:",
      '{ "agenda": string, "problemsToSolve": string[], "assumptions": string[], "constraints": string[], "decisionCriteria": string[], "missingInformation": string[], "reviewLevel": "experiment"|"standard"|"strategic", "reviewLevelReason": string, "coreConcept": { "summary": string, "pillars": string[] } }',
    ].join("\n");
  },

  initialReviewUser(
    company: CompanyContext,
    project: ProjectContext,
    member: MemberContext,
    agenda: unknown,
    reviewLevel: ReviewLevel,
    priorReviews: unknown[],
  ): string {
    return [
      "役員レビューです。採点ではなく、企画を育てる視点を提供してください。",
      "必ず: 良い点(最大3) / 懸念+理由(最大2) / 改善案+期待効果(最大2)。質問は最大2件。",
      "",
      "## 審査レベル",
      formatReviewLevelGuidance(reviewLevel),
      "",
      "## 企画の核心",
      JSON.stringify(coreFromAgenda(agenda), null, 2),
      "",
      "## あなたの役割",
      formatMember(member),
      "",
      "## 会社設定",
      formatCompany(company),
      "",
      "## 企画",
      formatProject(project),
      "",
      "## 論点整理",
      JSON.stringify(agenda, null, 2),
      "",
      "## 既出レビュー（重複禁止）",
      formatPriorReviews(priorReviews),
      "",
      "参考票も付与すること（currentProposalVote / revisedProposalVote）。採決は目的ではない。",
      "",
      "JSON:",
      '{ "positives": string[], "concerns": [{ "concern": string, "reason": string }], "improvements": [{ "proposal": string, "expectedEffect": string, "preservesCoreConcept": boolean }], "questions": string[], "currentProposalVote": "approve"|"conditional"|"reject"|"hold", "revisedProposalVote": "approve"|"conditional"|"reject"|"hold"|null, "coreConceptPreserved": boolean, "coreConceptChangedReason": string|null, "decisionRationale": string, "approvalConditions": string[], "requiredRevisions": string[], "resubmissionRequired": boolean }',
    ].join("\n");
  },

  rebuttalUser(
    company: CompanyContext,
    project: ProjectContext,
    member: MemberContext,
    assignedTarget: {
      memberTitle: string;
      roleKey: string;
      stance: string;
      content: unknown;
    },
    otherReviews: unknown[],
    reviewLevel: ReviewLevel,
    previousDecision: string,
  ): string {
    // Legacy path retained for scripts; prefer issueDebateTurnUser.
    return [
      "互換用: 相互レビューは論点カード方式へ移行済み。短い整理のみ。",
      MUTUAL_REVIEW_RULES,
      `対象: ${assignedTarget.memberTitle}`,
      JSON.stringify(assignedTarget.content, null, 2),
      formatReviewLevelGuidance(reviewLevel),
      formatMember(member),
      formatCompany(company),
      formatProject(project),
      JSON.stringify(otherReviews, null, 2),
      `previousDecision=${previousDecision}`,
      "JSON:",
      '{ "referencedMemberTitle": string, "triageType": string, "importantPoint": string, "triageReason": string, "recommendation": string, "agreeingPoints": string[], "disagreeingPoints": string[], "overlookedPoints": string[], "decisionChanged": boolean, "previousDecision": string, "currentDecision": string, "changedCondition": string, "questionsForProposer": string[] }',
    ].join("\n");
  },

  issueExtractionUser(
    company: CompanyContext,
    project: ProjectContext,
    reviews: unknown[],
    availableRoleKeys: string[],
    reviewLevel: ReviewLevel,
  ): string {
    return [
      "Step2の役員レビューから、対立またはトレードオフがある論点を最大3件抽出してください。",
      "全員再コメントは不要。論点ごとに具体的選択肢を2つ以上、関係役員roleKeyをちょうど2名選ぶ。",
      "",
      MUTUAL_REVIEW_RULES,
      QRIMO_SIMPLY_RULES,
      "",
      "期待されやすい論点例（該当すれば優先）:",
      "- 無料版と有料版を同時提供するか、期間を分けて一種類ずつ試すか",
      "- 紙だけで検証するか、簡易デジタル記録を併用するか",
      "- 購入率を重視するか、30日再来店率を重視するか",
      "",
      `選べる roleKey: ${availableRoleKeys.join(", ")}`,
      "",
      "## 審査レベル",
      formatReviewLevelGuidance(reviewLevel),
      "",
      "## 会社",
      formatCompany(company),
      "",
      "## 企画",
      formatProject(project),
      "",
      "## Step2 役員レビュー",
      JSON.stringify(reviews, null, 2),
      "",
      "JSON:",
      '{ "issues": [{ "title": string, "conflictSummary": string, "options": [{ "key": "A"|"B"|"C", "label": string }], "participantRoleKeys": [string, string], "whyTheseParticipants": string }] }',
    ].join("\n");
  },

  issueDebateTurnUser(args: {
    company: CompanyContext;
    project: ProjectContext;
    member: MemberContext;
    reviewLevel: ReviewLevel;
    issue: unknown;
    turnType: "claim" | "rebuttal" | "re_rebuttal";
    opponentTitle: string;
    priorTurns: unknown[];
    selfPreviousVote: string;
    selfPreviousCondition: string;
  }): string {
    const turnLabel =
      args.turnType === "claim"
        ? "主張（第1手）"
        : args.turnType === "rebuttal"
          ? "相手への反論（第1往復）"
          : "再反論（第2往復・最終）";
    return [
      `論点討論: ${turnLabel}`,
      "Step2の再要約は禁止。選択肢を具体化し、短い主張のみ。",
      "",
      MUTUAL_REVIEW_RULES,
      STANCE_DECISION_RULES,
      "",
      "## 審査レベル",
      formatReviewLevelGuidance(args.reviewLevel),
      "",
      "## あなた",
      formatMember(args.member),
      "",
      "## 会社 / 企画",
      formatCompany(args.company),
      formatProject(args.project),
      "",
      "## 論点",
      JSON.stringify(args.issue, null, 2),
      "",
      `相手: ${args.opponentTitle}`,
      "## これまでの発言",
      JSON.stringify(args.priorTurns, null, 2),
      "",
      `previousVote=${args.selfPreviousVote}`,
      `previousCondition=${args.selfPreviousCondition || "（なし）"}`,
      "voteChanged と conditionChanged を分離すること。",
      "conditional→conditional で条件だけ変わるなら voteChanged=false, conditionChanged=true。",
      "",
      "JSON:",
      '{ "turnType": "claim"|"rebuttal"|"re_rebuttal", "claim": string, "counterToOpponent": string, "alternative": string, "judgmentCondition": string, "preferredOptionKey": "A"|"B"|"C", "voteChanged": boolean, "conditionChanged": boolean, "previousVote": string, "currentVote": string, "previousCondition": string, "currentCondition": string }',
    ].join("\n");
  },

  issueChairSummaryUser(
    company: CompanyContext,
    project: ProjectContext,
    issue: unknown,
    turns: unknown[],
    reviewLevel: ReviewLevel,
  ): string {
    return [
      "論点の討論を整理してください。長文再要約は禁止。選択肢を明確にする。",
      "",
      MUTUAL_REVIEW_RULES,
      QRIMO_SIMPLY_RULES,
      "",
      formatReviewLevelGuidance(reviewLevel),
      formatCompany(company),
      formatProject(project),
      "## 論点",
      JSON.stringify(issue, null, 2),
      "## 討論ログ",
      JSON.stringify(turns, null, 2),
      "",
      "JSON:",
      '{ "conflictPoint": string, "optionA": string, "optionB": string, "optionAPros": string[], "optionACons": string[], "optionBPros": string[], "optionBCons": string[], "recommendation": string, "proposerMustDecide": string }',
    ].join("\n");
  },

  qualityBalancerUser(
    company: CompanyContext,
    project: ProjectContext,
    issue: unknown,
    chairSummary: unknown,
    reviewLevel: ReviewLevel,
  ): string {
    return [
      "Quality Balancer: 過剰な改善案・複雑化・MVPでは不要な案を削る。",
      QRIMO_SIMPLY_RULES,
      formatReviewLevelGuidance(reviewLevel),
      formatCompany(company),
      formatProject(project),
      "## 論点",
      JSON.stringify(issue, null, 2),
      "## 議長整理",
      JSON.stringify(chairSummary, null, 2),
      "",
      "JSON:",
      '{ "keptChoices": string[], "cutItems": [{ "item": string, "reason": "over_quality"|"complicates"|"mvp_unnecessary"|"future_ok" }], "simplyNote": string }',
    ].join("\n");
  },

  productCoachUser(
    company: CompanyContext,
    project: ProjectContext,
    reviews: unknown[],
    mutualReviews: unknown[],
    reviewLevel: ReviewLevel,
    roundLabel: string,
  ): string {
    return [
      `企画推進役ターン（${roundLabel}）です。企画者の味方としてレビューを整理してください。`,
      "経営判断はしない。次にやることを明確にする。",
      "",
      PRODUCT_COACH_RULES,
      QRIMO_VALUES,
      "",
      "## 審査レベル",
      formatReviewLevelGuidance(reviewLevel),
      "",
      "## 会社設定",
      formatCompany(company),
      "",
      "## 企画",
      formatProject(project),
      "",
      "## 役員レビュー",
      JSON.stringify(reviews, null, 2),
      "",
      "## 相互レビュー",
      JSON.stringify(mutualReviews, null, 2),
      "",
      "JSON:",
      '{ "reviewSummary": string, "priorityTop3": string[], "fixNow": string[], "deferLater": string[], "adviceToProposer": string, "revisedDraft": { "title": string, "summary": string, "keyChanges": string[], "openQuestions": string[] } }',
    ].join("\n");
  },

  reReviewUser(
    company: CompanyContext,
    project: ProjectContext,
    member: MemberContext,
    interim: unknown,
    proposerAnswer: unknown,
    previousReview: unknown,
    reviewLevel: ReviewLevel,
    agenda: unknown,
  ): string {
    return [
      "再レビューです。企画者の回答・修正を踏まえ、企画がどう育ったかを専門領域から見てください。",
      "必ず良い点(最大3)・懸念+理由(最大2)・改善案+効果(最大2)。質問最大2件。",
      "",
      "## 審査レベル",
      formatReviewLevelGuidance(reviewLevel),
      "",
      "## 企画の核心",
      JSON.stringify(coreFromAgenda(agenda), null, 2),
      "",
      "## あなたの役割",
      formatMember(member),
      "",
      "## 会社設定",
      formatCompany(company),
      "",
      "## 企画",
      formatProject(project),
      "",
      "## 企画推進役の整理（あれば）",
      JSON.stringify(interim, null, 2),
      "",
      "## 企画者の回答",
      JSON.stringify(proposerAnswer, null, 2),
      "",
      "## 前回レビュー",
      JSON.stringify(previousReview, null, 2),
      "",
      "JSON:",
      '{ "positives": string[], "concerns": [{ "concern": string, "reason": string }], "improvements": [{ "proposal": string, "expectedEffect": string, "preservesCoreConcept": boolean }], "questions": string[], "currentProposalVote": "approve"|"conditional"|"reject"|"hold", "revisedProposalVote": "approve"|"conditional"|"reject"|"hold"|null, "coreConceptPreserved": boolean, "coreConceptChangedReason": string|null, "decisionRationale": string, "approvalConditions": string[], "requiredRevisions": string[], "resubmissionRequired": boolean, "stanceChanged": boolean, "changeReason": string, "remainingConcerns": string[] }',
    ].join("\n");
  },

  ceoEditUser(
    company: CompanyContext,
    project: ProjectContext,
    interim: unknown,
    proposerAnswer: unknown,
    reReviews: unknown[],
    rebuttals: unknown[],
    reviewLevel: ReviewLevel,
  ): string {
    return [
      "CEO編集（Editor）です。レビューとディスカッションを整理し、全部入りを拒否してください。",
      "",
      QRIMO_VALUES,
      QRIMO_SIMPLY_RULES,
      CEO_EDITOR_RULES,
      "",
      "必須出力:",
      "1. coreValue: 今回最も重要な価値",
      "2. adoptedImprovements: 採用（最大3）",
      "3. heldImprovements: 保留＝価値はあるが今回はやらない（最大5）",
      "4. deferredImprovements: 見送る（最大5）",
      "5. editComment: 編集コメント",
      "6. editedPlan: 最小で価値の高い企画",
      "",
      "## 審査レベル",
      formatReviewLevelGuidance(reviewLevel),
      "",
      "## 会社設定",
      formatCompany(company),
      "",
      "## 元の企画",
      formatProject(project),
      "",
      "## 企画推進役の整理",
      JSON.stringify(interim, null, 2),
      "",
      "## 企画者回答（あれば）",
      JSON.stringify(proposerAnswer, null, 2),
      "",
      "## 役員レビュー",
      JSON.stringify(reReviews, null, 2),
      "",
      "## AIディスカッション",
      JSON.stringify(rebuttals, null, 2),
      "",
      "JSON:",
      '{ "coreValue": string, "adoptedImprovements": [{ "proposal": string, "reason": string, "sourceHint"?: string }], "heldImprovements": [{ "proposal": string, "reason": string, "sourceHint"?: string }], "deferredImprovements": [{ "proposal": string, "reason": string, "deferCategory": string, "sourceHint"?: string }], "editComment": string, "futureBacklog": string[], "editedPlan": { "title": string, "summary": string, "scope": string, "outOfScope": string, "successCriteria": string[], "operations": string }, "simplyCheck": { "complexityReduced": boolean, "valuePreserved": boolean, "explanation": string } }',
    ].join("\n");
  },

  decisionUser(
    company: CompanyContext,
    project: ProjectContext,
    interim: unknown,
    proposerAnswer: unknown,
    reReviews: unknown[],
    ceoEdit: unknown,
    reviewLevel: ReviewLevel,
    agenda: unknown,
  ): string {
    return [
      "参考採決です。目的は審査合格ではなく、育成後企画の参考判断です。",
      "result は approved | conditional | reconsider | rejected。",
      "採決対象は CEO編集後の editedPlan。",
      "note に「採決は参考情報」と明記すること。",
      "",
      "## 審査レベル",
      formatReviewLevelGuidance(reviewLevel),
      "",
      "## 核心",
      JSON.stringify(coreFromAgenda(agenda), null, 2),
      "",
      "## 会社設定",
      formatCompany(company),
      "",
      "## 元企画",
      formatProject(project),
      "",
      "## CEO編集",
      JSON.stringify(ceoEdit, null, 2),
      "",
      "## 企画推進役",
      JSON.stringify(interim, null, 2),
      "",
      "## 企画者回答",
      JSON.stringify(proposerAnswer, null, 2),
      "",
      "## 再レビュー",
      JSON.stringify(reReviews, null, 2),
      "",
      "JSON:",
      '{ "result": string, "conditions": string[], "mainReasons": string[], "strengthenedPoints": string[], "remainingRisks": string[], "nextActions": string[], "kpisToVerify": string[], "currentProposalVote": "approve"|"conditional"|"reject"|"hold", "revisedProposalVote": "approve"|"conditional"|"reject"|"hold"|null, "coreConceptPreserved": boolean, "coreConceptChangedReason": string|null, "decisionRationale": string, "approvalConditions": string[], "requiredRevisions": string[], "resubmissionRequired": boolean, "note": string }',
    ].join("\n");
  },

  growthSummaryUser(
    company: CompanyContext,
    project: ProjectContext,
    coach: unknown,
    proposerAnswers: unknown[],
    ceoEdit: unknown,
    decision?: unknown,
  ): string {
    return [
      "会議の最終成果物は Before → After の育成サマリーです。採決は行いません。",
      "企画がどう育ったかをまとめてください。",
      "",
      GROWTH_SYSTEM_PHILOSOPHY,
      "",
      "## 会社",
      formatCompany(company),
      "",
      "## Before（提出時企画）",
      formatProject(project),
      "",
      "## 企画推進役",
      JSON.stringify(coach, null, 2),
      "",
      "## 企画者の回答・修正",
      JSON.stringify(proposerAnswers, null, 2),
      "",
      "## CEO編集（Afterの根拠）",
      JSON.stringify(ceoEdit, null, 2),
      decision
        ? ["", "## 参考（旧フローの採決があれば）", JSON.stringify(decision, null, 2)].join(
            "\n",
          )
        : "",
      "",
      "nextActions は優先順位順で最大5件（例: MVP実施, KPI計測, インタビュー, 効果測定, 次回レビュー）。",
      "",
      "JSON:",
      '{ "beforeSummary": string, "newPerspectives": string[], "adoptedByProposer": string[], "afterSummary": string, "valueImproved": string[], "concernsResolved": string[], "remainingIssues": string[], "backlog": string[], "nextActions": string[] }',
    ].join("\n");
  },

  discussionFacilitatorUser(args: {
    company: CompanyContext;
    project: ProjectContext;
    availableRoleKeys: string[];
    transcript: unknown[];
    reviewLevel: ReviewLevel;
    evolvedHints: string[];
    currentPlan: { version: number; summary: string };
    planVersions: unknown[];
    openTopics: unknown[];
    priorityIssues: string[];
    decisions: string[];
    rejectedItems: string[];
  }): string {
    return [
      "AI壁打ち会議の司会です。レビューは書かない。",
      "担当は: 会議メモリ更新（決定/却下/未解決） / 論点整理 / 企画更新の徹底 / 収束 / 次の質問 / 発言順の指名。",
      CHAIR_FACILITATOR_RULES,
      DISCUSSION_RULES,
      "",
      "【重要】終了は発言回数ではなく『全論点が解決したか』で判断する。回数上限はない。",
      "【重要】毎ターン decisions / rejectedItems / openTopics / priorityIssues を必ず更新して返す。",
      `指名可能な roleKey: ${args.availableRoleKeys.join(", ")}`,
      "action:",
      "- nominate: nextSpeakerRoleKey を1人指名（固定順禁止）。未解決論点がある限りこちら",
      "- ask_proposer: 企画者の回答が必要",
      "- chair_nudge: 短い司会の一言（却下の再提案を止める、前提を確認する等）",
      "- propose_end: 全論点が resolved のときだけ。勝手に終了しない（企画者承認が必要）",
      "- rare_interrupt: 稀に割り込み役を interruptRoleKey で指定（頻発禁止）",
      "",
      "## 会議メモリ（現行）※更新して返すこと",
      "### 決定事項 decisions",
      args.decisions.length > 0
        ? JSON.stringify(args.decisions, null, 2)
        : "（まだなし）合意・採用した前提を追加していく",
      "### 却下事項 rejectedItems",
      args.rejectedItems.length > 0
        ? JSON.stringify(args.rejectedItems, null, 2)
        : "（まだなし）明確に却下した案を追加。再提案禁止リスト",
      "### 論点ボード openTopics（議論全体・最大12）",
      args.openTopics.length > 0
        ? JSON.stringify(args.openTopics, null, 2)
        : "（空）会話と企画から論点を抽出。status は unresolved / discussing / resolved。",
      "### 重要論点 priorityIssues（画面表示・最大4・重要度順）",
      args.priorityIssues.length > 0
        ? JSON.stringify(args.priorityIssues, null, 2)
        : "（空）openTopics のうち今すぐ深掘りすべきラベルを重要度順に最大4件。",
      "",
      "status: unresolved（未解決）| discussing（議論中）| resolved（解決済）",
      "例: openTopics に多数あっても、priorityIssues は『価格』『現場教育』など今の焦点だけ。",
      "繰り返しだけが続いている論点は repetitionDetected=true とし、その論点を resolved にしてよい。",
      "未解決が残っているのに propose_end してはいけない。",
      "却下の再提案が出たら chair_nudge か指名で『決定事項を前提に別角度で』と止める。",
      "",
      `## 現在の企画（Version ${args.currentPlan.version}）※これだけを前提にする`,
      args.currentPlan.summary,
      "",
      "## 企画バージョン履歴",
      JSON.stringify(args.planVersions, null, 2),
      "",
      "企画がどう変わったかのヒント:",
      JSON.stringify(args.evolvedHints, null, 2),
      "",
      formatReviewLevelGuidance(args.reviewLevel),
      formatCompany(args.company),
      "## 提出時企画（参考・旧版に戻るな）",
      formatProject(args.project),
      "## これまでの会話（末尾）",
      JSON.stringify(args.transcript.slice(-24), null, 2),
      "",
      "JSON:",
      '{ "action": "nominate"|"ask_proposer"|"chair_nudge"|"propose_end"|"rare_interrupt", "nextSpeakerRoleKey": string|null, "nominateReason": string, "chairUtterance": string|null, "endReason": string|null, "interruptRoleKey": string|null, "openTopics": [{ "id": string, "label": string, "status": "unresolved"|"discussing"|"resolved", "note": string|null }], "priorityIssues": string[], "decisions": string[], "rejectedItems": string[], "repetitionDetected": boolean }',
    ].join("\n");
  },

  discussionUtteranceUser(args: {
    company: CompanyContext;
    project: ProjectContext;
    member: MemberContext;
    transcript: unknown[];
    reviewLevel: ReviewLevel;
    nominateReason: string;
    currentPlan: { version: number; summary: string };
    decisions: string[];
    rejectedItems: string[];
    openTopics: unknown[];
    proposerAnswers: string[];
    chairNotes: string[];
  }): string {
    const balancerExtra =
      args.member.roleKey === "quality_balancer"
        ? `\n${QUALITY_BALANCER_RULES}`
        : "";
    return [
      "AI壁打ち会議の発言です。レビュー禁止。自然な会話だけ。150文字以内。",
      DISCUSSION_RULES,
      balancerExtra,
      `司会があなたを指名した理由: ${args.nominateReason}`,
      "役員同士への反論を歓迎。企画者だけに話しかけない。",
      "同じ話の繰り返し禁止。決定事項を前提に、未解決論点を1歩進める発言だけ。",
      `必ず Version ${args.currentPlan.version} の企画だけを前提にする。旧版に戻るな。`,
      "企画が更新された直後なら『その修正なら懸念は解消』『別の課題が見えてきた』で前へ進める。",
      "",
      "## 必読: 会議メモリ（これを無視した発言は禁止）",
      `### 現在の企画概要 Version ${args.currentPlan.version}`,
      args.currentPlan.summary,
      "### 決定事項（前提。覆すな）",
      args.decisions.length > 0
        ? args.decisions.map((d) => `・${d}`).join("\n")
        : "・（まだなし）",
      "### 却下事項（再提案禁止）",
      args.rejectedItems.length > 0
        ? args.rejectedItems.map((d) => `・${d}`).join("\n")
        : "・（まだなし）",
      "### 未解決論点",
      JSON.stringify(args.openTopics, null, 2),
      "### 企画者の発言（抜粋）",
      args.proposerAnswers.length > 0
        ? args.proposerAnswers.map((t) => `- ${t}`).join("\n")
        : "- （まだなし）",
      "### CEOの論点整理（抜粋）",
      args.chairNotes.length > 0
        ? args.chairNotes.map((t) => `- ${t}`).join("\n")
        : "- （まだなし）",
      "",
      "却下事項を言い換えて再提案しないこと。決定事項の上に立って次の問い・別案・深掘りをする。",
      "",
      formatReviewLevelGuidance(args.reviewLevel),
      formatMember(args.member),
      formatCompany(args.company),
      "## 提出時企画（参考のみ）",
      formatProject(args.project),
      "## これまでの会話（末尾）",
      JSON.stringify(args.transcript.slice(-16), null, 2),
      "",
      "JSON:",
      '{ "text": string, "addressTo": "proposer"|"officer"|"all", "addressRoleKey": string|null, "moveType": "question"|"counter"|"alternative"|"challenge_premise"|"expand"|"brake" }',
    ].join("\n");
  },

  planUpdateDetectionUser(args: {
    company: CompanyContext;
    project: ProjectContext;
    currentPlan: { version: number; summary: string };
    proposerMessage: string;
    revisedPlanNote?: string;
  }): string {
    return [
      "企画者の発言から、企画そのものが更新されたかを判定してください。",
      "更新例: 無料版追加、価格変更、紙だけにする、対象縮小、特典追加など。",
      "単なる反論・感想・質問返しだけの場合は planUpdated=false。",
      "revisedPlanNote がある場合は原則更新とみなす。",
      "更新時の changes は『・』なしで短い箇条書き文言（追加/削除/変更が分かる表現）。",
      "updatedPlanSummary は企画概要を書き換える必要があるときだけ全文を書く。",
      "概要の書き換えが不要なら updatedPlanSummary は null（空文字禁止。未更新時は null）。",
      "planUpdated=false のときも updatedPlanSummary は null でよい。",
      "",
      CHAIR_FACILITATOR_RULES,
      "",
      `## 現行 Version ${args.currentPlan.version}`,
      args.currentPlan.summary,
      "",
      "## 提出時企画（参考）",
      formatProject(args.project),
      formatCompany(args.company),
      "",
      "## 企画者の発言",
      args.proposerMessage,
      "",
      "## 企画者の修正メモ（任意）",
      args.revisedPlanNote?.trim() || "（なし）",
      "",
      "JSON:",
      '{ "planUpdated": boolean, "changes": string[], "updatedPlanSummary": string|null, "chairNote": string|null }',
    ].join("\n");
  },

  interruptClassificationUser(args: {
    company: CompanyContext;
    project: ProjectContext;
    currentPlan: { version: number; summary: string };
    proposerMessage: string;
    targetRoleKey: string | null;
    messageType: string | null;
    availableRoleKeys: string[];
  }): string {
    return [
      "企画者が会議に割り込みました。意図を分類し、次に振る役員と短い司会コメントを出してください。",
      "長いレビュー禁止。150文字以内の司会進行のみ。",
      CHAIR_FACILITATOR_RULES,
      DISCUSSION_RULES,
      "",
      `発言先の希望: ${args.targetRoleKey ?? "指定なし"}`,
      `発言タイプの希望: ${args.messageType ?? "自動判定"}`,
      `選べる roleKey: ${args.availableRoleKeys.join(", ")}`,
      "",
      `## 現在の企画 Version ${args.currentPlan.version}`,
      args.currentPlan.summary,
      formatCompany(args.company),
      formatProject(args.project),
      "## 企画者の割り込み",
      args.proposerMessage,
      "",
      "intent: question|objection|clarification|proposal_change|topic_change|pause_request|summary_request|decision|end_request",
      "needsPlanUpdateReview: 企画変更を含むなら true",
      "",
      "JSON:",
      '{ "intent": string, "preferredNextRoleKey": string|null, "overrideTargetReason": string|null, "chairUtterance": string, "needsPlanUpdateReview": boolean }',
    ].join("\n");
  },

  discussionBriefSummaryUser(args: {
    company: CompanyContext;
    project: ProjectContext;
    currentPlan: { version: number; summary: string };
    transcript: unknown[];
    decisions?: string[];
    rejectedItems?: string[];
    openTopics?: unknown[];
    priorityIssues?: string[];
  }): string {
    return [
      "一度整理します。以下だけを簡潔に。レビュー長文禁止。",
      "- 現在の案",
      "- 合意している点",
      "- 残っている論点（openIssues: 全体・最大10。件数超過で失敗させない）",
      "- 重要論点（priorityIssues: 重要度順・最大4。画面表示用）",
      "- 次に答えるべき質問",
      "",
      `## 現在の企画 Version ${args.currentPlan.version}`,
      args.currentPlan.summary,
      "## 会議メモリ（参考）",
      `決定: ${JSON.stringify(args.decisions ?? [])}`,
      `却下: ${JSON.stringify(args.rejectedItems ?? [])}`,
      `論点ボード: ${JSON.stringify(args.openTopics ?? [])}`,
      `重要論点: ${JSON.stringify(args.priorityIssues ?? [])}`,
      formatCompany(args.company),
      "## 会話末尾",
      JSON.stringify(args.transcript.slice(-20), null, 2),
      "",
      "JSON:",
      '{ "currentPlan": string, "agreedPoints": string[], "openIssues": string[], "priorityIssues": string[], "nextQuestion": string }',
    ].join("\n");
  },
};
