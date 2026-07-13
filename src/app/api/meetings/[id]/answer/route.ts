import { NextResponse } from "next/server";
import {
  skipProposerAnswer,
  submitDiscussionReply,
  submitProposerAnswer,
} from "@/lib/meeting/advance";
import { discussionReplySchema, proposerAnswerSchema } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db";
import { MEETING_STATUS } from "@/lib/meeting/constants";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "会議が見つかりません。" }, { status: 404 });
  }

  try {
    if (
      meeting.status === MEETING_STATUS.AWAITING_DISCUSSION ||
      body.kind === "discussion"
    ) {
      const parsed = discussionReplySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "入力内容が不正です。", details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      const updated = await submitDiscussionReply(id, parsed.data);
      return NextResponse.json(updated);
    }

    if (body.skip === true) {
      const updated = await skipProposerAnswer(id);
      return NextResponse.json(updated);
    }

    const parsed = proposerAnswerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "入力内容が不正です。", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const updated = await submitProposerAnswer(id, parsed.data);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "回答の送信に失敗しました。",
      },
      { status: 500 },
    );
  }
}
