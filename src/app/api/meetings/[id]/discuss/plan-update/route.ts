import { NextResponse } from "next/server";
import { resolvePendingPlanUpdate } from "@/lib/meeting/run-discussion";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";
import { z } from "zod";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  action: z.enum(["approve", "reject", "edit"]),
  editedChanges: z.array(z.string().max(80)).max(6).optional(),
  editedSummary: z.string().max(600).optional(),
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
    const result = await resolvePendingPlanUpdate({
      meetingId: id,
      action: parsed.data.action,
      editedChanges: parsed.data.editedChanges,
      editedSummary: parsed.data.editedSummary,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "企画更新の処理に失敗しました。",
      },
      { status: 500 },
    );
  }
}
