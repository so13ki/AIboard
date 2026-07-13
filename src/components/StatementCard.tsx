import { StanceBadge } from "@/components/StanceBadge";
import { STEP_LABELS, type MeetingStep } from "@/lib/meeting/constants";
import { REVIEW_LEVEL_LABELS, type ReviewLevel } from "@/lib/ai/role-focus";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
        {value}
      </p>
    </div>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-stone-800">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const CHAIR_RECOMMENDATION_LABELS: Record<string, string> = {
  approve: "承認",
  conditional: "条件付き承認",
  pilot: "小規模試行",
  hold: "保留",
  reject: "却下",
};

const TRIAGE_TYPE_LABELS: Record<string, string> = {
  important: "この懸念は重要",
  over_quality: "これは過剰品質",
  mvp_unnecessary: "MVPでは不要",
  future_ok: "将来対応で良い",
  side_effect: "副作用あり",
  priority_shift: "優先順位の変更",
  better_alternative: "より良い代替案",
};

const REBUTTAL_TYPE_LABELS: Record<string, string> = {
  ...TRIAGE_TYPE_LABELS,
  deny_premise: "前提の否定",
  reprioritize: "優先順位の変更",
  show_side_effect: "副作用の指摘",
  cheaper_alternative: "低コスト代替案",
  overstated_concern: "過剰懸念の指摘",
  fatal_oversight: "致命的見落とし",
  premise: "前提の否定",
  priority: "優先順位の逆転",
  excessive_requirement: "過剰要求の指摘",
  alternative: "実行可能な代替案",
};

