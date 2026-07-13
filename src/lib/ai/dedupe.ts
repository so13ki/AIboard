const SYNONYM_GROUPS = [
  ["達成条件", "判定基準", "評価基準", "進捗条件", "ステージ条件", "合格条件"],
  ["運用負荷", "現場負荷", "追加作業", "業務負荷", "手間"],
  ["システム化", "web化", "自動化", "アプリ化", "開発"],
  ["ブランド", "イメージ", "毀損"],
  ["roi", "収益", "回収", "利益"],
  ["安全", "事故", "怪我", "リスク"],
];

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[「」『』【】（）()［］\[\]"'`]/g, "")
    .replace(/[、。．，,.!?！？:：;；]/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

function tokenSet(input: string): Set<string> {
  const normalized = normalizeText(input);
  const tokens = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    tokens.add(normalized.slice(i, i + 2));
  }
  if (normalized.length > 0) tokens.add(normalized);
  return tokens;
}

export function similarityScore(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return (2 * intersection) / (left.size + right.size);
}

function sharesSynonymGroup(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return SYNONYM_GROUPS.some((group) => {
    const hitA = group.some((word) => na.includes(normalizeText(word)));
    const hitB = group.some((word) => nb.includes(normalizeText(word)));
    return hitA && hitB;
  });
}

export function isSimilarPoint(a: string, b: string, threshold = 0.45): boolean {
  if (!a.trim() || !b.trim()) return false;
  if (normalizeText(a) === normalizeText(b)) return true;
  if (similarityScore(a, b) >= threshold) return true;
  // Same synonym cluster (e.g. 達成条件 / 判定基準 / 評価基準) counts as one issue.
  if (sharesSynonymGroup(a, b)) return true;
  return false;
}

export function dedupeStrings(items: string[], threshold = 0.45): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (!item.trim()) continue;
    const duplicate = result.some((existing) => isSimilarPoint(existing, item, threshold));
    if (!duplicate) result.push(item);
  }
  return result;
}

export type ReviewLike = {
  biggestConcern?: string;
  questions?: string[];
  revisionProposals?: string[];
  concerns?: Array<{ concern?: string }>;
  improvements?: Array<{ proposal?: string }>;
};

export function collectPriorPoints(reviews: ReviewLike[]): string[] {
  const points: string[] = [];
  for (const review of reviews) {
    if (review.biggestConcern) points.push(review.biggestConcern);
    if (review.questions) points.push(...review.questions);
    if (review.revisionProposals) points.push(...review.revisionProposals);
    if (review.concerns) {
      for (const c of review.concerns) {
        if (c.concern) points.push(c.concern);
      }
    }
    if (review.improvements) {
      for (const i of review.improvements) {
        if (i.proposal) points.push(i.proposal);
      }
    }
  }
  return dedupeStrings(points);
}

/** Soft post-process: drop questions/proposals that overlap prior reviews. */
export function reduceReviewOverlap<T extends ReviewLike>(
  review: T,
  priorReviews: ReviewLike[],
): T {
  const prior = collectPriorPoints(priorReviews);
  const keepUnique = (items: string[] | undefined, limit: number) => {
    if (!items) return [];
    const filtered = items.filter(
      (item) => !prior.some((p) => isSimilarPoint(p, item)),
    );
    return dedupeStrings(filtered).slice(0, limit);
  };

  const questions = keepUnique(review.questions, 2);
  const revisionProposals = keepUnique(review.revisionProposals, 2);

  let biggestConcern = review.biggestConcern ?? "";
  if (
    biggestConcern &&
    prior.some((p) => isSimilarPoint(p, biggestConcern)) &&
    questions[0]
  ) {
    biggestConcern = questions[0];
  }

  const concerns = (review.concerns ?? [])
    .filter((c) => c.concern && !prior.some((p) => isSimilarPoint(p, c.concern!)))
    .slice(0, 2);
  const improvements = (review.improvements ?? [])
    .filter(
      (i) => i.proposal && !prior.some((p) => isSimilarPoint(p, i.proposal!)),
    )
    .slice(0, 2);

  return {
    ...review,
    biggestConcern:
      biggestConcern || concerns[0]?.concern || review.biggestConcern || "",
    questions: questions.length ? questions : (review.questions ?? []).slice(0, 1),
    revisionProposals:
      revisionProposals.length
        ? revisionProposals
        : (review.revisionProposals ?? []).slice(0, 1),
    concerns: concerns.length ? concerns : review.concerns,
    improvements: improvements.length ? improvements : review.improvements,
  };
}

const WEAK_REBUTTAL_PATTERNS = [
  /妥当/,
  /同意する/,
  /重要である/,
  /さらに検討/,
  /詳細が不足/,
  /自分の視点も必要/,
  /参考になる/,
  /だけでなく/,
  /も重要/,
  /追加で検討/,
  /視点も必要/,
  /具体化が必要/,
  /妥当だが/,
  /同意できるが/,
];

const VALUE_CUTTING_PATTERNS = [
  /配慮を最小/,
  /配慮を削/,
  /対象を狭め/,
  /競技志向でない.*削/,
  /非競技.*除外/,
  /安全性を.*削/,
  /顧客価値を.*削/,
  /劣等感.*無視/,
  /居場所.*不要/,
  /公平性を犠牲/,
];

export function isWeakRebuttalText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 24) return true;

  const weakHits = WEAK_REBUTTAL_PATTERNS.filter((pattern) =>
    pattern.test(trimmed),
  ).length;

  const hasConcreteCounter =
    /前提.*(誤り|違う|誤っ)|優先順位.*(逆|違う)|副作用|過剰|代替案|ではなく|今は.*(後|試行)|AかB|か、/.test(
      trimmed,
    );

  // Pure supplement style is always weak.
  if (
    /だけでなく/.test(trimmed) ||
    /も重要/.test(trimmed) ||
    /追加で検討/.test(trimmed) ||
    /視点も必要/.test(trimmed)
  ) {
    if (!hasConcreteCounter) return true;
  }

  return weakHits >= 1 && !hasConcreteCounter;
}

export function isValueCuttingAlternative(text: string): boolean {
  return VALUE_CUTTING_PATTERNS.some((pattern) => pattern.test(text));
}

export function looksLikeChoiceConflict(text: string): boolean {
  return /か|または|ではなく|優先|今実施|試行後|標準化|柔軟/.test(text);
}
