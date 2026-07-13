/** Role-specific “thinking” lines for live board meeting UX. */
export const THINKING_MESSAGES: Record<string, string[]> = {
  cfo: [
    "財務影響を試算しています…",
    "ROIを計算しています…",
    "コスト構造を点検しています…",
  ],
  cto: [
    "技術的実現性を確認しています…",
    "実装コストを検討しています…",
    "過剰設計になっていないか見ています…",
  ],
  marketing: [
    "市場反応を分析しています…",
    "顧客心理を考えています…",
    "訴求の刺さり方を検討しています…",
  ],
  operations: [
    "現場運用を確認しています…",
    "例外対応の負荷を見積もっています…",
    "継続運用できるか考えています…",
  ],
  customer: [
    "利用者目線で考えています…",
    "本当に使うかを想像しています…",
    "不公平感がないか感じています…",
  ],
  redteam: [
    "失敗シナリオを探しています…",
    "最悪ケースを洗い出しています…",
    "前提の穴を探しています…",
  ],
  quality_balancer: [
    "過剰改善になっていないか確認しています…",
    "Simplyに反していないか見ています…",
    "MVP範囲を点検しています…",
  ],
  ceo: [
    "論点を整理しています…",
    "次に振るべき視点を選んでいます…",
    "議論の流れを整えています…",
  ],
  chair: [
    "論点を整理しています…",
    "次に振るべき視点を選んでいます…",
  ],
};

export function pickThinkingLine(roleKey: string): string {
  const lines = THINKING_MESSAGES[roleKey] ?? [
    "考えています…",
    "発言をまとめています…",
  ];
  return lines[Math.floor(Math.random() * lines.length)]!;
}

export function thinkingTitle(roleTitle: string): string {
  return `${roleTitle}が考えています…`;
}
