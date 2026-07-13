# AI役員会

AIと一緒に企画を育てる「AI企画育成レビューシステム」のMVPです。採決が目的ではなく、企画品質を高めることが目的です。最終成果物は **Before → After** です。

## 技術構成

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Prisma ORM + SQLite（プロジェクト内ファイル）
- OpenAI API（サーバー側のみ）
- Zod（AI応答の構造化検証）

認証・Docker・外部DBは使いません。

## セットアップ手順

```bash
npm install
cp .env.example .env   # または既存の .env を編集
```

`.env` に以下を設定します。

```env
DATABASE_URL="file:./prisma/dev.db"
OPENAI_API_KEY="sk-..."
# 任意
OPENAI_MODEL="gpt-4.1-mini"
```

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DATABASE_URL` | Yes | SQLite接続文字列。ローカルでは `file:./prisma/dev.db` |
| `OPENAI_API_KEY` | Yes（AI実行時） | OpenAI APIキー |
| `OPENAI_MODEL` | No | 既定は `gpt-4.1-mini` |

## DB初期化方法

```bash
npx prisma migrate dev
npx prisma db seed
```

またはまとめて:

```bash
npm run db:migrate
npm run db:seed
```

初期データとして会社「QRiMo」と8名のAI役職（CEO編集者・企画推進役・専門レビューアー6名）が投入されます。既存DBにも `npm run db:seed` で企画推進役を追加・更新できます。

DBを作り直す場合:

```bash
npm run db:reset
```

## 開発サーバー起動方法

```bash
npm run dev
```

http://localhost:3000 を開きます。

## 設計思想

- 役員は採点者ではなくレビューアー（懸念・リスク・改善案・代替案・新しい視点）
- レビューは「良い点 → 懸念 → 理由 → 改善案 → 期待効果」まで書く（質問は最大2件）
- 相互レビューは勝敗ではなく、重要論点の整理（重要 / 過剰品質 / MVP不要 / 将来対応）
- **企画推進役**は企画者の味方。要約・TOP3・今すぐ修正・後回し・アドバイス・修正ドラフト
- **企画者ターン**が最重要。回答・修正・反論を自由に行う
- **CEOは Editor**。採用 / 保留（価値はあるが今回はやらない） / 見送り。M(Simply) 最優先
- 成功条件は全員賛成ではなく、「最初より企画が大きく成長した」と感じられること

## 会議フロー

1. **論点整理** … 議題・前提・制約・判断基準・審査レベル・核心
2. **役員レビュー** … 専門役員へ同時依頼し、返ってきた順にライブ表示（考え中・入力中 → 展開）
3. **AIディスカッション** … リアルタイム壁打ち。CEOが未解決論点ボードを更新し、論点が収束するまで継続（発言回数上限なし）。企画者は途中乱入可
4. **企画推進役** … 論点整理・宿題整理・修正ドラフト
5. **企画者回答** … 必要なときだけ回答・修正・反論（スキップ可）
6. **CEO編集** … 核心価値 / 採用 / 保留 / 見送り / 最終企画へ統合
7. **育成サマリー** … Before → 新視点 → 採用改善 → After + 次アクション5件以内

会議画面の「次のステップへ」で進行します。ディスカッションはライブUI、企画者回答は任意です。採決ステップはありません。

会社設定・役員・企画・会議・ラウンド・発言・育成サマリーはすべて SQLite に保存されます。

## 主な画面

- `/` ダッシュボード
- `/company` 会社設定
- `/board-members` 役員一覧・編集
- `/projects` 企画一覧・作成・編集
- `/meetings` 会議履歴・会議進行

## PostgreSQLへ移行する場合の注意点

1. `prisma/schema.prisma` の `datasource.provider` を `postgresql` に変更する
2. `DATABASE_URL` を PostgreSQL の接続文字列に変更する
3. Prisma 7 では `@prisma/adapter-pg`（または相当する adapter）へ切り替える
4. SQLite固有の型依存は避けているため、モデルはそのまま移行しやすい
5. `Json` フィールドは PostgreSQL の JSON/JSONB として扱える
6. 既存SQLiteデータの移行はエクスポート／インポート、またはアプリケーション層でのコピーが必要
7. `prisma migrate` を PostgreSQL 向けに新規適用し、seed を再実行する

## スクリプト

| コマンド | 内容 |
|----------|------|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run db:generate` | Prisma Client 生成 |
| `npm run db:migrate` | マイグレーション |
| `npm run db:seed` | 初期データ投入 |
| `npm run db:studio` | Prisma Studio |
