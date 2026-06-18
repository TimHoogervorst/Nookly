import path from "path";
import fs from "fs/promises";
import { getDb, getRecordingPath } from "./db-core";

const RECORDINGS_DIR = path.join(process.cwd(), "data", "recordings");

export interface RecordingRecord {
  id: number;
  filename: string;
  original_name: string;
  file_path: string;
  duration_seconds: number;
  transcript_status: "processing" | "done" | "error";
  transcript_text: string | null;
  raw_segments: string | null;
  is_favorite: number;
  last_opened_at: string | null;
  created_at: string;
}

export interface RecordingSegment {
  id: number;
  recording_id: number;
  segment_index: number;
  start_time: number;
  end_time: number;
  text: string;
  embedding: string | null;
}

// ── Recordings ──────────────────────────────────────

export function listRecordings(tagId?: number): RecordingRecord[] {
  if (tagId !== undefined) {
    return getDb()
      .prepare(
        `SELECT DISTINCT r.* FROM recordings r
         JOIN recording_tags rt ON rt.recording_id = r.id
         WHERE rt.tag_id = ?
         ORDER BY r.created_at DESC`
      )
      .all(tagId) as RecordingRecord[];
  }
  return getDb().prepare("SELECT * FROM recordings ORDER BY created_at DESC").all() as RecordingRecord[];
}

export function getRecording(id: number): RecordingRecord | undefined {
  return getDb().prepare("SELECT * FROM recordings WHERE id = ?").get(id) as RecordingRecord | undefined;
}

export function insertRecording(
  filename: string,
  originalName: string,
  filePath: string
): RecordingRecord {
  const stmt = getDb().prepare(
    "INSERT INTO recordings (filename, original_name, file_path) VALUES (?, ?, ?)"
  );
  const result = stmt.run(filename, originalName, filePath);
  return getRecording(result.lastInsertRowid as number)!;
}

export function updateRecordingStatus(
  id: number,
  status: "processing" | "done" | "error",
  transcriptText?: string,
  durationSeconds?: number,
  rawSegments?: string
): RecordingRecord | undefined {
  if (transcriptText !== undefined && durationSeconds !== undefined) {
    getDb()
      .prepare(
        "UPDATE recordings SET transcript_status = ?, transcript_text = ?, duration_seconds = ?, raw_segments = ? WHERE id = ?"
      )
      .run(status, transcriptText, durationSeconds, rawSegments || null, id);
  } else {
    getDb()
      .prepare("UPDATE recordings SET transcript_status = ? WHERE id = ?")
      .run(status, id);
  }
  return getRecording(id);
}

export function renameRecording(id: number, newName: string): RecordingRecord | undefined {
  getDb()
    .prepare("UPDATE recordings SET original_name = ? WHERE id = ?")
    .run(newName, id);
  return getRecording(id);
}

export function deleteRecording(id: number): void {
  const recording = getRecording(id);
  if (!recording) return;
  const db = getDb();
  db.prepare("DELETE FROM comments WHERE target_type='recording' AND target_id=?").run(id);
  db.prepare("DELETE FROM highlights WHERE target_type='recording' AND target_id=?").run(id);
  db.prepare("DELETE FROM chat_sessions WHERE target_type='recording' AND target_id=?").run(id);
  db.prepare("DELETE FROM recordings WHERE id = ?").run(id);
}

export function toggleFavoriteRecording(id: number): RecordingRecord | undefined {
  const db = getDb();
  db.prepare("UPDATE recordings SET is_favorite = 1 - is_favorite WHERE id = ?").run(id);
  return getRecording(id);
}

export function getFavoriteRecordings(): RecordingRecord[] {
  return getDb()
    .prepare("SELECT * FROM recordings WHERE is_favorite = 1 ORDER BY created_at DESC")
    .all() as RecordingRecord[];
}

export function getRecentRecordings(limit = 10): RecordingRecord[] {
  return getDb()
    .prepare("SELECT * FROM recordings WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT ?")
    .all(limit) as RecordingRecord[];
}

export function touchRecording(id: number): void {
  getDb()
    .prepare("UPDATE recordings SET last_opened_at = datetime('now') WHERE id = ?")
    .run(id);
}

// ── Segments ────────────────────────────────────────

export function insertRecordingSegment(
  recordingId: number,
  segmentIndex: number,
  startTime: number,
  endTime: number,
  text: string,
  embedding?: number[]
): RecordingSegment {
  const stmt = getDb().prepare(
    "INSERT INTO recording_segments (recording_id, segment_index, start_time, end_time, text, embedding) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const embJson = embedding ? JSON.stringify(embedding) : null;
  const result = stmt.run(recordingId, segmentIndex, startTime, endTime, text, embJson);
  return getDb()
    .prepare("SELECT * FROM recording_segments WHERE id = ?")
    .get(result.lastInsertRowid) as RecordingSegment;
}

export function getSegmentsForRecording(recordingId: number): RecordingSegment[] {
  return getDb()
    .prepare("SELECT * FROM recording_segments WHERE recording_id = ? ORDER BY segment_index")
    .all(recordingId) as RecordingSegment[];
}

export function deleteSegmentsForRecording(recordingId: number): void {
  getDb().prepare("DELETE FROM recording_segments WHERE recording_id = ?").run(recordingId);
}

// ── File utilities ────────────────────────────────

export async function ensureRecordingsDir(): Promise<void> {
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
}

export function generateRecordingFilename(originalName: string): string {
  const ext = path.extname(originalName) || ".webm";
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}

export function getRecordingFilePath(filename: string): string {
  return path.join(RECORDINGS_DIR, filename);
}

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

export function groupBySentences(
  segments: RawSegment[],
  sentencesPerBlock: number
): RawSegment[] {
  if (segments.length === 0) return [];

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

// Re-export the path helper for convenience
export { getRecordingPath };
