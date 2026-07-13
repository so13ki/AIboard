"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ProjectFormValues = {
  title: string;
  background: string;
  problem: string;
  content: string;
  targetCustomer: string;
  expectedEffect: string;
  estimatedCost: string;
  constraints: string;
  discussionPoints: string;
};

const fields: Array<{ key: keyof ProjectFormValues; label: string; rows?: number }> = [
  { key: "title", label: "企画名" },
  { key: "background", label: "背景", rows: 4 },
  { key: "problem", label: "解決したい課題", rows: 4 },
  { key: "content", label: "企画内容", rows: 6 },
  { key: "targetCustomer", label: "対象顧客", rows: 3 },
  { key: "expectedEffect", label: "期待する効果", rows: 3 },
  { key: "estimatedCost", label: "想定コスト", rows: 3 },
  { key: "constraints", label: "制約", rows: 3 },
  { key: "discussionPoints", label: "企画者が特に議論したい点", rows: 4 },
];

export const emptyProject: ProjectFormValues = {
  title: "",
  background: "",
  problem: "",
  content: "",
  targetCustomer: "",
  expectedEffect: "",
  estimatedCost: "",
  constraints: "",
  discussionPoints: "",
};

export function ProjectForm({
  initial,
  projectId,
}: {
  initial?: ProjectFormValues;
  projectId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProjectFormValues>(initial ?? emptyProject);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(andStay: boolean) {
    setSaving(true);
    setMessage("");
    const res = await fetch(projectId ? `/api/projects/${projectId}` : "/api/projects", {
      method: projectId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setMessage(data.error ?? "保存に失敗しました。");
      return;
    }
    const data = (await res.json()) as { id: string };
    setMessage("保存しました。");
    if (!andStay) {
      router.push(`/projects/${data.id}`);
      router.refresh();
    } else if (!projectId) {
      router.replace(`/projects/${data.id}/edit`);
      router.refresh();
    }
  }

  return (
    <form
      className="space-y-4 rounded border border-stone-300 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      {fields.map((field) => (
        <label key={field.key} className="block space-y-1">
          <span className="text-sm font-medium text-stone-700">{field.label}</span>
          {field.key === "title" ? (
            <input
              className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          ) : (
            <textarea
              className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
              rows={field.rows ?? 3}
              value={form[field.key]}
              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
            />
          )}
        </label>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
        >
          {saving ? "保存中..." : projectId ? "保存して詳細へ" : "作成する"}
        </button>
        <button
          type="button"
          disabled={saving || !form.title.trim()}
          onClick={() => void save(true)}
          className="rounded border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60"
        >
          途中保存
        </button>
        {message ? <span className="text-sm text-stone-600">{message}</span> : null}
      </div>
    </form>
  );
}
