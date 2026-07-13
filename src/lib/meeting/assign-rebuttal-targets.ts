import type { Stance } from "@/lib/meeting/constants";

export type RebuttalCandidate = {
  memberId: string;
  memberTitle: string;
  roleKey: string;
  stance: string;
  biggestConcern: string;
  revisionProposals: string[];
  priorities: string[];
};

const STANCE_WEIGHT: Record<string, number> = {
  approve: 3,
  conditional: 2,
  hold: 1,
  reject: 0,
};

function stanceDistance(a: string, b: string): number {
  return Math.abs((STANCE_WEIGHT[a] ?? 1.5) - (STANCE_WEIGHT[b] ?? 1.5));
}

function proposalConflictScore(self: RebuttalCandidate, other: RebuttalCandidate): number {
  const selfText = [...self.revisionProposals, ...self.priorities].join(" ");
  const otherText = [other.biggestConcern, ...other.revisionProposals].join(" ");
  if (!selfText || !otherText) return 0;

  const conflictPairs: Array<[RegExp, RegExp]> = [
    [/紙|手動|試行/, /システム|web|自動|開発/i],
    [/継続|解約|ltv/i, /独立収益|新規売上|roi/i],
    [/配慮|居場所|公平/, /競技|上位|大会/],
    [/負荷|運用/, /詳細|厳密|標準化/],
  ];

  let score = 0;
  for (const [left, right] of conflictPairs) {
    if (
      (left.test(selfText) && right.test(otherText)) ||
      (right.test(selfText) && left.test(otherText))
    ) {
      score += 1;
    }
  }
  return score;
}

/**
 * Assign one rebuttal target per speaker.
 * Prefer different stance / priority / conflicting proposals,
 * and keep any single target at most twice.
 */
export function assignRebuttalTargets(
  candidates: RebuttalCandidate[],
  maxPerTarget = 2,
): Map<string, string> {
  const assignments = new Map<string, string>();
  const targetCounts = new Map<string, number>();

  // Speakers with clearer minority stances first, so they claim scarce targets.
  const speakers = [...candidates].sort((a, b) => {
    const aRare = candidates.filter((c) => c.stance === a.stance).length;
    const bRare = candidates.filter((c) => c.stance === b.stance).length;
    return aRare - bRare;
  });

  for (const speaker of speakers) {
    let bestId: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const target of candidates) {
      if (target.memberId === speaker.memberId) continue;
      const used = targetCounts.get(target.memberId) ?? 0;
      if (used >= maxPerTarget) continue;

      const differentStance = stanceDistance(speaker.stance, target.stance);
      const differentRole = speaker.roleKey === target.roleKey ? 0 : 1;
      const conflict = proposalConflictScore(speaker, target);
      const scarcity = maxPerTarget - used;

      // Priority: different judgment > conflict > role/priority difference > untargeted
      const score =
        differentStance * 100 +
        conflict * 40 +
        differentRole * 20 +
        scarcity * 35 +
        // slight preference to challenge redteam less once already targeted
        (target.roleKey === "redteam" ? -15 * used : 0);

      if (score > bestScore) {
        bestScore = score;
        bestId = target.memberId;
      }
    }

    // Fallback: any remaining under-cap target
    if (!bestId) {
      const fallback = candidates.find(
        (c) =>
          c.memberId !== speaker.memberId &&
          (targetCounts.get(c.memberId) ?? 0) < maxPerTarget,
      );
      bestId = fallback?.memberId ?? null;
    }

    if (!bestId) {
      const anyOther = candidates.find((c) => c.memberId !== speaker.memberId);
      bestId = anyOther?.memberId ?? speaker.memberId;
    }

    assignments.set(speaker.memberId, bestId);
    targetCounts.set(bestId, (targetCounts.get(bestId) ?? 0) + 1);
  }

  return assignments;
}

export function asStance(value: unknown): Stance | string {
  if (
    value === "approve" ||
    value === "conditional" ||
    value === "reject" ||
    value === "hold"
  ) {
    return value;
  }
  return "hold";
}
