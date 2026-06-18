import { NextRequest, NextResponse } from "next/server";
import { toggleFavoriteRecording } from "@/lib/recordings";

export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const recording = toggleFavoriteRecording(parseInt(id));
    if (!recording)
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    return NextResponse.json(recording);
  } catch (error) {
    return NextResponse.json({ error: "Failed to toggle favorite" }, { status: 500 });
  }
}
