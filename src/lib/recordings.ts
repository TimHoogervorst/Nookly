import path from "path";
import fs from "fs/promises";

const RECORDINGS_DIR = path.join(process.cwd(), "data", "recordings");

/**
 * Ensure the recordings storage directory exists.
 */
export async function ensureRecordingsDir(): Promise<void> {
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
}

/**
 * Generate a unique filename for a stored recording.
 */
export function generateRecordingFilename(originalName: string): string {
  const ext = path.extname(originalName) || ".webm";
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}

/**
 * Get the full filesystem path for a stored recording.
 */
export function getRecordingFilePath(filename: string): string {
  return path.join(RECORDINGS_DIR, filename);
}

/**
 * Delete a recording file from the filesystem.
 */
export async function deleteRecordingFile(filename: string): Promise<void> {
  const filePath = getRecordingFilePath(filename);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist — that's fine
  }
}

// ── Transcript regrouping ──────────────────────────

export interface RawSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Group Whisper segments into paragraphs by sentence count.
 * Each block contains roughly `sentencesPerBlock` sentences.
 */
export function groupBySentences(
  segments: RawSegment[],
  sentencesPerBlock: number
): RawSegment[] {
  if (segments.length === 0) return [];

  // Merge all segment text, then split into sentences
  const fullText = segments.map((s) => s.text).join(" ");
  const sentences = fullText.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

  if (sentences.length === 0) return [];

  const blocks: RawSegment[] = [];
  const totalDuration =
    segments.length > 0 ? segments[segments.length - 1].end : 0;

  for (let i = 0; i < sentences.length; i += sentencesPerBlock) {
    const slice = sentences.slice(i, i + sentencesPerBlock);
    const ratio = sentences.length > 0 ? (i + slice.length) / sentences.length : 1;
    blocks.push({
      start: totalDuration * (i / sentences.length),
      end: totalDuration * ratio,
      text: slice.join(" "),
    });
  }

  return blocks;
}
