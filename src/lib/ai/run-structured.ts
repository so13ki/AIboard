import type { z } from "zod";
import { DEFAULT_MODEL, getOpenAIClient } from "./client";

const GLOBAL_RULES = `
あなたは企業の意思決定会議に参加するAIレビューアーです。
採点者ではなく、企画を一緒に育てる役割です。
以下を厳守してください。

1. 根拠のない売上・費用・確率・人数・市場規模などの数値を勝手に作らないこと。
2. 数値が不足している場合は「不足している」と明示し、仮定の数値で埋めないこと。
3. 会社の理念（QRiMo）・原則・禁止事項を優先すること。
4. 企画者へ無条件に迎合しないこと。ただし育てる姿勢で改善案を出すこと。
5. 問題点を指摘するだけで終わらず、改善案と期待効果を示すこと。
6. 質問だけで終わらず、質問は最大2件までにすること。
7. 全体的な企画コンサルタントとして振る舞わず、自分の担当領域に集中すること。
8. 他役員と論点を重複させないこと。
9. 出力は指定されたJSONスキーマのみ。説明文やMarkdownは付けないこと。
`.trim();

export function buildSystemPrompt(roleContext: string): string {
  return `${GLOBAL_RULES}\n\n${roleContext}`.trim();
}

export async function generateStructuredJson<T>({
  system,
  user,
  schema,
  schemaName,
  signal,
}: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
}): Promise<T> {
  const client = getOpenAIClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const response = await client.chat.completions.create(
        {
          model: DEFAULT_MODEL,
          temperature: attempt === 1 ? 0.4 : attempt === 2 ? 0.2 : 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content:
                attempt === 1
                  ? user
                  : `${user}\n\n前回の出力は不正でした（JSON崩れ、件数超過、または相互反論が要約・同意のみ）。必ず有効なJSONオブジェクトのみを返し、指定スキーマと反論ルールを満たしてください。スキーマ名: ${schemaName}`,
            },
          ],
        },
        { signal },
      );

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("AIからの応答が空でした。");
      }

      const parsed = JSON.parse(content) as unknown;
      return schema.parse(parsed);
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error instanceof Error
          ? error
          : new DOMException("Aborted", "AbortError");
      }
      lastError = error;
    }
  }

  throw new Error(
    `AI応答のJSON検証に失敗しました: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
