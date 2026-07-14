import { isSimilarPoint } from "@/lib/ai/dedupe";

/** Display labels for role keys (UI + system notices). */
export const ROLE_DISPLAY_LABELS: Record<string, string> = {
  ceo: "CEO",
  cfo: "CFO",
  marketing: "マーケティング責任者",
  operations: "現場責任者",
  cto: "CTO",
  customer: "顧客代表",
  redteam: "レッドチーム",
  quality_balancer: "Quality Balancer",
};

const ROLE_MENTION_RULES: Array<[RegExp, string]> = [
  [/マーケ(?:ティング)?(?:責任者)?|訴求|獲得/, "marketing"],
  [/\bCFO\b|財務|ROI|利益責任/, "cfo"],
  [/\bCTO\b|技術責任|システム責任|開発責任/, "cto"],
  [/現場責任者|オペレーション|運用責任/, "operations"],
  [/顧客代表|顧客心理/, "customer"],
  [/レッドチーム|反対役|悪魔の代弁/, "redteam"],
  [/バランサ|Quality\s*Balancer|Simply/, "quality_balancer"],
  [/\bCEO\b|議長|司会/, "ceo"],
];

export type NominationSource =
  | "proposer_explicit"
  | "ceo_explicit"
  | "addressed_officer"
  | "auto_router"
  | "missing_perspective"
  | "anti_bounce";

export type ExplicitNomination = {
  roleKey: string;
  source: "proposer_explicit" | "ceo_explicit" | "addressed_officer";
  evidence: string;
};

export type TargetType =
  | "proposer"
  | "executive"
  | "chair"
  | "all"
  | "none";

export type NormalizedAddress = {
  targetType: TargetType;
  targetParticipantId: string | null;
  /** Legacy mirror for older UI / debugger */
  addressTo: "proposer" | "officer" | "all" | "none";
  addressRoleKey: string | null;
};

export function roleDisplayLabel(roleKey: string | null | undefined): string {
  if (!roleKey) return "";
  return ROLE_DISPLAY_LABELS[roleKey] ?? roleKey;
}

/** Detect an officer (or ceo) role mentioned in free text. */
export function detectExplicitRoleInText(
  text: string,
  availableRoleKeys: string[],
): string | null {
  if (!text.trim()) return null;
  for (const [re, role] of ROLE_MENTION_RULES) {
    if (!re.test(text)) continue;
    if (role === "ceo") return "ceo";
    if (availableRoleKeys.includes(role)) return role;
  }
  return null;
}

/**
 * Proposer handed the floor to an officer ("マーケの意見を聞きたい" etc.).
 */
export function detectProposerExplicitNomination(
  text: string,
  availableRoleKeys: string[],
): string | null {
  if (!/(聞きたい|聞いて|意見|どう思う|振って|回して|話して|お願い)/.test(text)) {
    return null;
  }
  const role = detectExplicitRoleInText(text, availableRoleKeys);
  if (!role || role === "ceo") return null;
  return role;
}

/**
 * CEO chair utterance / nominateReason / nextSpeakerRoleKey → explicit pick.
 * Requires a naming signal in speech (or nominateReason), not a bare key alone —
 * otherwise every auto-filled nextSpeakerRoleKey would lock the router.
 */
export function detectCeoExplicitNomination(args: {
  nextSpeakerRoleKey: string | null | undefined;
  chairUtterance: string | null | undefined;
  nominateReason: string | null | undefined;
  availableRoleKeys: string[];
}): ExplicitNomination | null {
  const {
    nextSpeakerRoleKey,
    chairUtterance,
    nominateReason,
    availableRoleKeys,
  } = args;

  const blob = `${chairUtterance ?? ""} ${nominateReason ?? ""}`;
  const fromText = detectExplicitRoleInText(blob, availableRoleKeys);
  const named = fromText && fromText !== "ceo" ? fromText : null;
  const fromKey =
    nextSpeakerRoleKey && availableRoleKeys.includes(nextSpeakerRoleKey)
      ? nextSpeakerRoleKey
      : null;

  const namingSignal =
    /お願い|意見を|指名|話して(?:ください|くれ)|聞いて|視点で|責任者の/.test(
      blob,
    );

  if (named && (namingSignal || /マーケ|CFO|CTO|現場|顧客|レッド|バランサ/.test(blob))) {
    return {
      roleKey: named,
      source: "ceo_explicit",
      evidence: (chairUtterance || nominateReason || named).slice(0, 80),
    };
  }
  if (fromKey && namingSignal) {
    return {
      roleKey: fromKey,
      source: "ceo_explicit",
      evidence: (chairUtterance || nominateReason || fromKey).slice(0, 80),
    };
  }
  return null;
}

