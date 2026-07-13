import { NextResponse } from "next/server";

export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/**
 * @deprecated Prefer /reviews/start + /reviews/[memberId] (client fan-out).
 * Kept so old clients get a clear redirect message.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  return NextResponse.json(
    {
      error:
        "このストリームAPIは廃止しました。/reviews/start と役員単位APIを利用してください。",
      meetingId: id,
      use: [
        `POST /api/meetings/${id}/reviews/start`,
        `POST /api/meetings/${id}/reviews/:memberId`,
        `POST /api/meetings/${id}/reviews/finalize`,
      ],
    },
    { status: 410 },
  );
}
