/**
 * Free-form theme + issue facilitation (no fixed discussion order).
 * CEO manages: current theme, unresolved issues, resolved issues.
 * Within a theme, all officers speak from their specialty — never role-exclusive.
 */

export type ThemePerspectiveHints = Record<string, string>;

/**
 * Soft hints for officer angles on ANY theme (esp. 利益).
 * Not exclusivity — every role may speak on the current theme.
 */
export const DEFAULT_PERSPECTIVE_HINTS: ThemePerspectiveHints = {
  cfo: "収益性・損失上限・回収構造",
  marketing: "顧客獲得・継続率・訴求による売上増",
  customer: "支払意思・納得感・継続利用意向",
  cto: "開発費・改修コスト・保守負荷",
  operations: "運用コスト・追加工数・例外対応",
  quality_balancer: "過剰投資・検証コスト・今は不要な精緻化",
  redteam: "最悪ケース・利益毀損・想定外コスト",
};

/** Preferred rotation order when theme looks profit-related. */
export const PROFIT_PERSPECTIVE_ORDER = [
  "cfo",
  "marketing",
  "customer",
  "cto",
  "operations",
  "redteam",
  "quality_balancer",
] as const;

export function normalizeThemeLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().slice(0, 40);
  return t || "利益性";
}

export function isProfitLikeTheme(themeLabel: string | null | undefined): boolean {
  const t = (themeLabel ?? "").toLowerCase();
  return /(利益|roi|収益|回収|コスト|費用|価格|損益|予算)/i.test(t);
}

export function perspectiveHint(roleKey: string): string {
  return DEFAULT_PERSPECTIVE_HINTS[roleKey] ?? "専門分野からの視点";
}

/**
 * Pick next speaker for multi-perspective progress (NOT theme→role lock).
 * Priority:
 * 1. avoid asker / avoidRoleKey
 * 2. avoid consecutive same speaker
 * 3. prefer roles missing from recent window
 * 4. for profit-like themes, rotate PROFIT_PERSPECTIVE_ORDER
 */
export function pickPerspectiveOfficer(args: {
  availableRoleKeys: string[];
  recentRoleKeys: string[];
  avoidRoleKey?: string | null;
  themeLabel?: string | null;
  /** If set, never pick this role (e.g. over-monopoly) */
  banRoleKey?: string | null;
}): string | null {
  const {
    availableRoleKeys,
    recentRoleKeys,
    avoidRoleKey,
    themeLabel,
    banRoleKey,
  } = args;
  if (availableRoleKeys.length === 0) return null;

  const last = recentRoleKeys[recentRoleKeys.length - 1] ?? null;
  const recentWindow = recentRoleKeys.slice(-6);
  const counts = new Map<string, number>();
  for (const r of recentWindow) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  const eligible = availableRoleKeys.filter(
    (r) => r !== avoidRoleKey && r !== banRoleKey && r !== last,
  );
  const pool = eligible.length > 0 ? eligible : availableRoleKeys.filter((r) => r !== avoidRoleKey);
  if (pool.length === 0) return availableRoleKeys[0] ?? null;

  // Prefer never-spoken / least spoken in window
  const sortedByScarcity = [...pool].sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca !== cb) return ca - cb;
    return 0;
  });

  if (isProfitLikeTheme(themeLabel)) {
    const order = PROFIT_PERSPECTIVE_ORDER.filter((r) => pool.includes(r));
    const missing = order.find((r) => !recentWindow.includes(r));
    if (missing) return missing;
    const least = order.sort(
      (a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0),
    )[0];
    if (least) return least;
  }

  return sortedByScarcity[0] ?? pool[0] ?? null;
}

/** @deprecated use pickPerspectiveOfficer — kept for call-site migration */
export function pickAnyOfficer(
  availableRoleKeys: string[],
  recentRoleKeys: string[],
  avoidRoleKey?: string | null,
  themeLabel?: string | null,
): string | null {
  return pickPerspectiveOfficer({
    availableRoleKeys,
    recentRoleKeys,
    avoidRoleKey,
    themeLabel,
  });
}

/** True when one role dominates the current theme discussion. */
export function detectThemeMonopoly(args: {
  recentRoleKeys: string[];
  threshold?: number;
}): { monopolized: boolean; roleKey: string | null; count: number } {
  const threshold = args.threshold ?? 3;
  const window = args.recentRoleKeys.slice(-8);
  if (window.length < threshold) {
    return { monopolized: false, roleKey: null, count: 0 };
  }
  const counts = new Map<string, number>();
  for (const r of window) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let top: string | null = null;
  let topCount = 0;
  for (const [r, c] of counts) {
    if (c > topCount) {
      top = r;
      topCount = c;
    }
  }
  const unique = new Set(window).size;
  const othersSilent = unique <= 2 && topCount >= threshold;
  return {
    monopolized: topCount >= threshold || othersSilent,
    roleKey: top,
    count: topCount,
  };
}

/** CEO broaden nudge when discussion stalls or monopolizes. */
export function broadenPerspectiveUtterance(
  themeLabel: string,
  nextRoleKey: string,
  roleTitleHint?: string,
): string {
  const angle = perspectiveHint(nextRoleKey);
  const who = roleTitleHint ?? nextRoleKey;
  return `${who}の視点（${angle}）ではどうですか？テーマ「${themeLabel}」を専門から。`.slice(
    0,
    150,
  );
}

export function formatThemePerspectivesForPrompt(themeLabel: string): string {
  const lines = Object.entries(DEFAULT_PERSPECTIVE_HINTS).map(
    ([role, angle]) => `- ${role}: ${angle}`,
  );
  return [
    `現在のテーマ「${themeLabel}」は会議全体の論点。特定役職の専有ではない。`,
    "テーマは1つ、視点は複数。全役員が自分の専門からこのテーマへ貢献する。",
    "悪い例: 利益テーマ → CFOだけ。良い例: 利益テーマ → CFO/マーケ/顧客/CTO/現場/…が交差。",
    ...lines,
  ].join("\n");
}

export function dedupeIssueLabels(items: string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const label = raw.trim().slice(0, 80);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/** Legacy enum ids → Japanese theme labels (migration). */
const LEGACY_THEME_LABELS: Record<string, string> = {
  profit: "利益性",
  customer: "顧客",
  operations: "運用",
  brand: "ブランド",
};

export function migrateThemeLabel(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "利益性";
  const t = raw.trim();
  return LEGACY_THEME_LABELS[t] ?? normalizeThemeLabel(t);
}

/** Pick next theme from unresolved issue labels (CEO priority order). */
export function pickNextThemeFromIssues(
  unresolved: string[],
  currentTheme?: string | null,
): string | null {
  const cur = (currentTheme ?? "").trim();
  const next = unresolved.find((label) => label.trim() && label.trim() !== cur);
  return next ? normalizeThemeLabel(next) : null;
}

export function themeCloseUtterance(themeLabel: string): string {
  return `「${themeLabel}」については概ね整理できました。`.slice(0, 150);
}
