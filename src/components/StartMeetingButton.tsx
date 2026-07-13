"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartMeetingButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "役員会の開始に失敗しました。");
      return;
    }
    const meeting = (await res.json()) as { id: string };
    router.push(`/meetings/${meeting.id}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void start()}
        disabled={loading}
        className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
      >
        {loading ? "議題整理中..." : "役員会を開始"}
      </button>
      {error ? <span className="max-w-xs text-right text-xs text-rose-700">{error}</span> : null}
    </div>
  );
}
