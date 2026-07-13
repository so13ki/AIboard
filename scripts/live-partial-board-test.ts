import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { runAgenda } from "../src/lib/ai/run-chairperson";
import { runInitialReview } from "../src/lib/ai/run-board-member";
import { reduceReviewOverlap } from "../src/lib/ai/dedupe";
import type { CompanyContext, MemberContext, ProjectContext } from "../src/lib/ai/prompts";

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

  const chair = company.boardMembers.find((m) => m.isChairperson);
  if (!chair) throw new Error("chair missing");

  const toMember = (m: (typeof company.boardMembers)[number]): MemberContext => ({
    title: m.title,
    roleKey: m.roleKey,
    description: m.description,
    priorities: asStringArray(m.priorities),
    checkItems: m.checkItems == null ? null : asStringArray(m.checkItems),
    behaviorRules: asStringArray(m.behaviorRules),
    isChairperson: m.isChairperson,
  });

  console.log("Running agenda...");
  const agenda = await runAgenda({
    company: companyCtx,
    project,
    chair: toMember(chair),
  });
  console.log("reviewLevel:", agenda.reviewLevel, agenda.reviewLevelReason);

  const reviewers = company.boardMembers.filter(
    (m) => !m.isChairperson && m.roleKey !== "product_coach",
  );
  const prior: Array<{
    memberTitle: string;
    content: {
      biggestConcern: string;
      questions: string[];
      revisionProposals: string[];
      stance: string;
      evaluation: string;
      concerns?: Array<{ concern: string; reason: string }>;
      improvements?: Array<{
        proposal: string;
        expectedEffect: string;
        preservesCoreConcept: boolean;
      }>;
    };
  }> = [];

  for (const member of reviewers) {
    console.log(`Review: ${member.title}...`);
    const raw = await runInitialReview({
      company: companyCtx,
      project,
      member: toMember(member),
      agenda,
      reviewLevel: agenda.reviewLevel,
      priorReviews: prior,
    });
    const review = reduceReviewOverlap(
      raw,
      prior.map((p) => p.content),
    );

    if (review.questions.length > 2) {
      throw new Error(`${member.title}: questions > 2`);
    }
    if (review.improvements.length > 2) {
      throw new Error(`${member.title}: improvements > 2`);
    }

    console.log(
      JSON.stringify(
        {
          title: member.title,
          stance: review.stance,
          positives: review.positives,
          concerns: review.concerns,
          improvements: review.improvements,
          questions: review.questions,
        },
        null,
        2,
      ),
    );

    prior.push({
      memberTitle: member.title,
      content: {
        biggestConcern: review.biggestConcern,
        questions: review.questions,
        revisionProposals: review.revisionProposals,
        stance: review.stance,
        evaluation: review.evaluation,
        concerns: review.concerns,
        improvements: review.improvements,
      },
    });
  }

  const concerns = prior.map((p) => p.content.biggestConcern);
  const uniqueRatio =
    new Set(concerns.map((c) => c.slice(0, 12))).size / concerns.length;
  console.log("concern unique-ish ratio:", uniqueRatio.toFixed(2));
  if (agenda.reviewLevel !== "experiment") {
    console.warn("Expected experiment for this low-cost pilot project");
  }
  console.log("live partial board test passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
