import { NextRequest, NextResponse } from "next/server";
import { getRecording } from "@/lib/recordings";
import { getRecordingFilePath } from "@/lib/recordings";
import fs from "fs/promises";

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

    const filePath = getRecordingFilePath(recording.filename);
    let stat: { size: number };
    try {
      stat = await fs.stat(filePath);
    } catch {
      return NextResponse.json(
        { error: "Recording file not found on disk" },
        { status: 404 }
      );
    }

    const fileSize = stat.size;
    const rangeHeader = request.headers.get("range");

    // Detect MIME type from extension
    const ext = recording.filename.toLowerCase().split(".").pop();
    const mimeMap: Record<string, string> = {
      webm: "audio/webm",
      mp4: "audio/mp4",
      m4a: "audio/mp4",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
    };
    const contentType = mimeMap[ext || ""] || "audio/webm";

    if (rangeHeader) {
      // Support Range requests for seeking
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const fileHandle = await fs.open(filePath, "r");
      const buffer = Buffer.alloc(chunkSize);
      await fileHandle.read(buffer, 0, chunkSize, start);
      await fileHandle.close();

      return new NextResponse(new Uint8Array(buffer), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
        },
      });
    }

    // Full file response
    const buffer = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${recording.original_name}"`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileSize),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to serve recording" }, { status: 500 });
  }
}
