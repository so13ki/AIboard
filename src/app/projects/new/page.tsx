import Link from "next/link";
import { ProjectForm } from "@/components/ProjectForm";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-stone-600 hover:underline">
          ← 企画一覧
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">企画作成</h1>
        <p className="mt-1 text-sm text-stone-600">
          入力途中でも「途中保存」できます。
        </p>
      </div>
      <ProjectForm />
    </div>
  );
}
