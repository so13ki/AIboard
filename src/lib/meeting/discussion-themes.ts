/**
 * Single-theme facilitation: discuss one theme at a time in fixed order.
 * 利益 → 顧客 → 運用 → ブランド
 */

export const DISCUSSION_THEME_IDS = [
  "profit",
  "customer",
  "operations",
  "brand",
] as const;

export type DiscussionThemeId = (typeof DISCUSSION_THEME_IDS)[number];

export type DiscussionThemeDef = {
  id: DiscussionThemeId;
  /** Short UI / CEO label */
  label: string;
  /** Alternate labels for matching openTopics / speech */
  aliases: string[];
  /** Officers who lead this theme (proposer may still be asked for facts) */
  focusRoleKeys: string[];
  /** Keywords that belong to this theme */
  keywords: RegExp;
};

export const DISCUSSION_THEMES: DiscussionThemeDef[] = [
  {
    id: "profit",
    label: "利益・ROI",
    aliases: ["利益", "ROI", "roi", "価格", "売上", "コスト", "粗利"],
    focusRoleKeys: ["cfo", "cto"],
    keywords:
      /利益|ROI|roi|粗利|売上|価格|値段|コスト|費用|回収|損益|無料|有料|単価|仮説|価値|差別化|方向性/,
  },
  {
    id: "customer",
    label: "顧客",
    aliases: ["顧客", "顧客心理", "ユーザー", "利用者"],
    focusRoleKeys: ["customer", "marketing"],
    keywords:
      /顧客心理|使いた|分かりやす|不快|強制感|劣等感|本音|ユーザー|利用者|顧客/,
  },
  {
    id: "operations",
    label: "運用",
    aliases: ["運用", "現場", "スタッフ", "マニュアル"],
    focusRoleKeys: ["operations", "cto"],
    keywords:
      /運用|現場|スタッフ|マニュアル|オペレーション|シフト|負荷|教育|動線|混雑/,
  },
  {
    id: "brand",
    label: "ブランド",
    aliases: ["ブランド", "訴求", "マーケ", "認知"],
    focusRoleKeys: ["marketing", "customer"],
    keywords: /ブランド|訴求|獲得|口コミ|マーケ|認知|イメージ|毀損/,
  },
];

export function isDiscussionThemeId(value: unknown): value is DiscussionThemeId {
  return (
    typeof value === "string" &&
    (DISCUSSION_THEME_IDS as readonly string[]).includes(value)
  );
}

export function themeDef(id: DiscussionThemeId): DiscussionThemeDef {
  return DISCUSSION_THEMES.find((t) => t.id === id) ?? DISCUSSION_THEMES[0]!;
}

export function nextThemeId(
  current: DiscussionThemeId,
  closed: DiscussionThemeId[],
): DiscussionThemeId | null {
  const closedSet = new Set(closed);
  const start = DISCUSSION_THEME_IDS.indexOf(current);
  for (let i = start + 1; i < DISCUSSION_THEME_IDS.length; i += 1) {
    const id = DISCUSSION_THEME_IDS[i]!;
    if (!closedSet.has(id)) return id;
  }
  // Any remaining unclosed before end
  for (const id of DISCUSSION_THEME_IDS) {
    if (!closedSet.has(id) && id !== current) return id;
  }
  return null;
}

export function firstOpenTheme(
  closed: DiscussionThemeId[],
): DiscussionThemeId | null {
  const closedSet = new Set(closed);
  return DISCUSSION_THEME_IDS.find((id) => !closedSet.has(id)) ?? null;
}

/** Detect which theme a utterance belongs to (null if unclear). */
export function detectThemeFromText(text: string): DiscussionThemeId | null {
  const hits: DiscussionThemeId[] = [];
  for (const theme of DISCUSSION_THEMES) {
    if (theme.keywords.test(text)) hits.push(theme.id);
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  // Prefer earlier themes in the sequence when ambiguous
  for (const id of DISCUSSION_THEME_IDS) {
    if (hits.includes(id)) return id;
  }
  return hits[0]!;
}

export function pickFocusSpeaker(
  themeId: DiscussionThemeId,
  availableRoleKeys: string[],
  avoidRoleKey?: string | null,
): string | null {
  const focus = themeDef(themeId).focusRoleKeys;
  for (const role of focus) {
    if (availableRoleKeys.includes(role) && role !== avoidRoleKey) return role;
  }
  return (
    availableRoleKeys.find((r) => r !== avoidRoleKey) ??
    availableRoleKeys[0] ??
    null
  );
}

export function themesAllClosed(closed: DiscussionThemeId[]): boolean {
  return DISCUSSION_THEME_IDS.every((id) => closed.includes(id));
}
