import fs from "fs";
import Database from "better-sqlite3";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "pdfai.db");

let db: Database.Database;
let testDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (testDb) return testDb;
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

/**
 * Swap the database for testing. Pass an in-memory database before
 * importing entity modules so they see the test instance.
 */
export function setDbForTesting(test: Database.Database): void {
  testDb = test;
}

function initSchema(database: Database.Database): void {
  database.exec(`
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
      target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
      target_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text_anchor','position')),
      anchor_data TEXT NOT NULL,
      content TEXT NOT NULL,
      start_word INTEGER,
      end_word INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
      target_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      color TEXT NOT NULL DEFAULT '#fef08a',
      anchor_data TEXT NOT NULL,
      start_word INTEGER,
      end_word INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
      target_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    CREATE TABLE IF NOT EXISTS recording_tags (
      recording_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (recording_id, tag_id),
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pdf_chunks_pdf_id ON pdf_chunks(pdf_id);
    -- idx_comments_target, idx_highlights_target, and idx_chat_sessions_target
    -- reference migrated columns (target_type, target_id) and are created by
    -- the migration blocks below. Creating them here would fail against
    -- old-schema tables that lack those columns.
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_tags_pdf_id ON pdf_tags(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_tags_tag_id ON pdf_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_recording_segments_recording_id ON recording_segments(recording_id);
    CREATE INDEX IF NOT EXISTS idx_recording_tags_recording_id ON recording_tags(recording_id);
    CREATE INDEX IF NOT EXISTS idx_recording_tags_tag_id ON recording_tags(tag_id);
  `);

  // ── Migrations ──────────────────────────────────────
  try { database.exec("DROP TABLE IF EXISTS folders"); } catch {}
  try { database.exec("ALTER TABLE pdfs ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE pdfs ADD COLUMN last_opened_at TEXT"); } catch {}
  try { database.exec("ALTER TABLE recordings ADD COLUMN raw_segments TEXT"); } catch {}
  try { database.exec("ALTER TABLE highlights ADD COLUMN start_word INTEGER"); } catch {}
  try { database.exec("ALTER TABLE highlights ADD COLUMN end_word INTEGER"); } catch {}
  try { database.exec("ALTER TABLE comments ADD COLUMN start_word INTEGER"); } catch {}
  try { database.exec("ALTER TABLE comments ADD COLUMN end_word INTEGER"); } catch {}

  // Migration: polymorphic refactor — comments
  // Check for old schema (has pdf_id column) rather than new schema
  // (has target_type), because "new schema missing" could also mean the
  // table doesn't exist at all — and we'd fail on ALTER TABLE RENAME.
  try {
    database.exec("SELECT pdf_id FROM comments LIMIT 1");
    // Old schema detected — migrate inside a transaction so partial
    // failures don't leave the database in a broken intermediate state.
    database.exec("BEGIN");
    database.exec(`
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
    database.exec("COMMIT");
  } catch {
    // Table doesn't exist, or already migrated, or migration failed.
    // If migration was attempted and failed, ROLLBACK undoes any partial
    // changes. The CREATE TABLE IF NOT EXISTS at the top of initSchema
    // ensures the new table will exist regardless.
    try { database.exec("ROLLBACK"); } catch {}
  }

  // Migration: polymorphic refactor — highlights
  try {
    database.exec("SELECT pdf_id FROM highlights LIMIT 1");
    database.exec("BEGIN");
    database.exec(`
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
    database.exec("COMMIT");
  } catch {
    try { database.exec("ROLLBACK"); } catch {}
  }

  // Migration: polymorphic refactor — chat_sessions
  try {
    database.exec("SELECT pdf_id FROM chat_sessions LIMIT 1");
    database.exec("BEGIN");
    database.exec(`
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
    database.exec("COMMIT");
  } catch {
    try { database.exec("ROLLBACK"); } catch {}
  }
}

export function getPdfPath(relativePath: string): string {
  return path.join(DATA_DIR, "pdfs", relativePath);
}

export function getRecordingPath(relativePath: string): string {
  return path.join(DATA_DIR, "recordings", relativePath);
}
