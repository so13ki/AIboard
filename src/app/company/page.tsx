"use client";

import { useEffect, useState } from "react";

type Company = {
  id: string;
  name: string;
  philosophy: string;
  vision: string;
  values: string[];
  culture: string;
  principles: string;
  prohibitions: string;
};

const empty: Omit<Company, "id"> = {
  name: "",
  philosophy: "",
  vision: "",
  values: [],
  culture: "",
  principles: "",
  prohibitions: "",
};

export default function CompanyPage() {
  const [form, setForm] = useState(empty);
  const [valuesText, setValuesText] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/company")
      .then(async (res) => {
        if (!res.ok) throw new Error("会社設定の取得に失敗しました。");
        return res.json() as Promise<Company>;
      })
      .then((company) => {
        setForm({
          name: company.name,
          philosophy: company.philosophy,
          vision: company.vision,
          values: company.values,
          culture: company.culture,
          principles: company.principles,
          prohibitions: company.prohibitions,
        });
        setValuesText(company.values.join("\n"));
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const payload = {
      ...form,
      values: valuesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
    const res = await fetch("/api/company", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setMessage(data.error ?? "保存に失敗しました。");
      return;
    }
    setMessage("保存しました。");
  }

  if (loading) {
    return <p className="text-sm text-stone-500">読み込み中...</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">会社設定</h1>
        <p className="mt-1 text-sm text-stone-600">
          AI役員はここにある理念・原則・禁止事項を参照して議論します。
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded border border-stone-300 bg-white p-5">
        {(
          [
            ["name", "会社名"],
            ["philosophy", "経営理念"],
            ["vision", "ビジョン"],
            ["culture", "組織文化"],
            ["principles", "絶対に守る原則"],
            ["prohibitions", "禁止事項"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block space-y-1">
            <span className="text-sm font-medium text-stone-700">{label}</span>
            {key === "name" ? (
              <input
                className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                required
              />
            ) : (
              <textarea
                className="min-h-24 w-full rounded border border-stone-300 px-3 py-2 text-sm"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                required
              />
            )}
          </label>
        ))}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-stone-700">
            バリュー（1行に1項目）
          </span>
          <textarea
            className="min-h-32 w-full rounded border border-stone-300 px-3 py-2 text-sm"
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
          >
            {saving ? "保存中..." : "保存する"}
          </button>
          {message ? <span className="text-sm text-stone-600">{message}</span> : null}
        </div>
      </form>
    </div>
  );
}
