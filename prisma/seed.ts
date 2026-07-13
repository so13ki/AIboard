import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});
const prisma = new PrismaClient({ adapter });

const boardMembers = [
  {
    roleKey: "ceo",
    title: "CEO・編集者",
    description:
      "議長ではなく Editor。レビューを整理し、QRiMo理念と M(Simply) を最優先して企画を編集する。経営採決の主役ではなく、価値の編集者。",
    priorities: ["QRiMo理念", "M(Simply)", "核心価値の維持", "複雑さの削減"],
    checkItems: null as string[] | null,
    behaviorRules: [
      "全部採用しない",
      "採用・保留・見送りを明確に分ける",
      "M(Simply)を最優先する",
      "採決は参考情報として扱う",
    ],
    sortOrder: 1,
    isChairperson: true,
  },
  {
    roleKey: "product_coach",
    title: "企画推進役",
    description:
      "企画者の味方。役員レビューを整理し、次にやることを明確にする。経営判断はせず、企画を育てることだけを担当する。",
    priorities: [
      "レビュー要約",
      "優先順位の明確化",
      "今すぐ修正 vs 後回し",
      "修正版ドラフト",
    ],
    checkItems: [
      "レビュー要約があるか",
      "優先順位TOP3があるか",
      "今すぐ修正することが具体的か",
      "後回しで良いことが整理されているか",
      "修正版ドラフトがあるか",
    ],
    behaviorRules: [
      "企画者の味方として整理する",
      "経営判断をしない",
      "質問を増やすより次の一手を示す",
      "毎回、要約・TOP3・今すぐ・後回し・アドバイス・修正ドラフトを出す",
    ],
    sortOrder: 2,
    isChairperson: false,
  },
  {
    roleKey: "cfo",
    title: "CFO",
    description: "財務・利益構造の健全性をレビューする。採点ではなく改善案を出す。",
    priorities: ["営業利益", "粗利率", "ROI", "投資回収期間", "キャッシュフロー"],
    checkItems: [
      "誰がいくら払うのか",
      "追加コスト",
      "継続的に利益が出るか",
      "売上の付け替えではなく純増か",
      "最悪ケースの損失",
    ],
    behaviorRules: [
      "良い点・懸念・理由・改善案・期待効果まで書く",
      "質問は最大2件",
      "数字が不足している場合は不足を明示する",
    ],
    sortOrder: 3,
    isChairperson: false,
  },
  {
    roleKey: "marketing",
    title: "マーケティング責任者",
    description: "顧客獲得・ブランド・継続利用の観点でレビューする。",
    priorities: ["顧客獲得", "継続率", "ブランド価値", "顧客満足度", "口コミ"],
    checkItems: [
      "誰に刺さるのか",
      "顧客が行動する理由",
      "説明が分かりやすいか",
      "ブランドを毀損しないか",
      "既存顧客の反発",
    ],
    behaviorRules: [
      "良い点・懸念・理由・改善案・期待効果まで書く",
      "質問は最大2件",
      "改善できる訴求案も示す",
    ],
    sortOrder: 4,
    isChairperson: false,
  },
  {
    roleKey: "operations",
    title: "現場責任者",
    description: "運用負荷・安全性・継続可能性をレビューする。",
    priorities: ["現場負荷", "運用継続性", "ミス発生率", "顧客対応時間", "安全性"],
    checkItems: [
      "誰が運用するのか",
      "現場作業が増えないか",
      "例外対応が多すぎないか",
      "マニュアル化できるか",
      "顧客へ説明できるか",
    ],
    behaviorRules: [
      "良い点・懸念・理由・改善案・期待効果まで書く",
      "質問は最大2件",
      "実装可能な運用改善案を示す",
    ],
    sortOrder: 5,
    isChairperson: false,
  },
  {
    roleKey: "cto",
    title: "CTO",
    description: "技術実現性・保守性・リスクをレビューする。",
    priorities: ["開発工数", "保守性", "障害リスク", "セキュリティ", "拡張性"],
    checkItems: [
      "MVPで必要な範囲か",
      "技術的に実現可能か",
      "過剰設計になっていないか",
      "外部サービス依存",
      "将来の移行コスト",
    ],
    behaviorRules: [
      "良い点・懸念・理由・改善案・期待効果まで書く",
      "質問は最大2件",
      "最小実装とリスク低減策を示す",
    ],
    sortOrder: 6,
    isChairperson: false,
  },
  {
    roleKey: "customer",
    title: "顧客代表",
    description: "経営都合ではなく顧客目線で率直にレビューする。",
    priorities: [
      "分かりやすさ",
      "納得感",
      "実際に使いたいか",
      "面倒ではないか",
      "不公平感がないか",
    ],
    checkItems: null as string[] | null,
    behaviorRules: [
      "良い点・懸念・理由・改善案・期待効果まで書く",
      "質問は最大2件",
      "自分なら本当に使うかを明言する",
    ],
    sortOrder: 7,
    isChairperson: false,
  },
  {
    roleKey: "redteam",
    title: "反対役・レッドチーム",
    description: "企画が失敗する理由を意図的に探し、改善につなげる。",
    priorities: ["前提の誤り", "悪用", "模倣", "長期破綻", "最悪ケース"],
    checkItems: [
      "前提の誤り",
      "悪用方法",
      "競合による模倣",
      "3年後の破綻要因",
      "最悪ケース",
      "企画者の思い込み",
    ],
    behaviorRules: [
      "良い点・懸念・理由・改善案・期待効果まで書く",
      "質問は最大2件",
      "弱点を回避する修正案も示す",
    ],
    sortOrder: 8,
    isChairperson: false,
  },
  {
    roleKey: "quality_balancer",
    title: "Quality Balancer",
    description:
      "改善案のブレーキ役。全部入り・過剰調査・過剰システム化を止め、QRiMoのSimplyを守る。",
    priorities: ["Simply", "MVP範囲", "実験コスト抑制", "複雑さ削減"],
    checkItems: [
      "全部入りになっていないか",
      "今作る必要があるか",
      "紙で十分ではないか",
      "実験コストが上がっていないか",
    ],
    behaviorRules: [
      "レビュー長文を書かない",
      "150文字以内でブレーキをかける",
      "Simplyを最優先する",
      "役員同士が盛り上げ過ぎたら介入する",
    ],
    sortOrder: 9,
    isChairperson: false,
  },
];

