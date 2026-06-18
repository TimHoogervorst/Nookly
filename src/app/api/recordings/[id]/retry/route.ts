import { NextRequest, NextResponse } from "next/server";
import { getRecording, updateRecordingStatus } from "@/lib/recordings";
import { getSetting } from "@/lib/users";
import { getRecordingFilePath, groupBySentences } from "@/lib/recordings";
import { transcribeAudio } from "@/lib/whisper";
import { splitIntoChunks, generateEmbedding } from "@/lib/rag";
import { insertRecordingSegment } from "@/lib/recordings";
import fs from "fs/promises";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const recording = getRecording(parseInt(id));
    if (!recording) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    // Reset status to processing
    updateRecordingStatus(parseInt(id), "processing");

    // Kick off background retry (don't await)
    retryTranscription(parseInt(id), recording.filename).catch((err) => {
      console.error(`Retry transcription failed for recording ${id}:`, err);
    });

    return NextResponse.json({ success: true, status: "processing" });
  } catch (error) {
    return NextResponse.json({ error: "Failed to retry transcription" }, { status: 500 });
  }
}

async function retryTranscription(recordingId: number, filename: string): Promise<void> {
  console.log(`[recording:${recordingId}] Retrying transcription...`);
  try {
    const filePath = getRecordingFilePath(filename);
    const buffer = await fs.readFile(filePath);

    const result = await transcribeAudio(buffer, filename);
    const segments = result.segments;
    console.log(`[recording:${recordingId}] Transcription complete: ${segments.length} segments`);

    const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;
    const rawSegmentsJson = JSON.stringify(segments);

    // Group into paragraphs
    const blocks = groupBySentences(segments, 10);

    // Delete old segments and re-insert
    const { getDb } = await import("@/lib/db-core");
    getDb()
      .prepare("DELETE FROM recording_segments WHERE recording_id = ?")
      .run(recordingId);

    const apiKey = getSetting("api_key");

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block.text.trim()) continue;

      const chunks = splitIntoChunks(block.text);
      for (let j = 0; j < chunks.length; j++) {
        const chunkText = chunks[j];
        if (apiKey) {
          try {
            const embedding = await generateEmbedding(chunkText);
            insertRecordingSegment(recordingId, i, block.start, block.end, chunkText, embedding);
          } catch {
            insertRecordingSegment(recordingId, i, block.start, block.end, chunkText);
          }
        } else {
          insertRecordingSegment(recordingId, i, block.start, block.end, chunkText);
        }
      }
    }

    updateRecordingStatus(recordingId, "done", result.text, duration, rawSegmentsJson);
    console.log(`[recording:${recordingId}] Retry complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[recording:${recordingId}] Retry failed: ${message}`);
    updateRecordingStatus(recordingId, "error");
  }
}
