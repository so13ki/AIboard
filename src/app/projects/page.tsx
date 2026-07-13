import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  draft: "下書き",
  in_review: "育成レビュー中",
  decided: "完了",
};

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      meetings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">企画一覧</h1>
          <p className="mt-1 text-sm text-stone-600">企画の作成・編集・役員会開始ができます。</p>
        </div>
        <Link
          href="/projects/new"
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          新規作成
        </Link>
      </div>

      <div className="space-y-2">
        {projects.length === 0 ? (
          <p className="text-sm text-stone-500">企画がまだありません。</p>
        ) : (
          projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="flex items-center justify-between rounded border border-stone-300 bg-white px-4 py-3 hover:bg-stone-50"
            >
              <div>
                <div className="font-medium text-stone-900">{project.title}</div>
                <div className="text-sm text-stone-500">
                  {statusLabel[project.status] ?? project.status}
                  {project.meetings[0]
                    ? ` / 最新会議あり`
                    : ""}
                </div>
              </div>
              <span className="text-sm text-stone-500">詳細</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
