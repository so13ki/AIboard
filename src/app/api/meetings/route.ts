import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { startMeeting } from "@/lib/meeting/advance";

export const maxDuration = 300;

const createSchema = z.object({
  projectId: z.string().min(1),
});

export async function GET() {
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      project: true,
      decision: true,
    },
  });
  return NextResponse.json(meetings);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "projectId が必要です。" }, { status: 400 });
  }

  try {
    const meeting = await startMeeting(parsed.data.projectId);
    return NextResponse.json(meeting, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "会議の開始に失敗しました。" },
      { status: 500 },
    );
  }
}
