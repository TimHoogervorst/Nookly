import { NextRequest, NextResponse } from "next/server";
import { getRecording, deleteRecording, renameRecording, getSegmentsForRecording } from "@/lib/recordings";
import { deleteRecordingFile, groupBySentences, type RawSegment } from "@/lib/recordings";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const recording = getRecording(parseInt(id));
    if (!recording) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    // Dynamic regrouping by sentence count
    const { searchParams } = new URL(request.url);
    const sentencesPerBlock = parseInt(searchParams.get("sentences_per_block") || "10");

    let segments;
    if (recording.raw_segments) {
      const raw: RawSegment[] = JSON.parse(recording.raw_segments);
      const blocks = groupBySentences(raw, sentencesPerBlock);
      segments = blocks.map((b, i) => ({
        id: i,
        recording_id: recording.id,
        segment_index: i,
        start_time: b.start,
        end_time: b.end,
        text: b.text,
      }));
    } else {
      segments = getSegmentsForRecording(parseInt(id));
    }

    return NextResponse.json({
      ...recording,
      segments,
      sentences_per_block: sentencesPerBlock,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get recording" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.name) {
      const recording = renameRecording(parseInt(id), body.name.trim());
      if (!recording)
        return NextResponse.json({ error: "Recording not found" }, { status: 404 });
      return NextResponse.json(recording);
    }
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to rename recording" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const recording = getRecording(parseInt(id));
    if (!recording) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    const filename = recording.filename;
    deleteRecording(parseInt(id));
    await deleteRecordingFile(filename);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete recording" }, { status: 500 });
  }
}
