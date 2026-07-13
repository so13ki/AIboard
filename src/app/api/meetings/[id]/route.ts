import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      project: true,
      decision: true,
      rounds: {
        orderBy: { roundNumber: "asc" },
        include: {
          statements: {
            orderBy: { createdAt: "asc" },
            include: { boardMember: true },
          },
        },
      },
    },
  });

  if (!meeting) {
    return NextResponse.json({ error: "会議が見つかりません。" }, { status: 404 });
  }

  return NextResponse.json(meeting);
}
