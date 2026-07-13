import { NextResponse } from "next/server";
import { finalizeInitialReviewFromClient } from "@/lib/meeting/run-initial-review-officer";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";
import { z } from "zod";

export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  terminalMemberIds: z.array(z.string()).default([]),
  failedMemberIds: z.array(z.string()).default([]),
});

/** Advance Step2 → Step3 when every officer is terminal and ≥1 completed. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "会議が見つかりません。" }, { status: 404 });
  }
  if (
    meeting.status !== MEETING_STATUS.INITIAL_REVIEW &&
    meeting.status !== MEETING_STATUS.FAILED &&
    meeting.status !== MEETING_STATUS.DISCUSSION
  ) {
    return NextResponse.json(
      { error: "役員レビュー完了処理のタイミングではありません。" },
      { status: 400 },
    );
  }

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です。" }, { status: 400 });
  }

  const result = await finalizeInitialReviewFromClient({
    meetingId: id,
    terminalMemberIds: parsed.data.terminalMemberIds,
    failedMemberIds: parsed.data.failedMemberIds,
  });

  if (!result.finalized && result.reason === "all_failed") {
    return NextResponse.json(
      {
        ...result,
        error:
          "全員のレビュー取得に失敗しました。再試行してから進めてください。",
      },
      { status: 422 },
    );
  }

  return NextResponse.json(result);
}
