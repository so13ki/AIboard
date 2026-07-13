import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export default async function BoardMembersPage() {
  const members = await prisma.boardMember.findMany({
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI役員一覧</h1>
        <p className="mt-1 text-sm text-stone-600">
          各役員のKPIと行動ルールを編集できます。
        </p>
      </div>

      <div className="grid gap-4">
        {members.map((member) => {
          const priorities = asStringArray(member.priorities);
          return (
            <Link
              key={member.id}
              href={`/board-members/${member.id}`}
              className="rounded border border-stone-300 bg-white p-4 hover:bg-stone-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">
                    {member.title}
                    {member.isChairperson ? (
                      <span className="ml-2 text-xs font-medium text-stone-500">
                        編集者
                      </span>
                    ) : null}
                  </h2>
                  <p className="mt-1 text-sm text-stone-600">{member.description}</p>
                </div>
                <span className="text-sm text-stone-500">編集</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {priorities.slice(0, 5).map((item) => (
                  <span
                    key={item}
                    className="rounded border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs text-stone-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
