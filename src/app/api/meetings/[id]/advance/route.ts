import { NextResponse } from "next/server";
import { advanceMeeting, retryFailedMeeting } from "@/lib/meeting/advance";

export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { retry?: boolean };

  try {
    const meeting = body.retry
      ? await retryFailedMeeting(id)
      : await advanceMeeting(id);
    return NextResponse.json(meeting);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "会議の進行に失敗しました。",
      },
      { status: 500 },
    );
  }
}