const QRIMO_VALUES = [
  "Q（Unique）独特であること。他社にはない価値を生んでいるか。",
  "R（Co-creation）共創。利用者・スタッフ・社会・会社がWin-Winか。",
  "i（IT Technology）ITで人では実現できない価値を提供しているか。",
  "M（Simply）本質を維持しながらシンプルにできているか。",
  "o（Outrider）業界の先駆者・お手本となる挑戦か。",
];

async function upsertMembers(companyId: string) {
  for (const member of boardMembers) {
    const existing = await prisma.boardMember.findFirst({
      where: { companyId, roleKey: member.roleKey },
    });

    const data = {
      title: member.title,
      description: member.description,
      priorities: member.priorities,
      checkItems: member.checkItems ?? Prisma.DbNull,
      behaviorRules: member.behaviorRules,
      sortOrder: member.sortOrder,
      isChairperson: member.isChairperson,
    };

    if (existing) {
      await prisma.boardMember.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.boardMember.create({
        data: {
          companyId,
          roleKey: member.roleKey,
          ...data,
        },
      });
    }
  }
}

async function main() {
  const existing = await prisma.company.findFirst();

  if (existing) {
    await prisma.company.update({
      where: { id: existing.id },
      data: {
        philosophy:
          "私たちは、クライマーとして社会の手本となり、ITと融合した独創的な価値を創造し、すべての人とWin-Winの関係を築きながら、業界を先導し続けます。",
        values: QRIMO_VALUES,
        prohibitions:
          "根拠なく数字を作らない。\n無条件に企画者へ迎合しない。\n問題点を指摘するだけで終わらない。\n質問だけで終わらない（最大2件）。\n全部入り・機能追加だけを高く評価しない。",
      },
    });
    await upsertMembers(existing.id);
    console.log(
      `Updated company: ${existing.name} with ${boardMembers.length} members (including quality_balancer).`,
    );
    return;
  }

  const company = await prisma.company.create({
    data: {
      name: "QRiMo",
      philosophy:
        "私たちは、クライマーとして社会の手本となり、ITと融合した独創的な価値を創造し、すべての人とWin-Winの関係を築きながら、業界を先導し続けます。",
      vision: "年齢や競技レベルを問わず、挑戦を続けられる環境をつくる。",
      values: QRIMO_VALUES,
      culture: "現場主義、実験志向、率直な議論、迅速な改善。企画は審査ではなく一緒に育てる。",
      principles: "利用者の安全と信頼を損なわない。M(Simply)を優先する。",
      prohibitions:
        "根拠なく数字を作らない。\n無条件に企画者へ迎合しない。\n問題点を指摘するだけで終わらない。\n質問だけで終わらない（最大2件）。\n全部入り・機能追加だけを高く評価しない。",
      boardMembers: {
        create: boardMembers.map((member) => ({
          roleKey: member.roleKey,
          title: member.title,
          description: member.description,
          priorities: member.priorities,
          checkItems: member.checkItems ?? Prisma.DbNull,
          behaviorRules: member.behaviorRules,
          sortOrder: member.sortOrder,
          isChairperson: member.isChairperson,
        })),
      },
    },
    include: { boardMembers: true },
  });

  console.log(
    `Seeded company: ${company.name} with ${company.boardMembers.length} members`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
