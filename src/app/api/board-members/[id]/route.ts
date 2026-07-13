import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  priorities: z.array(z.string()),
  checkItems: z.array(z.string()).nullable(),
  behaviorRules: z.array(z.string()),
  sortOrder: z.number().int(),
  isChairperson: z.boolean(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const member = await prisma.boardMember.findUnique({ where: { id } });
  if (!member) {
    return NextResponse.json({ error: "役員が見つかりません。" }, { status: 404 });
  }
  return NextResponse.json(member);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { checkItems, ...rest } = parsed.data;
  const member = await prisma.boardMember.update({
    where: { id },
    data: {
      ...rest,
      checkItems: checkItems === null ? Prisma.DbNull : checkItems,
    },
  });

  return NextResponse.json(member);
}
