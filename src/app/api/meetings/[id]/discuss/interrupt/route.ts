import { NextResponse } from "next/server";
import { interruptDiscussion } from "@/lib/meeting/run-discussion";
import { loadMeetingReviewLevel } from "@/lib/meeting/review-level";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";
import { z } from "zod";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  message: z.string().min(1).max(800),
  targetRoleKey: z.string().nullable().optional(),
  messageType: z.string().nullable().optional(),
  controlAction: z.string().nullable().optional(),
});

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

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const reviewLevel = await loadMeetingReviewLevel(id);
    const result = await interruptDiscussion({
      meetingId: id,
      message: parsed.data.message,
      targetRoleKey: parsed.data.targetRoleKey ?? null,
      messageType: parsed.data.messageType ?? null,
      controlAction: parsed.data.controlAction ?? null,
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
          error instanceof Error ? error.message : "割り込みに失敗しました。",
      },
      { status: 500 },
    );
  }
}
