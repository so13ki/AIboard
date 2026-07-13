import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const projectSchema = z.object({
  title: z.string().min(1),
  background: z.string().optional().default(""),
  problem: z.string().optional().default(""),
  content: z.string().optional().default(""),
  targetCustomer: z.string().optional().default(""),
  expectedEffect: z.string().optional().default(""),
  estimatedCost: z.string().optional().default(""),
  constraints: z.string().optional().default(""),
  discussionPoints: z.string().optional().default(""),
});

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      meetings: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const company = await prisma.company.findFirst();
  if (!company) {
    return NextResponse.json({ error: "会社設定がありません。" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      companyId: company.id,
      ...parsed.data,
    },
  });

  return NextResponse.json(project, { status: 201 });
}
