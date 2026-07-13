import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_LABELS, type MeetingStatus } from "@/lib/meeting/constants";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      project: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">会議履歴</h1>
        <p className="mt-1 text-sm text-stone-600">
          過去の育成レビューを開き、Before → After を再表示できます。
        </p>
      </div>

      <div className="space-y-2">
        {meetings.length === 0 ? (
          <p className="text-sm text-stone-500">会議履歴はまだありません。</p>
        ) : (
          meetings.map((meeting) => (
            <Link
              key={meeting.id}
              href={`/meetings/${meeting.id}`}
              className="flex items-center justify-between rounded border border-stone-300 bg-white px-4 py-3 hover:bg-stone-50"
            >
              <div>
                <div className="font-medium text-stone-900">
                  {meeting.project.title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
                  <span>
                    {STATUS_LABELS[meeting.status as MeetingStatus] ?? meeting.status}
                  </span>
                  <span>·</span>
                  <span>{new Date(meeting.createdAt).toLocaleString("ja-JP")}</span>
                </div>
              </div>
              <span className="text-sm text-stone-500">開く</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
