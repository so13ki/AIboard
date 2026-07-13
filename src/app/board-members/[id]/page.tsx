"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Member = {
  id: string;
  title: string;
  description: string;
  priorities: string[];
  checkItems: string[] | null;
  behaviorRules: string[];
  sortOrder: number;
  isChairperson: boolean;
};

export default function BoardMemberEditPage() {
  const params = useParams<{ id: string }>();
  const [member, setMember] = useState<Member | null>(null);
  const [prioritiesText, setPrioritiesText] = useState("");
  const [checkItemsText, setCheckItemsText] = useState("");
  const [rulesText, setRulesText] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/board-members/${params.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("役員の取得に失敗しました。");
        return res.json() as Promise<Member>;
      })
      .then((data) => {
        setMember(data);
        setPrioritiesText(data.priorities.join("\n"));
        setCheckItemsText((data.checkItems ?? []).join("\n"));
        setRulesText(data.behaviorRules.join("\n"));
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!member) return;
    setSaving(true);
    setMessage("");

    const checkItems = checkItemsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const payload = {
      title: member.title,
      description: member.description,
      priorities: prioritiesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      checkItems: checkItems.length ? checkItems : null,
      behaviorRules: rulesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      sortOrder: member.sortOrder,
      isChairperson: member.isChairperson,
    };

    const res = await fetch(`/api/board-members/${member.id}`, {
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

  if (loading) return <p className="text-sm text-stone-500">読み込み中...</p>;
  if (!member) return <p className="text-sm text-rose-700">{message || "見つかりません。"}</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/board-members" className="text-sm text-stone-600 hover:underline">
          ← 役員一覧
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">役員編集</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded border border-stone-300 bg-white p-5">
        <label className="block space-y-1">
          <span className="text-sm font-medium">役職名</span>
          <input
            className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
            value={member.title}
            onChange={(e) => setMember({ ...member, title: e.target.value })}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">説明・役割</span>
          <textarea
            className="min-h-24 w-full rounded border border-stone-300 px-3 py-2 text-sm"
            value={member.description}
            onChange={(e) => setMember({ ...member, description: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">最優先事項 / KPI（1行1項目）</span>
          <textarea
            className="min-h-28 w-full rounded border border-stone-300 px-3 py-2 text-sm"
            value={prioritiesText}
            onChange={(e) => setPrioritiesText(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">必ず確認すること（1行1項目）</span>
          <textarea
            className="min-h-28 w-full rounded border border-stone-300 px-3 py-2 text-sm"
            value={checkItemsText}
            onChange={(e) => setCheckItemsText(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">行動ルール（1行1項目）</span>
          <textarea
            className="min-h-28 w-full rounded border border-stone-300 px-3 py-2 text-sm"
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={member.isChairperson}
            onChange={(e) =>
              setMember({ ...member, isChairperson: e.target.checked })
            }
          />
          編集者（CEO）として扱う
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">表示順</span>
          <input
            type="number"
            className="w-32 rounded border border-stone-300 px-3 py-2 text-sm"
            value={member.sortOrder}
            onChange={(e) =>
              setMember({ ...member, sortOrder: Number(e.target.value) })
            }
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