export function detectAddressedOfficerInUtterance(
  text: string,
  availableRoleKeys: string[],
  speakerRoleKey: string | null,
): string | null {
  const role = detectExplicitRoleInText(text, availableRoleKeys);
  if (!role || role === "ceo") return null;
  if (speakerRoleKey && role === speakerRoleKey) return null;
  if (!/[？?]|どう思う|意見|反論|どうです|お願い/.test(text)) return null;
  return role;
}

type MsgLike = {
  speakerType?: string;
  roleKey?: string | null;
  text?: string;
  addressTo?: string;
  addressRoleKey?: string | null;
  targetType?: string;
  targetParticipantId?: string | null;
};

/**
 * Priority:
 * 1. Proposer explicit
 * 2. CEO explicit
 * 3. Officer addressed in last utterance
 * 4. autoCandidate (content / issue router)
 * 5. missingPerspectivePick
 *
 * Never let (4)(5) overwrite (1)(2)(3) without overrideReason.
 */
export function resolveNextSpeaker(args: {
  availableRoleKeys: string[];
  messages: MsgLike[];
  facilitatorNextSpeaker: string | null;
  chairUtterance: string | null;
  nominateReason: string;
  autoCandidate: string | null;
  missingPerspectivePick: string | null;
  askerRole: string | null;
}): {
  roleKey: string | null;
  source: NominationSource;
  locked: boolean;
  overrideReason: string | null;
} {
  const available = args.availableRoleKeys;

  let lastProposerText: string | null = null;
  for (let i = args.messages.length - 1; i >= 0; i -= 1) {
    const m = args.messages[i]!;
    if (m.speakerType === "proposer" || m.speakerType === "user") {
      lastProposerText = m.text ?? null;
      break;
    }
    if (m.speakerType === "board_member" || m.speakerType === "executive") {
      break;
    }
  }

  const proposerHit = lastProposerText
    ? detectProposerExplicitNomination(lastProposerText, available)
    : null;
  if (proposerHit) {
    return lockOrAntiBounce(proposerHit, "proposer_explicit", args.askerRole, available);
  }

  const ceoHit = detectCeoExplicitNomination({
    nextSpeakerRoleKey: args.facilitatorNextSpeaker,
    chairUtterance: args.chairUtterance,
    nominateReason: args.nominateReason,
    availableRoleKeys: available,
  });
  if (ceoHit) {
    return lockOrAntiBounce(
      ceoHit.roleKey,
      "ceo_explicit",
      args.askerRole,
      available,
    );
  }

  const lastOfficer = [...args.messages]
    .reverse()
    .find(
      (m) =>
        (m.speakerType === "board_member" || m.speakerType === "executive") &&
        m.text,
    );
  if (lastOfficer?.text) {
    const addressed =
      (lastOfficer.targetType === "executive" &&
        lastOfficer.targetParticipantId &&
        available.includes(lastOfficer.targetParticipantId)
        ? lastOfficer.targetParticipantId
        : null) ||
      (lastOfficer.addressTo === "officer" &&
      lastOfficer.addressRoleKey &&
      available.includes(lastOfficer.addressRoleKey)
        ? lastOfficer.addressRoleKey
        : null) ||
      detectAddressedOfficerInUtterance(
        lastOfficer.text,
        available,
        lastOfficer.roleKey ?? null,
      );
    if (addressed) {
      return lockOrAntiBounce(
        addressed,
        "addressed_officer",
        args.askerRole,
        available,
      );
    }
  }

  const auto =
    args.autoCandidate && available.includes(args.autoCandidate)
      ? args.autoCandidate
      : null;
  if (auto && auto !== args.askerRole) {
    return {
      roleKey: auto,
      source: "auto_router",
      locked: false,
      overrideReason: null,
    };
  }

  const missing =
    args.missingPerspectivePick &&
    available.includes(args.missingPerspectivePick) &&
    args.missingPerspectivePick !== args.askerRole
      ? args.missingPerspectivePick
      : null;
  if (missing) {
    return {
      roleKey: missing,
      source: "missing_perspective",
      locked: false,
      overrideReason: null,
    };
  }

  return {
    roleKey: null,
    source: "auto_router",
    locked: false,
    overrideReason: null,
  };
}

