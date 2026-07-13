import { NextResponse } from "next/server";
import { generateOneOfficerReview } from "@/lib/meeting/run-initial-review-officer";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";
import { z } from "zod";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string; memberId: string }> };

const bodySchema = z.object({
  requestId: z.string().optional(),
});

/** Generate one specialty officer's initial review (isolated from peers). */
export async function POST(request: Request, { params }: Params) {
  const { id, memberId } = await params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "会議が見つかりません。" }, { status: 404 });
  }
  if (
    meeting.status !== MEETING_STATUS.INITIAL_REVIEW &&
    meeting.status !== MEETING_STATUS.FAILED
  ) {
    return NextResponse.json(
      { error: "役員レビューの実行タイミングではありません。" },
      { status: 400 },
    );
  }

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);

  const result = await generateOneOfficerReview({
    meetingId: id,
    memberId,
    requestId: parsed.success ? parsed.data.requestId : undefined,
  });

  const httpStatus =
    result.status === "failed" || result.status === "timed_out" ? 200 : 200;

  return NextResponse.json(result, { status: httpStatus });
}
