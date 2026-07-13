import {
  FLOW_STEPS,
  MEETING_STEP,
  STATUS_LABELS,
  STEP_LABELS,
  type MeetingStatus,
  type MeetingStep,
} from "@/lib/meeting/constants";

export function MeetingProgress({
  currentStep,
  status,
}: {
  currentStep: string;
  status: string;
}) {
  const mappedStep =
    currentStep === MEETING_STEP.INTERIM || currentStep === MEETING_STEP.REBUTTAL
      ? MEETING_STEP.DISCUSSION
      : currentStep === MEETING_STEP.RE_REVIEW ||
          currentStep === MEETING_STEP.PRODUCT_COACH_FOLLOWUP ||
          currentStep === MEETING_STEP.PROPOSER_ANSWER_2
        ? MEETING_STEP.CEO_EDIT
        : currentStep === MEETING_STEP.DECISION
          ? MEETING_STEP.GROWTH_SUMMARY
          : (currentStep as MeetingStep);
  const currentIndex = FLOW_STEPS.indexOf(mappedStep);

  return (
    <div className="rounded border border-stone-300 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-900">育成レビューの進行</h2>
        <span className="text-sm text-stone-600">
          {STATUS_LABELS[status as MeetingStatus] ?? status}
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {FLOW_STEPS.map((step, index) => {
          const done = index < currentIndex || status === "decided";
          const active = step === mappedStep && status !== "decided";
          return (
            <li
              key={step}
              className={`rounded border px-2 py-2 text-center text-xs ${
                done
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : active
                    ? "border-stone-800 bg-stone-800 text-white"
                    : "border-stone-200 bg-stone-50 text-stone-500"
              }`}
            >
              <div className="font-medium">{index + 1}</div>
              <div className="mt-1 leading-snug">{STEP_LABELS[step]}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