function lockOrAntiBounce(
  roleKey: string,
  source: NominationSource,
  askerRole: string | null,
  available: string[],
): {
  roleKey: string | null;
  source: NominationSource;
  locked: boolean;
  overrideReason: string | null;
} {
  if (!available.includes(roleKey)) {
    return {
      roleKey: null,
      source,
      locked: false,
      overrideReason: null,
    };
  }
  // Anti-bounce: never make the person who just spoke speak again via lock
  if (askerRole && roleKey === askerRole) {
    return {
      roleKey: null,
      source: "anti_bounce",
      locked: false,
      overrideReason: `${roleDisplayLabel(roleKey)}は直前に発言したため、先に別視点で補足します。`,
    };
  }
  return {
    roleKey,
    source,
    locked: true,
    overrideReason: null,
  };
}

/** Unique-fact / intent questions that only the proposer can answer. */
export function isProposerUniqueFactQuestion(text: string): boolean {
  return /想定して(います|いる)|意図|方針|決めて|認める|認めたい|例外を|前提として|予算上限|正式|未提示|合意|修正案|どちらを選/.test(
    text,
  );
}

/** Soft debate questions officers can answer among themselves. */
export function isOfficerDebatableQuestion(text: string): boolean {
  return /増えませんか|問題に(なりません|なる)|どうでしょう|懸念|リスク|負荷|運用上|例外対応が増え/.test(
    text,
  );
}

/**
 * Normalize LLM address fields into targetType + legacy addressTo.
 * Suppresses spurious "→ 企画者" when the question is officer-debatable.
 */
export function normalizeUtteranceAddress(args: {
  text: string;
  moveType: string;
  speakerRoleKey: string;
  availableRoleKeys: string[];
  addressTo?: string | null;
  addressRoleKey?: string | null;
  targetType?: string | null;
  targetParticipantId?: string | null;
  /** Role CEO just nominated — answering them → chair/all */
  answeringCeoNomination?: boolean;
}): NormalizedAddress {
  const text = args.text.trim();
  const available = args.availableRoleKeys;

  let targetType: TargetType | null =
    args.targetType === "proposer" ||
    args.targetType === "executive" ||
    args.targetType === "chair" ||
    args.targetType === "all" ||
    args.targetType === "none"
      ? args.targetType
      : null;
  let targetParticipantId =
    args.targetParticipantId && available.includes(args.targetParticipantId)
      ? args.targetParticipantId
      : args.addressRoleKey && available.includes(args.addressRoleKey)
        ? args.addressRoleKey
        : null;

  if (!targetType) {
    if (args.addressTo === "proposer") targetType = "proposer";
    else if (args.addressTo === "officer") targetType = "executive";
    else if (args.addressTo === "all") targetType = "all";
    else if (args.addressTo === "none") targetType = "none";
  }

  const mentioned = detectExplicitRoleInText(text, available);
  const asksQuestion = /[？?]/.test(text) || args.moveType === "question";

  // Counter / challenge aimed at a named officer
  if (
    !targetType &&
    mentioned &&
    mentioned !== "ceo" &&
    mentioned !== args.speakerRoleKey &&
    (args.moveType === "counter" ||
      args.moveType === "challenge_premise" ||
      /反論|対して|その点/.test(text))
  ) {
    targetType = "executive";
    targetParticipantId = mentioned;
  }

  if (!targetType && mentioned === "ceo" && asksQuestion) {
    targetType = "chair";
  }

  if (!targetType && mentioned && mentioned !== args.speakerRoleKey && asksQuestion) {
    targetType = "executive";
    targetParticipantId = mentioned;
  }

  // Answering CEO nomination without a clear addressee → all (not proposer)
  if (!targetType && args.answeringCeoNomination) {
    targetType =
      args.moveType === "question" && isProposerUniqueFactQuestion(text)
        ? "proposer"
        : "all";
  }

  // Spurious proposer: officer-debatable → all/none
  if (targetType === "proposer") {
    if (
      asksQuestion &&
      isOfficerDebatableQuestion(text) &&
      !isProposerUniqueFactQuestion(text)
    ) {
      targetType = "all";
      targetParticipantId = null;
    } else if (!asksQuestion && args.moveType !== "question") {
      // Opinion labeled as proposer by mistake
      if (!/企画者/.test(text)) {
        targetType =
          args.moveType === "alternative" ||
          args.moveType === "expand" ||
          args.moveType === "accept" ||
          args.moveType === "advance"
            ? "all"
            : "none";
      }
    }
  }

  // Default by moveType
  if (!targetType) {
    if (args.moveType === "question" && isProposerUniqueFactQuestion(text)) {
      targetType = "proposer";
    } else if (
      args.moveType === "counter" &&
      targetParticipantId
    ) {
      targetType = "executive";
    } else if (
      args.moveType === "alternative" ||
      args.moveType === "expand" ||
      args.moveType === "accept" ||
      args.moveType === "advance" ||
      args.moveType === "brake"
    ) {
      targetType = "all";
    } else {
      targetType = "none";
    }
  }

  if (targetType === "executive" && !targetParticipantId && mentioned && mentioned !== "ceo") {
    targetParticipantId = mentioned;
  }
  if (targetType !== "executive") {
    if (targetType === "proposer" || targetType === "chair") {
      targetParticipantId = null;
    }
  }

  return toLegacyMirror(targetType, targetParticipantId);
}

