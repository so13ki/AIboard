import { prisma } from "@/lib/db";
import type { ReviewLevel } from "@/lib/ai/role-focus";
import { MEETING_STEP } from "@/lib/meeting/constants";

export function extractReviewLevel(agendaSummary: unknown): ReviewLevel {
  if (
    agendaSummary &&
    typeof agendaSummary === "object" &&
    "reviewLevel" in agendaSummary
  ) {
    const level = (agendaSummary as { reviewLevel?: unknown }).reviewLevel;
    if (
      level === "experiment" ||
      level === "standard" ||
      level === "strategic"
    ) {
      return level;
    }
  }
  return "standard";
}

export async function loadMeetingReviewLevel(
  meetingId: string,
): Promise<ReviewLevel> {
  const agenda = await prisma.meetingRound.findFirst({
    where: { meetingId, step: MEETING_STEP.AGENDA },
    orderBy: { roundNumber: "asc" },
  });
  return extractReviewLevel(agenda?.summary);
}
