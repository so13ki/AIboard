import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  name: z.string().min(1),
  philosophy: z.string().min(1),
  vision: z.string().min(1),
  values: z.array(z.string()),
  culture: z.string().min(1),
  principles: z.string().min(1),
  prohibitions: z.string().min(1),
});

export async function GET() {
  const company = await prisma.company.findFirst({
    include: {
      boardMembers: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!company) {
    return NextResponse.json(
      { error: "会社設定がありません。seed を実行してください。" },
      { status: 404 },
    );
  }

  return NextResponse.json(company);
}

export async function PUT(request: Request) {
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await prisma.company.findFirst();
  if (!existing) {
    return NextResponse.json({ error: "会社設定がありません。" }, { status: 404 });
  }

  const company = await prisma.company.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  return NextResponse.json(company);
}