function toLegacyMirror(
  targetType: TargetType,
  targetParticipantId: string | null,
): NormalizedAddress {
  if (targetType === "proposer") {
    return {
      targetType,
      targetParticipantId: null,
      addressTo: "proposer",
      addressRoleKey: null,
    };
  }
  if (targetType === "executive") {
    return {
      targetType,
      targetParticipantId,
      addressTo: "officer",
      addressRoleKey: targetParticipantId,
    };
  }
  if (targetType === "chair") {
    return {
      targetType,
      targetParticipantId: null,
      addressTo: "all",
      addressRoleKey: null,
    };
  }
  if (targetType === "all") {
    return {
      targetType,
      targetParticipantId: null,
      addressTo: "all",
      addressRoleKey: null,
    };
  }
  return {
    targetType: "none",
    targetParticipantId: null,
    addressTo: "none",
    addressRoleKey: null,
  };
}

/** Arrow label for UI — null means hide arrow. */
export function addressArrowLabel(args: {
  targetType?: string | null;
  targetParticipantId?: string | null;
  addressTo?: string | null;
  addressRoleKey?: string | null;
}): string | null {
  let type = args.targetType ?? null;
  let pid = args.targetParticipantId ?? null;
  if (!type) {
    if (args.addressTo === "proposer") type = "proposer";
    else if (args.addressTo === "officer") {
      type = "executive";
      pid = pid ?? args.addressRoleKey ?? null;
    } else if (args.addressTo === "all" || args.addressTo === "none") {
      return null;
    } else {
      return null;
    }
  }
  if (type === "proposer") return "→ 企画者";
  if (type === "executive") {
    const key = pid ?? args.addressRoleKey;
    return key ? `→ ${roleDisplayLabel(key)}` : null;
  }
  if (type === "chair") return "→ CEO";
  return null;
}

/** Short system line when overriding an explicit nomination. */
export function formatNominationOverrideNotice(
  intendedRoleKey: string,
  actualRoleKey: string,
  reason: string,
): string {
  return `${roleDisplayLabel(actualRoleKey)}が関連する点を先に補足します。（${reason.replace(/。$/, "")}／指名は${roleDisplayLabel(intendedRoleKey)}）`;
}

/** Similarity helper for tests / guards */
export function sameNominationIntent(a: string, b: string): boolean {
  return isSimilarPoint(a, b, 0.5);
}