function ConcernList({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">懸念と理由</div>
      <ul className="mt-2 space-y-2">
        {value.map((item, index) => {
          const row = asRecord(item);
          const concern =
            typeof row.concern === "string" ? row.concern : String(item);
          const reason = typeof row.reason === "string" ? row.reason : null;
          return (
            <li
              key={`${concern}-${index}`}
              className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
            >
              <div className="font-medium text-stone-900">{concern}</div>
              {reason ? (
                <p className="mt-1 text-stone-700">理由: {reason}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ImprovementEffectList({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">
        改善案と期待効果
      </div>
      <ul className="mt-2 space-y-2">
        {value.map((item, index) => {
          const row = asRecord(item);
          const proposal =
            typeof row.proposal === "string" ? row.proposal : String(item);
          const effect =
            typeof row.expectedEffect === "string" ? row.expectedEffect : null;
          return (
            <li
              key={`${proposal}-${index}`}
              className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
            >
              <div className="font-medium text-stone-900">{proposal}</div>
              {effect ? (
                <p className="mt-1 text-stone-700">期待効果: {effect}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const DEFER_CATEGORY_LABELS: Record<string, string> = {
  mvp_unnecessary: "MVPでは不要",
  against_simply: "M(Simply)に反する",
  future_phase: "将来フェーズで検討",
  unclear_effect: "効果が不明",
  ops_load: "運用負荷増加",
  other: "その他",
};

function ImprovementList({
  label,
  value,
  showCategory,
}: {
  label: string;
  value: unknown;
  showCategory?: boolean;
}) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <ul className="mt-2 space-y-2">
        {value.map((item, index) => {
          if (typeof item === "string") {
            return (
              <li
                key={`${item}-${index}`}
                className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
              >
                {item}
              </li>
            );
          }
          const row = asRecord(item);
          return (
            <li
              key={`${String(row.proposal)}-${index}`}
              className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
            >
              <p className="font-medium text-stone-900">
                {typeof row.proposal === "string" ? row.proposal : "改善案"}
              </p>
              {typeof row.reason === "string" ? (
                <p className="mt-1 text-stone-700">理由: {row.reason}</p>
              ) : null}
              {typeof row.sourceHint === "string" ? (
                <p className="mt-1 text-stone-500">出典: {row.sourceHint}</p>
              ) : null}
              {showCategory && typeof row.deferCategory === "string" ? (
                <p className="mt-1 text-stone-600">
                  区分:{" "}
                  {DEFER_CATEGORY_LABELS[row.deferCategory] ?? row.deferCategory}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VoteQuestions({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  // New structured questions
  if (value.every((item) => item && typeof item === "object")) {
    return (
      <div>
        <div className="text-xs font-semibold text-stone-500">
          採決前に解決すべき質問
        </div>
        <div className="mt-2 space-y-3">
          {value.map((item, index) => {
            const q = asRecord(item);
            return (
              <div
                key={`${String(q.question)}-${index}`}
                className="rounded border border-stone-200 bg-stone-50 p-3 text-sm"
              >
                <p className="font-medium text-stone-900">
                  {typeof q.question === "string" ? q.question : "（質問）"}
                </p>
                {typeof q.whyNeeded === "string" ? (
                  <p className="mt-1 text-stone-700">理由: {q.whyNeeded}</p>
                ) : null}
                {Array.isArray(q.affectedMembers) ? (
                  <p className="mt-1 text-stone-600">
                    影響する役員: {asStringList(q.affectedMembers).join("、")}
                  </p>
                ) : null}
                {"canValidateInPilot" in q ? (
                  <p className="mt-1 text-stone-600">
                    小規模試行で検証可能: {q.canValidateInPilot ? "はい" : "いいえ"}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Legacy string[] questions
  return (
    <ListField label="採決前に解決すべき質問" items={asStringList(value)} />
  );
}

export function StatementCard({
  step,
  title,
  stance,
  speakerType,
  content,
  embedded = false,
}: {
  step: string;
  title: string;
  stance?: string | null;
  speakerType: string;
  content: unknown;
  /** When true, omit outer chrome (for nesting inside live officer cards). */
  embedded?: boolean;
}) {
  const data = asRecord(content);
  const isProposer = speakerType === "proposer";

  const reviewLevel =
    typeof data.reviewLevel === "string" ? data.reviewLevel : null;
  const consensus = [
    ...asStringList(data.consensusPoints),
    ...asStringList(data.agreements),
  ];
  const disputed = [
    ...asStringList(data.disputedPoints),
    ...asStringList(data.conflicts),
  ];
  const fatal = [
    ...asStringList(data.fatalConcerns),
    ...asStringList(data.criticalConcerns),
  ];

  const body = (
      <div className="space-y-3">
        <Field label="議題" value={typeof data.agenda === "string" ? data.agenda : null} />
        <Field
          label="審査レベル理由"
          value={
            typeof data.reviewLevelReason === "string"
              ? data.reviewLevelReason
              : null
          }
        />
        <ListField label="解決すべき課題" items={asStringList(data.problemsToSolve)} />
        <ListField label="前提" items={asStringList(data.assumptions)} />
        <ListField label="制約" items={asStringList(data.constraints)} />
        <ListField label="判断基準" items={asStringList(data.decisionCriteria)} />
        <ListField label="不足情報" items={asStringList(data.missingInformation)} />
        {data.coreConcept && typeof data.coreConcept === "object" ? (
          <div className="rounded border border-stone-300 bg-stone-50 p-3">
            <div className="text-xs font-semibold text-stone-500">企画の核心</div>
            <p className="mt-1 text-sm font-medium text-stone-900">
              {typeof asRecord(data.coreConcept).summary === "string"
                ? String(asRecord(data.coreConcept).summary)
                : ""}
            </p>
            <ListField
              label="核心の柱"
              items={asStringList(asRecord(data.coreConcept).pillars)}
            />
          </div>
        ) : null}

        {(typeof data.currentProposalVote === "string" ||
          typeof data.revisedProposalVote === "string" ||
          data.revisedProposalVote === null) &&
        ("currentProposalVote" in data || "revisedProposalVote" in data) ? (
          <div className="rounded border border-stone-800 bg-white p-3">
            <div className="text-xs font-semibold text-stone-500">採決の分離</div>
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-stone-600">現行案への採決:</span>
                <StanceBadge
                  stance={
                    typeof data.currentProposalVote === "string"
                      ? data.currentProposalVote
                      : stance
                  }
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-stone-600">修正版なら:</span>
                {data.revisedProposalVote == null ? (
                  <span className="text-stone-500">（評価なし）</span>
                ) : (
                  <StanceBadge stance={String(data.revisedProposalVote)} />
                )}
              </div>
              {"coreConceptPreserved" in data ? (
                <p className="text-stone-700">
                  核心維持: {data.coreConceptPreserved ? "はい" : "いいえ"}
                  {typeof data.coreConceptChangedReason === "string"
                    ? ` — ${data.coreConceptChangedReason}`
                    : ""}
                </p>
              ) : null}
              {typeof data.decisionRationale === "string" ? (
                <p className="whitespace-pre-wrap text-stone-800">
                  {data.decisionRationale}
                </p>
              ) : null}
              <ListField
                label="現行案の限定条件"
                items={asStringList(data.approvalConditions)}
              />
              <ListField
                label="必要な修正（修正版）"
                items={asStringList(data.requiredRevisions)}
              />
              {"resubmissionRequired" in data ? (
                <p className="text-stone-700">
                  再提出が必要: {data.resubmissionRequired ? "はい" : "いいえ"}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <ListField label="良い点" items={asStringList(data.positives)} />
        <ConcernList value={data.concerns} />
        <ImprovementEffectList value={data.improvements} />
        <Field
          label="評価（旧）"
          value={
            !data.positives && typeof data.evaluation === "string"
              ? data.evaluation
              : null
          }
        />
        <Field
          label="最大の懸念（旧）"
          value={
            !data.concerns && typeof data.biggestConcern === "string"
              ? data.biggestConcern
              : null
          }
        />
        <ListField label="確認したいこと（最大2件）" items={asStringList(data.questions)} />
        <ListField
          label="修正提案（旧）"
          items={!data.improvements ? asStringList(data.revisionProposals) : []}
        />

        <Field
          label="取り上げた発言"
          value={
            typeof data.referencedMemberTitle === "string"
              ? data.referencedMemberTitle
              : null
          }
        />
        <Field
          label="論点整理タイプ"
          value={
            typeof data.triageType === "string"
              ? (TRIAGE_TYPE_LABELS[data.triageType] ?? data.triageType)
              : typeof data.disagreementType === "string"
                ? (REBUTTAL_TYPE_LABELS[data.disagreementType] ??
                  data.disagreementType)
                : typeof data.rebuttalType === "string"
                  ? (REBUTTAL_TYPE_LABELS[data.rebuttalType] ?? data.rebuttalType)
                  : null
          }
        />
        <Field
          label="重要な論点"
          value={
            typeof data.importantPoint === "string"
              ? data.importantPoint
              : typeof data.rejectedClaim === "string"
                ? data.rejectedClaim
                : typeof data.opponentClaim === "string"
                  ? data.opponentClaim
                  : null
          }
        />
        <Field
          label="整理理由"
          value={
            typeof data.triageReason === "string"
              ? data.triageReason
              : typeof data.counterReason === "string"
                ? data.counterReason
                : null
          }
        />
        <Field
          label="推奨"
          value={
            typeof data.recommendation === "string"
              ? data.recommendation
              : typeof data.alternative === "string"
                ? data.alternative
                : typeof data.counterpoint === "string"
                  ? data.counterpoint
                  : null
          }
        />
        <Field
          label="対立する選択肢"
          value={
            typeof data.choiceConflict === "string" ? data.choiceConflict : null
          }
        />
        <Field
          label="判断変化"
          value={
            typeof data.decisionChanged === "boolean"
              ? `${data.decisionChanged ? "変化あり" : "変化なし"} / 前回: ${String(data.previousDecision ?? "-")} → 現在: ${String(data.currentDecision ?? data.currentStance ?? "-")}`
              : typeof data.stanceChanged === "boolean"
                ? `立場変更: ${data.stanceChanged ? "あり" : "なし"}`
                : null
          }
        />
        <Field
          label="優先の変化"
          value={
            typeof data.changedCondition === "string"
              ? data.changedCondition
              : typeof data.changeReason === "string"
                ? data.changeReason
                : null
          }
        />
        <ListField label="同意する点" items={asStringList(data.agreeingPoints)} />
        <ListField label="不同意の点" items={asStringList(data.disagreeingPoints)} />
        <ListField label="見落とされている論点" items={asStringList(data.overlookedPoints)} />
        <ListField
          label="企画者への質問（最大2件）"
          items={
            step === "REBUTTAL" || step === "INTERIM"
              ? asStringList(data.questionsForProposer)
              : []
          }
        />

        <Field
          label="レビュー要約"
          value={typeof data.reviewSummary === "string" ? data.reviewSummary : null}
        />
        <ListField label="優先順位TOP3" items={asStringList(data.priorityTop3)} />
        <ListField label="今すぐ修正すること" items={asStringList(data.fixNow)} />
        <ListField label="後回しで良いこと" items={asStringList(data.deferLater)} />
        <Field
          label="企画者へのアドバイス"
          value={
            typeof data.adviceToProposer === "string" ? data.adviceToProposer : null
          }
        />
        {data.revisedDraft && typeof data.revisedDraft === "object" ? (
          <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-900">修正版ドラフト</div>
            <Field
              label="タイトル"
              value={
                typeof asRecord(data.revisedDraft).title === "string"
                  ? String(asRecord(data.revisedDraft).title)
                  : null
              }
            />
            <Field
              label="概要"
              value={
                typeof asRecord(data.revisedDraft).summary === "string"
                  ? String(asRecord(data.revisedDraft).summary)
                  : null
              }
            />
            <ListField
              label="主な変更"
              items={asStringList(asRecord(data.revisedDraft).keyChanges)}
            />
            <ListField
              label="未解決の問い"
              items={asStringList(asRecord(data.revisedDraft).openQuestions)}
            />
          </div>
        ) : null}

        <ListField label="合意している点（旧）" items={consensus} />
        <ListField label="対立している点（旧）" items={disputed} />
        <ListField label="致命的な懸念（旧）" items={fatal} />
        <VoteQuestions value={data.questionsBeforeVote} />
        <ListField
          label="試行中に検証する項目（旧）"
          items={asStringList(data.itemsToValidateInPilot)}
        />
        <Field
          label="暫定推奨（旧）"
          value={
            typeof data.chairRecommendation === "string"
              ? `${CHAIR_RECOMMENDATION_LABELS[data.chairRecommendation] ?? data.chairRecommendation}${
                  typeof data.chairRecommendationReason === "string"
                    ? ` — ${data.chairRecommendationReason}`
                    : ""
                }`
              : null
          }
        />

        <Field
          label="今回の企画で最も重要な価値"
          value={typeof data.coreValue === "string" ? data.coreValue : null}
        />
        <ImprovementList label="採用する改善" value={data.adoptedImprovements} />
        <ImprovementList label="保留する改善（価値はあるが今回はやらない）" value={data.heldImprovements} />
        <ImprovementList
          label="見送る改善"
          value={data.deferredImprovements}
          showCategory
        />
        <Field
          label="編集コメント"
          value={typeof data.editComment === "string" ? data.editComment : null}
        />
        <ListField
          label="将来バックログ"
          items={asStringList(data.futureBacklog)}
        />

        <Field
          label="Before"
          value={typeof data.beforeSummary === "string" ? data.beforeSummary : null}
        />
        <ListField
          label="新しく得られた視点"
          items={asStringList(data.newPerspectives)}
        />
        <ListField
          label="企画者が採用した改善"
          items={asStringList(data.adoptedByProposer)}
        />
        <Field
          label="After"
          value={typeof data.afterSummary === "string" ? data.afterSummary : null}
        />
        <ListField
          label="最も価値が向上した点"
          items={asStringList(data.valueImproved)}
        />
        <ListField
          label="解消できた懸念"
          items={asStringList(data.concernsResolved)}
        />
        <ListField
          label="残課題"
          items={asStringList(data.remainingIssues)}
        />
        <ListField label="バックログ" items={asStringList(data.backlog)} />
        {data.editedPlan && typeof data.editedPlan === "object" ? (
          <div className="space-y-2 rounded border border-stone-800 bg-stone-50 p-3">
            <div className="text-xs font-semibold text-stone-700">最終企画（編集後）</div>
            <Field
              label="タイトル"
              value={
                typeof asRecord(data.editedPlan).title === "string"
                  ? String(asRecord(data.editedPlan).title)
                  : null
              }
            />
            <Field
              label="概要"
              value={
                typeof asRecord(data.editedPlan).summary === "string"
                  ? String(asRecord(data.editedPlan).summary)
                  : null
              }
            />
            <Field
              label="スコープ"
              value={
                typeof asRecord(data.editedPlan).scope === "string"
                  ? String(asRecord(data.editedPlan).scope)
                  : null
              }
            />
            <Field
              label="対象外"
              value={
                typeof asRecord(data.editedPlan).outOfScope === "string"
                  ? String(asRecord(data.editedPlan).outOfScope)
                  : null
              }
            />
            <ListField
              label="成功基準"
              items={asStringList(asRecord(data.editedPlan).successCriteria)}
            />
            <Field
              label="運用"
              value={
                typeof asRecord(data.editedPlan).operations === "string"
                  ? String(asRecord(data.editedPlan).operations)
                  : null
              }
            />
          </div>
        ) : null}
        {data.simplyCheck && typeof data.simplyCheck === "object" ? (
          <Field
            label="M(Simply)点検"
            value={`${asRecord(data.simplyCheck).complexityReduced ? "複雑さ低減: はい" : "複雑さ低減: いいえ"} / ${asRecord(data.simplyCheck).valuePreserved ? "価値維持: はい" : "価値維持: いいえ"} — ${typeof asRecord(data.simplyCheck).explanation === "string" ? asRecord(data.simplyCheck).explanation : ""}`}
          />
        ) : null}

        <Field
          label="役員への反論"
          value={typeof data.rebuttal === "string" ? data.rebuttal : null}
        />
        <Field
          label="追加情報"
          value={typeof data.additionalInfo === "string" ? data.additionalInfo : null}
        />
        <Field
          label="企画の修正版"
          value={typeof data.revisedPlan === "string" ? data.revisedPlan : null}
        />

        <ListField
          label="残る懸念"
          items={asStringList(data.remainingConcerns)}
        />
        {/* approvalConditions already shown in vote split when present */}
        {!("currentProposalVote" in data) ? (
          <ListField
            label="可決する場合の条件"
            items={asStringList(data.approvalConditions)}
          />
        ) : null}

        <ListField label="可決条件" items={asStringList(data.conditions)} />
        <ListField label="主要な判断理由" items={asStringList(data.mainReasons)} />
        <ListField label="企画の強くなった点" items={asStringList(data.strengthenedPoints)} />
        <ListField label="残るリスク" items={asStringList(data.remainingRisks)} />
        <ListField label="次に取るべき行動" items={asStringList(data.nextActions)} />
        <ListField label="検証すべきKPI" items={asStringList(data.kpisToVerify)} />
      </div>
  );

  if (embedded) {
    return <div className="px-2 py-1">{body}</div>;
  }

  return (
    <article
      className={`rounded border p-4 ${
        isProposer
          ? "border-amber-400 bg-amber-50"
          : "border-stone-300 bg-white"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-stone-900">{title}</h3>
        <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
          {STEP_LABELS[step as MeetingStep] ?? step}
        </span>
        <StanceBadge stance={stance} />
        {isProposer ? (
          <span className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-950">
            企画者
          </span>
        ) : null}
        {reviewLevel && reviewLevel in REVIEW_LEVEL_LABELS ? (
          <span className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-700">
            審査: {REVIEW_LEVEL_LABELS[reviewLevel as ReviewLevel]}
          </span>
        ) : null}
      </div>
      {body}
    </article>
  );
}
