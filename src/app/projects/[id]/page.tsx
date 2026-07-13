import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StartMeetingButton } from "@/components/StartMeetingButton";
import {
  STATUS_LABELS,
  type MeetingStatus,
} from "@/lib/meeting/constants";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
        {value || "（未入力）"}
      </p>
    </div>
  );
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      meetings: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/projects" className="text-sm text-stone-600 hover:underline">
            ← 企画一覧
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{project.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/projects/${project.id}/edit`}
            className="rounded border border-stone-400 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50"
          >
            編集
          </Link>
          <StartMeetingButton projectId={project.id} />
        </div>
      </div>

      <section className="grid gap-4 rounded border border-stone-300 bg-white p-5 md:grid-cols-2">
        <Field label="背景" value={project.background} />
        <Field label="解決したい課題" value={project.problem} />
        <Field label="企画内容" value={project.content} />
        <Field label="対象顧客" value={project.targetCustomer} />
        <Field label="期待する効果" value={project.expectedEffect} />
        <Field label="想定コスト" value={project.estimatedCost} />
        <Field label="制約" value={project.constraints} />
        <Field label="特に議論したい点" value={project.discussionPoints} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">この企画の会議</h2>
        <div className="space-y-2">
          {project.meetings.length === 0 ? (
            <p className="text-sm text-stone-500">まだ役員会はありません。</p>
          ) : (
            project.meetings.map((meeting) => (
              <Link
                key={meeting.id}
                href={`/meetings/${meeting.id}`}
                className="flex items-center justify-between rounded border border-stone-300 bg-white px-4 py-3 hover:bg-stone-50"
              >
                <div>
                  <div className="font-medium">
                    {STATUS_LABELS[meeting.status as MeetingStatus] ?? meeting.status}
                  </div>
                  <div className="text-sm text-stone-500">
                    {new Date(meeting.createdAt).toLocaleString("ja-JP")}
                  </div>
                </div>
                <span className="text-sm text-stone-500">開く</span>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
