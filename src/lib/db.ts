import fs from "fs";
import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";
import { hashPassword } from "./auth";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "pdfai.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

export function seedAdminUser(): void {
  const database = getDb();
  const existing = database.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (existing.count > 0) return;

  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!username || !password) {
    console.log("No ADMIN_USERNAME/ADMIN_PASSWORD env vars set — admin not seeded.");
    return;
  }

  if (password.length < 6) {
    console.log("ADMIN_PASSWORD must be at least 6 characters — admin not seeded.");
    return;
  }

  const passwordHash = hashPassword(password);
  database.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
  console.log("Admin user created from environment variables.");
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pdfs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#012B67',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pdf_tags (
      pdf_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (pdf_id, tag_id),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pdf_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      text_content TEXT NOT NULL,
      embedding TEXT,
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text_anchor', 'position')),
      anchor_data TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT '#fef08a',
      anchor_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pdf_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pdf_id) REFERENCES pdfs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pdf_chunks_pdf_id ON pdf_chunks(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_comments_pdf_id ON comments(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_highlights_pdf_id ON highlights(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_pdf_id ON chat_sessions(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_tags_pdf_id ON pdf_tags(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_tags_tag_id ON pdf_tags(tag_id);

    -- Recordings
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      duration_seconds REAL NOT NULL DEFAULT 0,
      transcript_status TEXT NOT NULL DEFAULT 'processing'
        CHECK(transcript_status IN ('processing','done','error')),
      transcript_text TEXT,
      raw_segments TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recording_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT,
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_recording_segments_recording_id
      ON recording_segments(recording_id);

    CREATE TABLE IF NOT EXISTS recording_tags (
      recording_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (recording_id, tag_id),
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_recording_tags_recording_id
      ON recording_tags(recording_id);
    CREATE INDEX IF NOT EXISTS idx_recording_tags_tag_id
      ON recording_tags(tag_id);
  `);

  // Migration: drop old folders table if it exists
  try { db.exec("DROP TABLE IF EXISTS folders"); } catch {}
  // Migration: add is_favorite and last_opened_at columns to existing pdfs tables
  try { db.exec("ALTER TABLE pdfs ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE pdfs ADD COLUMN last_opened_at TEXT"); } catch {}

  // Migration: polymorphic refactor — comments: pdf_id → target_type + target_id
  try {
    db.exec("SELECT target_type FROM comments LIMIT 1");
  } catch {
    db.exec(`
      ALTER TABLE comments RENAME TO comments_old;
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
        target_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text_anchor','position')),
        anchor_data TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO comments (id, target_type, target_id, page_number, type, anchor_data, content, created_at, updated_at)
        SELECT id, 'pdf', pdf_id, page_number, type, anchor_data, content, created_at, updated_at FROM comments_old;
      DROP TABLE comments_old;
      CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
    `);
  }

  // Migration: polymorphic refactor — highlights: pdf_id → target_type + target_id
  try {
    db.exec("SELECT target_type FROM highlights LIMIT 1");
  } catch {
    db.exec(`
      ALTER TABLE highlights RENAME TO highlights_old;
      CREATE TABLE highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
        target_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT '#fef08a',
        anchor_data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO highlights (id, target_type, target_id, page_number, color, anchor_data, created_at)
        SELECT id, 'pdf', pdf_id, page_number, color, anchor_data, created_at FROM highlights_old;
      DROP TABLE highlights_old;
      CREATE INDEX IF NOT EXISTS idx_highlights_target ON highlights(target_type, target_id);
    `);
  }

  // Migration: polymorphic refactor — chat_sessions: pdf_id → target_type + target_id
  try {
    db.exec("SELECT target_type FROM chat_sessions LIMIT 1");
  } catch {
    db.exec(`
      ALTER TABLE chat_sessions RENAME TO chat_sessions_old;
      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
        target_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chat_sessions (id, target_type, target_id, title, created_at)
        SELECT id, 'pdf', pdf_id, title, created_at FROM chat_sessions_old;
      DROP TABLE chat_sessions_old;
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_target ON chat_sessions(target_type, target_id);
    `);
  }

  // Migration: add raw_segments column to recordings for dynamic paragraph grouping
  try { db.exec("ALTER TABLE recordings ADD COLUMN raw_segments TEXT"); } catch {}
  // Migration: add word position columns for highlights/comments on recordings
  try { db.exec("ALTER TABLE highlights ADD COLUMN start_word INTEGER"); } catch {}
  try { db.exec("ALTER TABLE highlights ADD COLUMN end_word INTEGER"); } catch {}
  try { db.exec("ALTER TABLE comments ADD COLUMN start_word INTEGER"); } catch {}
  try { db.exec("ALTER TABLE comments ADD COLUMN end_word INTEGER"); } catch {}
}

// ── PDFs ────────────────────────────────────────────

export interface PdfRecord {
  id: number;
  filename: string;
  original_name: string;
  file_path: string;
  page_count: number;
  is_favorite: number;
  last_opened_at: string | null;
  created_at: string;
}

export function listPdfs(tagId?: number): PdfRecord[] {
  if (tagId !== undefined) {
    return getDb()
      .prepare(
        `SELECT DISTINCT p.* FROM pdfs p
         JOIN pdf_tags pt ON pt.pdf_id = p.id
         WHERE pt.tag_id = ?
         ORDER BY p.created_at DESC`
      )
      .all(tagId) as PdfRecord[];
  }
  return getDb().prepare("SELECT * FROM pdfs ORDER BY created_at DESC").all() as PdfRecord[];
}

export function getPdf(id: number): PdfRecord | undefined {
  return getDb().prepare("SELECT * FROM pdfs WHERE id = ?").get(id) as PdfRecord | undefined;
}

export function insertPdf(
  filename: string,
  originalName: string,
  filePath: string,
  pageCount: number
): PdfRecord {
  const stmt = getDb().prepare(
    "INSERT INTO pdfs (filename, original_name, file_path, page_count) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(filename, originalName, filePath, pageCount);
  return getPdf(result.lastInsertRowid as number)!;
}

export function renamePdf(id: number, newName: string): PdfRecord | undefined {
  getDb()
    .prepare("UPDATE pdfs SET original_name = ? WHERE id = ?")
    .run(newName, id);
  return getPdf(id);
}

export function deletePdf(id: number): void {
  const pdf = getPdf(id);
  if (!pdf) return;
  const db = getDb();
  db.prepare("DELETE FROM comments WHERE target_type='pdf' AND target_id=?").run(id);
  db.prepare("DELETE FROM highlights WHERE target_type='pdf' AND target_id=?").run(id);
  db.prepare("DELETE FROM chat_sessions WHERE target_type='pdf' AND target_id=?").run(id);
  db.prepare("DELETE FROM pdfs WHERE id = ?").run(id);
}

export function toggleFavorite(id: number): PdfRecord | undefined {
  const db = getDb();
  db.prepare("UPDATE pdfs SET is_favorite = 1 - is_favorite WHERE id = ?").run(id);
  return getPdf(id);
}

export function getFavorites(): PdfRecord[] {
  return getDb()
    .prepare("SELECT * FROM pdfs WHERE is_favorite = 1 ORDER BY created_at DESC")
    .all() as PdfRecord[];
}

export function getRecentPdfs(limit = 10): PdfRecord[] {
  return getDb()
    .prepare("SELECT * FROM pdfs WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT ?")
    .all(limit) as PdfRecord[];
}

export function touchPdf(id: number): void {
  getDb()
    .prepare("UPDATE pdfs SET last_opened_at = datetime('now') WHERE id = ?")
    .run(id);
}

// ── Tags ────────────────────────────────────────────

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export function listTags(): Tag[] {
  return getDb().prepare("SELECT * FROM tags ORDER BY name ASC").all() as Tag[];
}

export function createTag(name: string, color?: string): Tag {
  const stmt = getDb().prepare("INSERT INTO tags (name, color) VALUES (?, ?)");
  const result = stmt.run(name, color || "#012B67");
  return getDb().prepare("SELECT * FROM tags WHERE id = ?").get(result.lastInsertRowid) as Tag;
}

export function updateTag(id: number, name?: string, color?: string): Tag | undefined {
  if (name) getDb().prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, id);
  if (color) getDb().prepare("UPDATE tags SET color = ? WHERE id = ?").run(color, id);
  return getDb().prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag | undefined;
}

export function deleteTag(id: number): void {
  getDb().prepare("DELETE FROM tags WHERE id = ?").run(id);
}

export function getTagsForPdf(pdfId: number): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN pdf_tags pt ON pt.tag_id = t.id
       WHERE pt.pdf_id = ?
       ORDER BY t.name ASC`
    )
    .all(pdfId) as Tag[];
}

export function addTagToPdf(pdfId: number, tagId: number): void {
  try {
    getDb().prepare("INSERT OR IGNORE INTO pdf_tags (pdf_id, tag_id) VALUES (?, ?)").run(pdfId, tagId);
  } catch {}
}

export function removeTagFromPdf(pdfId: number, tagId: number): void {
  getDb().prepare("DELETE FROM pdf_tags WHERE pdf_id = ? AND tag_id = ?").run(pdfId, tagId);
}

export function setPdfTags(pdfId: number, tagIds: number[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM pdf_tags WHERE pdf_id = ?").run(pdfId);
    const stmt = db.prepare("INSERT INTO pdf_tags (pdf_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) {
      stmt.run(pdfId, tagId);
    }
  });
  tx();
}

// ── PDF Chunks ──────────────────────────────────────

export interface PdfChunk {
  id: number;
  pdf_id: number;
  page_number: number;
  chunk_index: number;
  text_content: string;
  embedding: string | null;
}

export function insertChunk(
  pdfId: number,
  pageNumber: number,
  chunkIndex: number,
  text: string,
  embedding?: number[]
): PdfChunk {
  const stmt = getDb().prepare(
    "INSERT INTO pdf_chunks (pdf_id, page_number, chunk_index, text_content, embedding) VALUES (?, ?, ?, ?, ?)"
  );
  const embJson = embedding ? JSON.stringify(embedding) : null;
  const result = stmt.run(pdfId, pageNumber, chunkIndex, text, embJson);
  return getDb()
    .prepare("SELECT * FROM pdf_chunks WHERE id = ?")
    .get(result.lastInsertRowid) as PdfChunk;
}

export function getChunksForPdf(pdfId: number): PdfChunk[] {
  return getDb()
    .prepare("SELECT * FROM pdf_chunks WHERE pdf_id = ? ORDER BY page_number, chunk_index")
    .all(pdfId) as PdfChunk[];
}

export function deleteChunksForPdf(pdfId: number): void {
  getDb().prepare("DELETE FROM pdf_chunks WHERE pdf_id = ?").run(pdfId);
}

// ── Comments ────────────────────────────────────────

export interface Comment {
  id: number;
  target_type: string;
  target_id: number;
  page_number: number;
  type: "text_anchor" | "position";
  anchor_data: string;
  content: string;
  start_word: number | null;
  end_word: number | null;
  created_at: string;
  updated_at: string;
}

export function getComments(targetType: string, targetId: number, pageNumber?: number): Comment[];
export function getComments(pdfId: number, pageNumber?: number): Comment[];
export function getComments(
  targetTypeOrPdfId: string | number,
  targetIdOrPageNumber?: number,
  maybePageNumber?: number
): Comment[] {
  let targetType: string;
  let targetId: number;
  let pageNumber: number | undefined;
  if (typeof targetTypeOrPdfId === "number") {
    targetType = "pdf";
    targetId = targetTypeOrPdfId;
    pageNumber = targetIdOrPageNumber;
  } else {
    targetType = targetTypeOrPdfId;
    targetId = targetIdOrPageNumber!;
    pageNumber = maybePageNumber;
  }
  if (pageNumber !== undefined) {
    return getDb()
      .prepare("SELECT * FROM comments WHERE target_type = ? AND target_id = ? AND page_number = ? ORDER BY created_at ASC")
      .all(targetType, targetId, pageNumber) as Comment[];
  }
  return getDb()
    .prepare("SELECT * FROM comments WHERE target_type = ? AND target_id = ? ORDER BY page_number, created_at ASC")
    .all(targetType, targetId) as Comment[];
}

export function insertComment(
  targetType: string, targetId: number, pageNumber: number, type: "text_anchor" | "position", anchorData: object, content: string
): Comment;
export function insertComment(
  pdfId: number, pageNumber: number, type: "text_anchor" | "position", anchorData: object, content: string
): Comment;
export function insertComment(
  targetTypeOrPdfId: string | number,
  targetIdOrPageNumber: number,
  typeOrPageNumber: number | "text_anchor" | "position",
  anchorDataOrType: object | "text_anchor" | "position",
  contentOrAnchorData?: object | string,
  maybeContent?: string
): Comment {
  let targetType: string;
  let targetId: number;
  let pageNumber: number;
  let type: "text_anchor" | "position";
  let anchorData: object;
  let content: string;
  if (typeof targetTypeOrPdfId === "number") {
    targetType = "pdf";
    targetId = targetTypeOrPdfId;
    pageNumber = targetIdOrPageNumber;
    type = typeOrPageNumber as "text_anchor" | "position";
    anchorData = anchorDataOrType as object;
    content = contentOrAnchorData as string;
  } else {
    targetType = targetTypeOrPdfId;
    targetId = targetIdOrPageNumber;
    pageNumber = typeOrPageNumber as number;
    type = anchorDataOrType as "text_anchor" | "position";
    anchorData = contentOrAnchorData as object;
    content = maybeContent!;
  }
  const stmt = getDb().prepare(
    "INSERT INTO comments (target_type, target_id, page_number, type, anchor_data, content) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const result = stmt.run(targetType, targetId, pageNumber, type, JSON.stringify(anchorData), content);
  return getDb()
    .prepare("SELECT * FROM comments WHERE id = ?")
    .get(result.lastInsertRowid) as Comment;
}

export function insertCommentWithWords(
  targetType: string,
  targetId: number,
  pageNumber: number,
  type: "text_anchor" | "position",
  anchorData: object,
  content: string,
  startWord?: number | null,
  endWord?: number | null
): Comment {
  const stmt = getDb().prepare(
    "INSERT INTO comments (target_type, target_id, page_number, type, anchor_data, content, start_word, end_word) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const result = stmt.run(
    targetType, targetId, pageNumber, type, JSON.stringify(anchorData), content,
    startWord ?? null, endWord ?? null
  );
  return getDb()
    .prepare("SELECT * FROM comments WHERE id = ?")
    .get(result.lastInsertRowid) as Comment;
}

export function updateComment(id: number, content: string): Comment | undefined {
  getDb()
    .prepare("UPDATE comments SET content = ?, updated_at = datetime('now') WHERE id = ?")
    .run(content, id);
  return getDb().prepare("SELECT * FROM comments WHERE id = ?").get(id) as Comment | undefined;
}

export function deleteComment(id: number): void {
  getDb().prepare("DELETE FROM comments WHERE id = ?").run(id);
}

// ── Chat Sessions ───────────────────────────────────

export interface ChatSession {
  id: number;
  target_type: string;
  target_id: number;
  title: string;
  created_at: string;
}

export function listSessions(targetType: string, targetId: number): ChatSession[];
export function listSessions(pdfId: number): ChatSession[];
export function listSessions(targetTypeOrPdfId: string | number, targetId?: number): ChatSession[] {
  let targetType: string;
  let tid: number;
  if (typeof targetTypeOrPdfId === "number") {
    targetType = "pdf";
    tid = targetTypeOrPdfId;
  } else {
    targetType = targetTypeOrPdfId;
    tid = targetId!;
  }
  return getDb()
    .prepare("SELECT * FROM chat_sessions WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC")
    .all(targetType, tid) as ChatSession[];
}

export function createSession(targetType: string, targetId: number, title?: string): ChatSession;
export function createSession(pdfId: number, title?: string): ChatSession;
export function createSession(
  targetTypeOrPdfId: string | number,
  targetIdOrTitle?: number | string,
  maybeTitle?: string
): ChatSession {
  let targetType: string;
  let targetId: number;
  let title: string | undefined;
  if (typeof targetTypeOrPdfId === "number") {
    targetType = "pdf";
    targetId = targetTypeOrPdfId;
    title = typeof targetIdOrTitle === "string" ? targetIdOrTitle : undefined;
  } else {
    targetType = targetTypeOrPdfId;
    targetId = targetIdOrTitle as number;
    title = maybeTitle;
  }
  const stmt = getDb().prepare("INSERT INTO chat_sessions (target_type, target_id, title) VALUES (?, ?, ?)");
  const result = stmt.run(targetType, targetId, title || "New Chat");
  return getDb()
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get(result.lastInsertRowid) as ChatSession;
}

export function deleteSession(id: number): void {
  getDb().prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
}

// ── Chat Messages ───────────────────────────────────

export interface ChatMessage {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export function getMessages(sessionId: number): ChatMessage[] {
  return getDb()
    .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as ChatMessage[];
}

export function insertMessage(
  sessionId: number,
  role: "user" | "assistant" | "system",
  content: string
): ChatMessage {
  const stmt = getDb().prepare(
    "INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)"
  );
  const result = stmt.run(sessionId, role, content);
  return getDb()
    .prepare("SELECT * FROM chat_messages WHERE id = ?")
    .get(result.lastInsertRowid) as ChatMessage;
}

// ── Settings ────────────────────────────────────────

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ── Highlights ──────────────────────────────────────

export interface Highlight {
  id: number;
  target_type: string;
  target_id: number;
  page_number: number;
  color: string;
  anchor_data: string;
  start_word: number | null;
  end_word: number | null;
  created_at: string;
}

export function getHighlights(targetType: string, targetId: number, pageNumber?: number): Highlight[];
export function getHighlights(pdfId: number, pageNumber?: number): Highlight[];
export function getHighlights(
  targetTypeOrPdfId: string | number,
  targetIdOrPageNumber?: number,
  maybePageNumber?: number
): Highlight[] {
  let targetType: string;
  let targetId: number;
  let pageNumber: number | undefined;
  if (typeof targetTypeOrPdfId === "number") {
    targetType = "pdf";
    targetId = targetTypeOrPdfId;
    pageNumber = targetIdOrPageNumber;
  } else {
    targetType = targetTypeOrPdfId;
    targetId = targetIdOrPageNumber!;
    pageNumber = maybePageNumber;
  }
  if (pageNumber !== undefined) {
    return getDb()
      .prepare("SELECT * FROM highlights WHERE target_type = ? AND target_id = ? AND page_number = ? ORDER BY created_at ASC")
      .all(targetType, targetId, pageNumber) as Highlight[];
  }
  return getDb()
    .prepare("SELECT * FROM highlights WHERE target_type = ? AND target_id = ? ORDER BY page_number, created_at ASC")
    .all(targetType, targetId) as Highlight[];
}

export function insertHighlight(
  targetType: string, targetId: number, pageNumber: number, color: string, anchorData: object
): Highlight;
export function insertHighlight(
  pdfId: number, pageNumber: number, color: string, anchorData: object
): Highlight;
export function insertHighlight(
  targetTypeOrPdfId: string | number,
  targetIdOrPageNumber: number,
  colorOrPageNumber: number | string,
  anchorDataOrColor: object | string,
  maybeAnchorData?: object
): Highlight {
  let targetType: string;
  let targetId: number;
  let pageNumber: number;
  let color: string;
  let anchorData: object;
  if (typeof targetTypeOrPdfId === "number") {
    targetType = "pdf";
    targetId = targetTypeOrPdfId;
    pageNumber = targetIdOrPageNumber;
    color = colorOrPageNumber as string;
    anchorData = anchorDataOrColor as object;
  } else {
    targetType = targetTypeOrPdfId;
    targetId = targetIdOrPageNumber;
    pageNumber = colorOrPageNumber as number;
    color = anchorDataOrColor as string;
    anchorData = maybeAnchorData!;
  }
  const result = getDb()
    .prepare("INSERT INTO highlights (target_type, target_id, page_number, color, anchor_data) VALUES (?, ?, ?, ?, ?)")
    .run(targetType, targetId, pageNumber, color, JSON.stringify(anchorData));
  return getDb()
    .prepare("SELECT * FROM highlights WHERE id = ?")
    .get(result.lastInsertRowid) as Highlight;
}

export function insertHighlightWithWords(
  targetType: string,
  targetId: number,
  pageNumber: number,
  color: string,
  anchorData: object,
  startWord?: number | null,
  endWord?: number | null
): Highlight {
  const result = getDb()
    .prepare("INSERT INTO highlights (target_type, target_id, page_number, color, anchor_data, start_word, end_word) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(targetType, targetId, pageNumber, color, JSON.stringify(anchorData), startWord ?? null, endWord ?? null);
  return getDb()
    .prepare("SELECT * FROM highlights WHERE id = ?")
    .get(result.lastInsertRowid) as Highlight;
}

export function updateHighlightColor(id: number, color: string): void {
  getDb().prepare("UPDATE highlights SET color = ? WHERE id = ?").run(color, id);
}

export function deleteHighlight(id: number): void {
  getDb().prepare("DELETE FROM highlights WHERE id = ?").run(id);
}

// ── Utility ─────────────────────────────────────────

export function getPdfPath(relativePath: string): string {
  return path.join(DATA_DIR, "pdfs", relativePath);
}

export function getRecordingPath(relativePath: string): string {
  return path.join(DATA_DIR, "recordings", relativePath);
}

// ── Recordings ───────────────────────────────────────

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

// ── Recording Segments ──────────────────────────────

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

// ── Recording Tags ───────────────────────────────────

export function getTagsForRecording(recordingId: number): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN recording_tags rt ON rt.tag_id = t.id
       WHERE rt.recording_id = ?
       ORDER BY t.name ASC`
    )
    .all(recordingId) as Tag[];
}

export function setRecordingTags(recordingId: number, tagIds: number[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM recording_tags WHERE recording_id = ?").run(recordingId);
    const stmt = db.prepare("INSERT INTO recording_tags (recording_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) {
      stmt.run(recordingId, tagId);
    }
  });
  tx();
}

// ── Users ───────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}

export function createUser(username: string, passwordHash: string): { id: number; username: string } {
  const stmt = getDb().prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)");
  const result = stmt.run(username, passwordHash);
  const user = getDb().prepare("SELECT id, username FROM users WHERE id = ?").get(result.lastInsertRowid) as { id: number; username: string };
  return user;
}

export function getUserByUsername(username: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
}

export function getUserById(id: number): { id: number; username: string } | undefined {
  return getDb().prepare("SELECT id, username FROM users WHERE id = ?").get(id) as { id: number; username: string } | undefined;
}

export function countUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export function updateUserPassword(userId: number, newHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, userId);
}

// ── Sessions ────────────────────────────────────────

export interface Session {
  id: string;
  user_id: number;
  created_at: string;
}

export function createUserSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  getDb().prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

export function getUserSession(token: string): Session | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(token) as Session | undefined;
}

export function deleteUserSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(token);
}
