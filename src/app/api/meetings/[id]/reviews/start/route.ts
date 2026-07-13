import { NextResponse } from "next/server";
import { startInitialReviewRound } from "@/lib/meeting/run-initial-review-officer";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** Ensure Step2 round exists and return the officer roster immediately. */
export async function POST(_request: Request, { params }: Params) {
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
      { error: "役員レビューの実行タイミングではありません。" },
      { status: 400 },
    );
  }

  try {
    const result = await startInitialReviewRound(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "役員レビュー開始に失敗しました。",
      },
      { status: 500 },
    );
  }
}
