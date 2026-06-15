import { NextRequest, NextResponse } from "next/server";
import {
  listRecordings,
  insertRecording,
  insertRecordingSegment,
  getDb,
  getSetting,
  updateRecordingStatus,
} from "@/lib/db";
import {
  ensureRecordingsDir,
  generateRecordingFilename,
  getRecordingFilePath,
  groupBySentences,
} from "@/lib/recordings";
import { transcribeAudio } from "@/lib/whisper";
import { splitIntoChunks, generateEmbedding } from "@/lib/rag";
import fs from "fs/promises";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get("tag_id");
    const recordings = listRecordings(tagId ? parseInt(tagId) : undefined);
    return NextResponse.json(recordings);
  } catch (error) {
    return NextResponse.json({ error: "Failed to list recordings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await ensureRecordingsDir();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Accept common audio MIME types
    const validTypes = [
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/x-m4a",
    ];
    if (!validTypes.includes(file.type) && file.type !== "") {
      // Allow empty MIME type (some browsers don't set it for audio/webm)
      return NextResponse.json(
        { error: `Unsupported audio format: ${file.type}` },
        { status: 400 }
      );
    }

    const storedFilename = generateRecordingFilename(file.name);
    const filePath = getRecordingFilePath(storedFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // Create the recording record (status = 'processing')
    const recording = insertRecording(storedFilename, file.name, storedFilename);

    // Process in background: transcribe, chunk, embed
    transcribeRecordingInBackground(recording.id, buffer, storedFilename).catch((err) => {
      console.error(`Background transcription failed for recording ${recording.id}:`, err);
    });

    return NextResponse.json(recording, { status: 201 });
  } catch (error) {
    console.error("Recording upload error:", error);
    return NextResponse.json({ error: "Failed to upload recording" }, { status: 500 });
  }
}

async function transcribeRecordingInBackground(
  recordingId: number,
  buffer: Buffer,
  filename: string
): Promise<void> {
  console.log(`[recording:${recordingId}] Starting background transcription...`);
  try {
    // Transcribe
    const result = await transcribeAudio(buffer, filename);
    const segments = result.segments;
    console.log(
      `[recording:${recordingId}] Transcription complete: ${segments.length} segments`
    );

    const duration = segments.length > 0 ? segments[segments.length - 1].end : 0;

    // Store raw segments as JSON for dynamic regrouping later
    const rawSegmentsJson = JSON.stringify(segments);

    // Initial grouping: 4 sentences per block
    const blocks = groupBySentences(segments, 10);
    console.log(
      `[recording:${recordingId}] Grouped ${segments.length} segments into ${blocks.length} paragraphs`
    );

    // Check if embeddings are configured
    const apiKey = getSetting("api_key");

    // Process each paragraph block
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block.text.trim()) continue;

      // Split long block text into RAG-friendly chunks
      const chunks = splitIntoChunks(block.text);

      for (let j = 0; j < chunks.length; j++) {
        const chunkText = chunks[j];

        if (apiKey) {
          try {
            const embedding = await generateEmbedding(chunkText);
            insertRecordingSegment(
              recordingId,
              i,
              block.start,
              block.end,
              chunkText,
              embedding
            );
          } catch (err) {
            console.error(
              `Embedding failed for block ${i} chunk ${j}:`,
              err
            );
            insertRecordingSegment(recordingId, i, block.start, block.end, chunkText);
          }
        } else {
          insertRecordingSegment(recordingId, i, block.start, block.end, chunkText);
        }
      }
    }

    // Update recording as done — save raw segments for dynamic regrouping
    updateRecordingStatus(recordingId, "done", result.text, duration, rawSegmentsJson);
    console.log(`[recording:${recordingId}] Processing complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[recording:${recordingId}] Transcription failed: ${message}`);
    updateRecordingStatus(recordingId, "error");
  }
}
