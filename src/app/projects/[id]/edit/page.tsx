import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ProjectForm } from "@/components/ProjectForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function EditProjectPage({ params }: Props) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-stone-600 hover:underline"
        >
          ← 企画詳細
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">企画編集</h1>
      </div>
      <ProjectForm
        projectId={project.id}
        initial={{
          title: project.title,
          background: project.background,
          problem: project.problem,
          content: project.content,
          targetCustomer: project.targetCustomer,
          expectedEffect: project.expectedEffect,
          estimatedCost: project.estimatedCost,
          constraints: project.constraints,
          discussionPoints: project.discussionPoints,
        }}
      />
    </div>
  );
}
