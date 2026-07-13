import Link from "next/link";
import { prisma } from "@/lib/db";
import { STATUS_LABELS, type MeetingStatus } from "@/lib/meeting/constants";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [company, projectCount, meetingCount, recentMeetings] = await Promise.all([
    prisma.company.findFirst(),
    prisma.project.count(),
    prisma.meeting.count(),
    prisma.meeting.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { project: true, decision: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          AI役員会
        </h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          AIと一緒に企画を育てるレビューシステムです。目的は採決ではなく企画品質の向上。最終成果は Before → After です。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded border border-stone-300 bg-white p-4">
          <div className="text-sm text-stone-500">会社</div>
          <div className="mt-1 text-xl font-semibold">{company?.name ?? "未設定"}</div>
        </div>
        <div className="rounded border border-stone-300 bg-white p-4">
          <div className="text-sm text-stone-500">企画数</div>
          <div className="mt-1 text-xl font-semibold">{projectCount}</div>
        </div>
        <div className="rounded border border-stone-300 bg-white p-4">
          <div className="text-sm text-stone-500">会議数</div>
          <div className="mt-1 text-xl font-semibold">{meetingCount}</div>
        </div>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link
          href="/projects/new"
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          新しい企画を作成
        </Link>
        <Link
          href="/company"
          className="rounded border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
        >
          会社設定
        </Link>
        <Link
          href="/board-members"
          className="rounded border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
        >
          役員設定
        </Link>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">最近の会議</h2>
          <Link href="/meetings" className="text-sm text-stone-600 hover:underline">
            すべて見る
          </Link>
        </div>
        <div className="space-y-2">
          {recentMeetings.length === 0 ? (
            <p className="text-sm text-stone-500">まだ会議はありません。</p>
          ) : (
            recentMeetings.map((meeting) => (
              <Link
                key={meeting.id}
                href={`/meetings/${meeting.id}`}
                className="flex items-center justify-between rounded border border-stone-300 bg-white px-4 py-3 hover:bg-stone-50"
              >
                <div>
                  <div className="font-medium text-stone-900">
                    {meeting.project.title}
                  </div>
                  <div className="text-sm text-stone-500">
                    {STATUS_LABELS[meeting.status as MeetingStatus] ?? meeting.status}
                  </div>
                </div>
                <span className="text-sm text-stone-500">詳細</span>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
