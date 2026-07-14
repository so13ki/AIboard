/**
 * Speaker routing + address targetType regression tests.
 */
import assert from "node:assert/strict";
import {
  addressArrowLabel,
  detectCeoExplicitNomination,
  normalizeUtteranceAddress,
  resolveNextSpeaker,
} from "../src/lib/meeting/speaker-routing";

const available = [
  "cfo",
  "marketing",
  "operations",
  "cto",
  "customer",
  "redteam",
  "quality_balancer",
];

{
  // CEO names marketing → next speaker is marketing (locked)
  const ceo = detectCeoExplicitNomination({
    nextSpeakerRoleKey: "marketing",
    chairUtterance:
      "カード利用促進についてマーケティング責任者の意見をお願いします。",
    nominateReason: "マーケ視点が必要",
    availableRoleKeys: available,
  });
  assert.equal(ceo?.roleKey, "marketing");

  const resolved = resolveNextSpeaker({
    availableRoleKeys: available,
    messages: [],
    facilitatorNextSpeaker: "marketing",
    chairUtterance:
      "カード利用促進についてマーケティング責任者の意見をお願いします。",
    nominateReason: "マーケ視点",
    autoCandidate: "cfo", // auto would prefer CFO — must NOT win
    missingPerspectivePick: "cto",
    askerRole: "operations",
  });
  assert.equal(resolved.roleKey, "marketing");
  assert.equal(resolved.locked, true);
  assert.equal(resolved.source, "ceo_explicit");
}

{
  // Proposer explicit beats CEO / auto
  const resolved = resolveNextSpeaker({
    availableRoleKeys: available,
    messages: [
      {
        speakerType: "proposer",
        text: "CTOの技術リスクについて意見を聞きたいです",
      },
    ],
    facilitatorNextSpeaker: "marketing",
    chairUtterance: "マーケお願いします",
    nominateReason: "マーケ",
    autoCandidate: "cfo",
    missingPerspectivePick: "operations",
    askerRole: null,
  });
  assert.equal(resolved.roleKey, "cto");
  assert.equal(resolved.source, "proposer_explicit");
  assert.equal(resolved.locked, true);
}

{
  // Meeting-wide opinion must NOT show → 企画者
  const addr = normalizeUtteranceAddress({
    text: "獲得単価を下げるなら紙クーポン案が現実的だと思います。",
    moveType: "alternative",
    speakerRoleKey: "marketing",
    availableRoleKeys: available,
    addressTo: "proposer", // spurious LLM label
    addressRoleKey: null,
    answeringCeoNomination: true,
  });
  assert.ok(addr.targetType === "all" || addr.targetType === "none");
  assert.equal(
    addressArrowLabel(addr),
    null,
    "no arrow for meeting-wide utterance",
  );
}

{
  // Counter to CFO shows → CFO
  const addr = normalizeUtteranceAddress({
    text: "CFOの回収前提には反論があります。継続率が鍵です。",
    moveType: "counter",
    speakerRoleKey: "marketing",
    availableRoleKeys: available,
    addressTo: "officer",
    addressRoleKey: "cfo",
    targetType: "executive",
    targetParticipantId: "cfo",
  });
  assert.equal(addr.targetType, "executive");
  assert.equal(addr.targetParticipantId, "cfo");
  assert.equal(addressArrowLabel(addr), "→ CFO");
}

{
  // Officer-debatable question remapped away from proposer
  const bad = normalizeUtteranceAddress({
    text: "例外対応が増えませんか？",
    moveType: "question",
    speakerRoleKey: "cto",
    availableRoleKeys: available,
    addressTo: "proposer",
  });
  assert.notEqual(bad.targetType, "proposer");

  const good = normalizeUtteranceAddress({
    text: "例外を認める制度設計を想定していますか？",
    moveType: "question",
    speakerRoleKey: "operations",
    availableRoleKeys: available,
    addressTo: "proposer",
  });
  assert.equal(good.targetType, "proposer");
  assert.equal(addressArrowLabel(good), "→ 企画者");
}

{
  // Auto router fills only when no explicit nomination
  const resolved = resolveNextSpeaker({
    availableRoleKeys: available,
    messages: [],
    facilitatorNextSpeaker: null,
    chairUtterance: null,
    nominateReason: "多視点",
    autoCandidate: "redteam",
    missingPerspectivePick: "customer",
    askerRole: "cfo",
  });
  assert.equal(resolved.roleKey, "redteam");
  assert.equal(resolved.locked, false);
}

console.log("check-speaker-routing: ok");
