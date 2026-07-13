import Link from "next/link";
import { notFound } from "next/navigation";
import { DiscussionChat } from "@/components/DiscussionChat";
import { IssueCards } from "@/components/IssueCards";
import { LiveOfficerReview } from "@/components/LiveOfficerReview";
import { MeetingControls } from "@/components/MeetingControls";
import { MeetingProgress } from "@/components/MeetingProgress";
import { StatementCard } from "@/components/StatementCard";
import { prisma } from "@/lib/db";
import {
  MEETING_STATUS,
  MEETING_STEP,
  STEP_LABELS,
  type MeetingStep,
} from "@/lib/meeting/constants";
import {
  isIssueCardsSummary,
  isWallChatSummary,
} from "@/lib/meeting/summary-format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

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

function GrowthDeliverable({ content }: { content: unknown }) {
  const data = asRecord(content);
  const sections: Array<{ label: string; body?: string; items?: string[] }> = [
    { label: "Before（企画提出時）", body: String(data.beforeSummary ?? "") },
    {
      label: "新しく得られた視点",
      items: asStringList(data.newPerspectives),
    },
    {
      label: "企画者が採用した改善",
      items: asStringList(data.adoptedByProposer),
    },
    { label: "After（改善後の企画）", body: String(data.afterSummary ?? "") },
    {
      label: "最も価値が向上した点",
      items: asStringList(data.valueImproved),
    },
    {
      label: "解消できた懸念",
      items: asStringList(data.concernsResolved),
    },
    { label: "残課題", items: asStringList(data.remainingIssues) },
    { label: "バックログ", items: asStringList(data.backlog) },
    {
      label: "次にやること（優先順・5件以内）",
      items: asStringList(data.nextActions),
    },
  ];

  return (
    <section className="rounded border border-emerald-700 bg-emerald-950 p-5 text-emerald-50">
      <h2 className="text-lg font-semibold">最終成果物: Before → After</h2>
      <p className="mt-1 text-sm text-emerald-200">
        成功条件は全員賛成ではなく、「最初より企画が大きく成長した」ことです。
      </p>
      <div className="mt-5 space-y-4">
        {sections.map((section) => {
          if (section.body && !section.body.trim()) return null;
          if (section.items && section.items.length === 0) return null;
          return (
            <div key={section.label}>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                {section.label}
              </div>
              {section.body ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                  {section.body}
                </p>
              ) : null}
              {section.items?.length ? (
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default async function MeetingDetailPage({ params }: Props) {
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      project: true,
      decision: true,
      rounds: {
        orderBy: { roundNumber: "asc" },
        include: {
          statements: {
            orderBy: { createdAt: "asc" },
            include: { boardMember: true },
          },
        },
      },
    },
  });

  if (!meeting) notFound();

  const growthRound = meeting.rounds.find(
    (round) => round.step === MEETING_STEP.GROWTH_SUMMARY,
  );
  const growthContent =
    growthRound?.summary ??
    asRecord(meeting.decision?.content).growthSummary ??
    null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap gap-3 text-sm text-stone-600">
          <Link href="/meetings" className="hover:underline">
            ← 会議履歴
          </Link>
          <Link href={`/projects/${meeting.projectId}`} className="hover:underline">
            企画詳細
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{meeting.project.title}</h1>
        </div>
        <p className="mt-2 text-sm text-stone-600">
          AI企画育成レビュー — AIディスカッションを中心に企画を育てます。
        </p>
        {meeting.errorMessage ? (
          <p className="mt-2 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            エラー: {meeting.errorMessage}
          </p>
        ) : null}
      </div>

      <MeetingProgress currentStep={meeting.currentStep} status={meeting.status} />

      {meeting.status === MEETING_STATUS.INITIAL_REVIEW ? (
        <LiveOfficerReview meetingId={meeting.id} autoStart />
      ) : null}

      {(() => {
        const discussionRound = meeting.rounds.find(
          (round) =>
            (round.step === MEETING_STEP.DISCUSSION ||
              round.step === MEETING_STEP.REBUTTAL) &&
            isWallChatSummary(round.summary),
        );
        const inDiscussion =
          meeting.status === MEETING_STATUS.DISCUSSION ||
          meeting.status === MEETING_STATUS.AWAITING_DISCUSSION ||
          meeting.status === MEETING_STATUS.REBUTTAL;

        if (!inDiscussion && !discussionRound) return null;

        return (
          <DiscussionChat
            summary={
              discussionRound?.summary ?? {
                format: "wall_chat",
                messages: [],
                ended: false,
              }
            }
            meetingId={meeting.id}
            awaitingProposer={
              meeting.status === MEETING_STATUS.AWAITING_DISCUSSION
            }
            canContinue={
              meeting.status === MEETING_STATUS.DISCUSSION ||
              meeting.status === MEETING_STATUS.REBUTTAL
            }
          />
        );
      })()}

      <MeetingControls meetingId={meeting.id} status={meeting.status} />

      {growthContent ? <GrowthDeliverable content={growthContent} /> : null}

      <section className="space-y-6">
        <h2 className="text-lg font-semibold">議論履歴</h2>
        {meeting.rounds.length === 0 ? (
          <p className="text-sm text-stone-500">まだ発言がありません。</p>
        ) : (
          meeting.rounds.map((round) => {
            // Live review UI owns this step while generating
            if (
              meeting.status === MEETING_STATUS.INITIAL_REVIEW &&
              round.step === MEETING_STEP.INITIAL_REVIEW
            ) {
              return null;
            }

            const useWallChat = isWallChatSummary(round.summary);
            const useIssueCards = isIssueCardsSummary(round.summary);

            return (
              <div key={round.id} className="space-y-3">
                <h3 className="border-b border-stone-300 pb-2 text-sm font-semibold text-stone-700">
                  Step {round.roundNumber}:{" "}
                  {STEP_LABELS[round.step as MeetingStep] ?? round.step}
                </h3>
                {useWallChat ? (
                  <DiscussionChat
                    summary={round.summary}
                    meetingId={meeting.id}
                    awaitingProposer={false}
                    canContinue={false}
                  />
                ) : useIssueCards ? (
                  <IssueCards summary={round.summary} />
                ) : (
                  <div className="space-y-3">
                    {round.statements.map((statement) => (
                      <StatementCard
                        key={statement.id}
                        step={round.step}
                        title={
                          statement.speakerType === "proposer"
                            ? "企画者"
                            : (statement.boardMember?.title ?? "システム")
                        }
                        stance={statement.stance}
                        speakerType={statement.speakerType}
                        content={statement.content}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
