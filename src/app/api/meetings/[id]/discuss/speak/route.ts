import { NextResponse } from "next/server";
import { speakDiscussionTurn } from "@/lib/meeting/run-discussion";
import { loadMeetingReviewLevel } from "@/lib/meeting/review-level";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";
import { z } from "zod";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  generationId: z.string().min(1),
});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "会議が見つかりません。" }, { status: 404 });
  }
  if (
    meeting.status !== MEETING_STATUS.DISCUSSION &&
    meeting.status !== MEETING_STATUS.REBUTTAL
  ) {
    return NextResponse.json(
      { error: "壁打ち会議の発言生成中ではありません。" },
      { status: 400 },
    );
  }

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "generationId が必要です。" },
      { status: 400 },
    );
  }

  try {
    const reviewLevel = await loadMeetingReviewLevel(id);
    const result = await speakDiscussionTurn({
      meetingId: id,
      generationId: parsed.data.generationId,
      reviewLevel,
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { status: "aborted", message: null, interruptQueued: false },
        { status: 200 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "発言生成に失敗しました。",
      },
      { status: 500 },
    );
  }
}
