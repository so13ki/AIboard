import OpenAI from "openai";

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY が設定されていません。.env に API キーを設定してください。",
    );
  }
  return new OpenAI({ apiKey });
}

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
