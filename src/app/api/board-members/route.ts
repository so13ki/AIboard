import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const members = await prisma.boardMember.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(members);
}
