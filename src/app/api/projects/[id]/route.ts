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

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      meetings: {
        orderBy: { createdAt: "desc" },
        include: { decision: true },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "企画が見つかりません。" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です。", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const project = await prisma.project.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(project);
}
