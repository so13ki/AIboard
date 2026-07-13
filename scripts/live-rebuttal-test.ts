import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { runAgenda } from "../src/lib/ai/run-chairperson";
import { runInitialReview, runRebuttal } from "../src/lib/ai/run-board-member";
import {
  isSimilarPoint,
  isValueCuttingAlternative,
  isWeakRebuttalText,
  reduceReviewOverlap,
} from "../src/lib/ai/dedupe";
import type {
  CompanyContext,
  MemberContext,
  ProjectContext,
} from "../src/lib/ai/prompts";
import {
  assignRebuttalTargets,
  type RebuttalCandidate,
} from "../src/lib/meeting/assign-rebuttal-targets";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});
const prisma = new PrismaClient({ adapter });

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function main() {
  const company = await prisma.company.findFirst({
    include: { boardMembers: { orderBy: { sortOrder: "asc" } } },
  });
  if (!company) throw new Error("company missing");

  const companyCtx: CompanyContext = {
    name: company.name,
    philosophy: company.philosophy,
    vision: company.vision,
    values: asStringArray(company.values),
    culture: company.culture,
    principles: company.principles,
    prohibitions: company.prohibitions,
  };

  const project: ProjectContext = {
    title: "キッズスクール4ステージ制度",
    background:
      "キッズスクールで成長の道筋が見えにくく、保護者への説明も属人化している。",
    problem: "子どもと保護者に成長段階を分かりやすく伝えたい。",
    content:
      "紙の運用で4ステージ制度を試験導入する。大会参加だけを正解にせず、挑戦と基礎定着を可視化する。まずは1クラス・数週間の小規模試行。",
    targetCustomer: "キッズスクールの子どもと保護者",
    expectedEffect: "継続率改善、保護者納得感、コーチ説明の標準化",
    estimatedCost: "印刷・資料作成程度。追加システム開発なし。数千円〜数万円規模。",
    constraints: "撤回可能な小規模実験。現場負荷を増やしすぎない。",
    discussionPoints: "ランク付けと誤解されないか、紙で十分か、誰が認定するか",
  };

  const toMember = (m: (typeof company.boardMembers)[number]): MemberContext => ({
    title: m.title,
    roleKey: m.roleKey,
    description: m.description,
    priorities: asStringArray(m.priorities),
    checkItems: m.checkItems == null ? null : asStringArray(m.checkItems),
    behaviorRules: asStringArray(m.behaviorRules),
    isChairperson: m.isChairperson,
  });

  const chair = company.boardMembers.find((m) => m.isChairperson);
  if (!chair) throw new Error("chair missing");

  console.log("agenda...");
  const agenda = await runAgenda({
    company: companyCtx,
    project,
    chair: toMember(chair),
  });

  const reviewers = company.boardMembers.filter(
    (m) => !m.isChairperson && m.roleKey !== "product_coach",
  );
  const prior: Array<{
    memberId: string;
    memberTitle: string;
    roleKey: string;
    content: {
      biggestConcern: string;
      questions: string[];
      revisionProposals: string[];
      stance: string;
      evaluation: string;
    };
  }> = [];

  for (const member of reviewers) {
    console.log(`review: ${member.title}`);
    const raw = await runInitialReview({
      company: companyCtx,
      project,
      member: toMember(member),
      agenda,
      reviewLevel: agenda.reviewLevel,
      priorReviews: prior.map((p) => ({
        memberTitle: p.memberTitle,
        content: p.content,
      })),
    });
    const review = reduceReviewOverlap(
      raw,
      prior.map((p) => p.content),
    );
    prior.push({
      memberId: member.id,
      memberTitle: member.title,
      roleKey: member.roleKey,
      content: {
        biggestConcern: review.biggestConcern,
        questions: review.questions,
        revisionProposals: review.revisionProposals,
        stance: review.stance,
        evaluation: review.evaluation,
      },
    });
  }

  const candidates: RebuttalCandidate[] = prior.map((p) => ({
    memberId: p.memberId,
    memberTitle: p.memberTitle,
    roleKey: p.roleKey,
    stance: p.content.stance,
    biggestConcern: p.content.biggestConcern,
    revisionProposals: p.content.revisionProposals,
    priorities: asStringArray(
      reviewers.find((m) => m.id === p.memberId)?.priorities,
    ),
  }));

  const assignments = assignRebuttalTargets(candidates, 2);
  const targetTitles = [...assignments.values()].map(
    (id) => candidates.find((c) => c.memberId === id)?.memberTitle ?? id,
  );
  const uniqueTargets = new Set(targetTitles);
  const redteamId = candidates.find((c) => c.roleKey === "redteam")?.memberId;
  const redteamCount = [...assignments.values()].filter((id) => id === redteamId)
    .length;

  console.log("assignments:", Object.fromEntries(
    [...assignments.entries()].map(([from, to]) => [
      candidates.find((c) => c.memberId === from)?.memberTitle,
      candidates.find((c) => c.memberId === to)?.memberTitle,
    ]),
  ));
  console.log("unique targets:", uniqueTargets.size, "redteam count:", redteamCount);

  if (redteamCount > 2) throw new Error("redteam targeted more than twice");
  if (uniqueTargets.size < 3) throw new Error("fewer than 3 rebuttal targets");

  const rebuttals = [];
  const priorQuestions: string[] = [];
  let changedCount = 0;
  let weakCount = 0;
  let valueCutCount = 0;

  for (const member of reviewers) {
    const targetId = assignments.get(member.id)!;
    const target = candidates.find((c) => c.memberId === targetId)!;
    const self = prior.find((p) => p.memberId === member.id)!;
    console.log(`rebuttal: ${member.title} -> ${target.memberTitle}`);

    const result = await runRebuttal({
      company: companyCtx,
      project,
      member: toMember(member),
      assignedTarget: {
        memberTitle: target.memberTitle,
        roleKey: target.roleKey,
        stance: target.stance,
        content: prior.find((p) => p.memberId === targetId)!.content,
      },
      otherReviews: prior
        .filter((p) => p.memberId !== member.id && p.memberId !== targetId)
        .map((p) => ({
          memberTitle: p.memberTitle,
          stance: p.content.stance,
          biggestConcern: p.content.biggestConcern,
        })),
      reviewLevel: agenda.reviewLevel,
      previousDecision: self.content.stance,
    });

    if (result.referencedMemberTitle !== target.memberTitle) {
      console.warn("title drift corrected in orchestrator normally");
    }

    const core = [
      result.rejectedClaim,
      result.choiceConflict,
      result.counterpoint,
      result.counterReason,
      result.alternative,
    ].join("\n");
    if (isWeakRebuttalText(core)) weakCount += 1;
    if (isValueCuttingAlternative(result.alternative)) valueCutCount += 1;
    if (
      result.decisionChanged ||
      result.previousDecision !== result.currentDecision ||
      /条件|優先|試行/.test(result.changedCondition)
    ) {
      changedCount += 1;
    }

    for (const q of result.questionsForProposer) {
      if (priorQuestions.some((p) => isSimilarPoint(p, q))) {
        console.warn("duplicate question:", q);
      }
      priorQuestions.push(q);
    }

    rebuttals.push({
      from: member.title,
      to: target.memberTitle,
      disagreementType: result.disagreementType,
      choiceConflict: result.choiceConflict,
      decisionChanged: result.decisionChanged,
      previousDecision: result.previousDecision,
      currentDecision: result.currentDecision,
      changedCondition: result.changedCondition,
      alternative: result.alternative,
      questionsForProposer: result.questionsForProposer,
    });
  }

  console.log(JSON.stringify(rebuttals, null, 2));
  console.log({ changedCount, weakCount, valueCutCount });

  if (weakCount > 2) throw new Error(`too many weak rebuttals: ${weakCount}`);
  if (valueCutCount > 0) throw new Error("value-cutting alternatives found");
  if (changedCount < 2) throw new Error("fewer than 2 members changed conditions");

  console.log("live rebuttal test passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
