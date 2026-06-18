import { NextRequest, NextResponse } from "next/server";
import { getTagsForRecording, setRecordingTags } from "@/lib/tags";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    return NextResponse.json(getTagsForRecording(parseInt(id)));
  } catch (error) {
    return NextResponse.json({ error: "Failed to get tags" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    setRecordingTags(parseInt(id), body.tag_ids || []);
    return NextResponse.json(getTagsForRecording(parseInt(id)));
  } catch (error) {
    return NextResponse.json({ error: "Failed to update tags" }, { status: 500 });
  }
}
