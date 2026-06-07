import { NextRequest, NextResponse } from "next/server";
import { toggleFavorite } from "@/lib/db";

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const pdf = toggleFavorite(parseInt(id));
    if (!pdf) return NextResponse.json({ error: "PDF not found" }, { status: 404 });
    return NextResponse.json(pdf);
  } catch (error) {
    return NextResponse.json({ error: "Failed to toggle favorite" }, { status: 500 });
  }
}
