import { NextResponse } from "next/server";
import { prepareDiscussionTurn } from "@/lib/meeting/run-discussion";
import { loadMeetingReviewLevel } from "@/lib/meeting/review-level";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "会議が見つかりません。" }, { status: 404 });
  }
  if (
    meeting.status !== MEETING_STATUS.DISCUSSION &&
    meeting.status !== MEETING_STATUS.AWAITING_DISCUSSION &&
    meeting.status !== MEETING_STATUS.REBUTTAL
  ) {
    return NextResponse.json(
      { error: "壁打ち会議中ではありません。" },
      { status: 400 },
    );
  }

  try {
    const reviewLevel = await loadMeetingReviewLevel(id);
    const result = await prepareDiscussionTurn({
      meetingId: id,
      reviewLevel,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "aborted" }, { status: 499 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "次の発言準備に失敗しました。",
      },
      { status: 500 },
    );
  }
}
