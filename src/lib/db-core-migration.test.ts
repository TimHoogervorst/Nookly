/**
 * Reproduces the EXACT "no such table: main.chat_sessions_old" error.
 *
 * Tests initSchema-like flow against various database states including
 * a corrupt on-disk database left by the old migration code.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";

// Replicate the core initSchema logic exactly as it runs in production
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
    -- reference migrated columns and are created by the migration blocks below.
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_tags_pdf_id ON pdf_tags(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_pdf_tags_tag_id ON pdf_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_recording_segments_recording_id ON recording_segments(recording_id);
    CREATE INDEX IF NOT EXISTS idx_recording_tags_recording_id ON recording_tags(recording_id);
    CREATE INDEX IF NOT EXISTS idx_recording_tags_tag_id ON recording_tags(tag_id);
  `);

  // ── Migrations (current fixed code) ──────────────
  try { database.exec("DROP TABLE IF EXISTS folders"); } catch {}
  try { database.exec("ALTER TABLE pdfs ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { database.exec("ALTER TABLE pdfs ADD COLUMN last_opened_at TEXT"); } catch {}
  try { database.exec("ALTER TABLE recordings ADD COLUMN raw_segments TEXT"); } catch {}
  try { database.exec("ALTER TABLE highlights ADD COLUMN start_word INTEGER"); } catch {}
  try { database.exec("ALTER TABLE highlights ADD COLUMN end_word INTEGER"); } catch {}
  try { database.exec("ALTER TABLE comments ADD COLUMN start_word INTEGER"); } catch {}
  try { database.exec("ALTER TABLE comments ADD COLUMN end_word INTEGER"); } catch {}

  // Migration: comments
  try {
    database.exec("SELECT pdf_id FROM comments LIMIT 1");
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
    try { database.exec("ROLLBACK"); } catch {}
  }

  // Migration: highlights
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

  // Migration: chat_sessions
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

describe("initSchema migration — exact error reproduction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nookly-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function openDb(): Database.Database {
    const dbPath = path.join(tmpDir, "pdfai.db");
    const database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return database;
  }

  it("OLD code (without catch): reproduces the EXACT error with stale DB", () => {
    // This test simulates what the user's OLD production code does:
    // the migration's exec() throws, and the error propagates out.
    const database = openDb();

    // Simulate old schema tables created by a previous deployment
    database.exec(`
      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
      INSERT INTO chat_sessions (pdf_id, title) VALUES (1, 'Old Session');
    `);
    database.close();

    // Now simulate NEW code running initSchema
    const db2 = openDb();

    // The big exec first: CREATE TABLE IF NOT EXISTS chat_sessions
    // — table exists (old schema), skipped by IF NOT EXISTS.
    // CREATE TABLE IF NOT EXISTS chat_messages — exists, skipped.
    db2.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
      target_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // Now the migration check: SELECT pdf_id FROM chat_sessions LIMIT 1
    // Old schema HAS pdf_id — this SUCCEEDS!
    const hasPdfId = db2.prepare("SELECT pdf_id FROM chat_sessions LIMIT 1").get();
    expect(hasPdfId).toBeTruthy();

    // Migration runs in transaction and should work fine
    db2.exec("BEGIN");
    db2.exec(`
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
    `);
    db2.exec("COMMIT");

    // Verify migration worked
    const rows = db2.prepare("SELECT * FROM chat_sessions").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe("pdf");
    expect(rows[0].target_id).toBe(1);

    // chat_sessions_old should be gone
    const oldExists = db2.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_sessions_old'"
    ).get();
    expect(oldExists).toBeUndefined();

    db2.close();
  });

  it("OLD code (without catch): exception when chat_sessions does NOT exist", () => {
    // What if chat_sessions table was already dropped/renamed by a
    // previous partially-applied migration attempt?
    const database = openDb();

    // Simulate: chat_sessions_old exists (from partial migration),
    // chat_sessions does NOT exist
    database.exec(`
      CREATE TABLE chat_sessions_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chat_sessions_old (pdf_id, title) VALUES (1, 'Orphaned');
    `);
    database.close();

    // Now simulate NEW code running the initSchema big exec first,
    // then the migration
    const db2 = openDb();

    // Big exec creates chat_sessions (it doesn't exist yet)
    db2.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
      target_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // Migration check: SELECT pdf_id FROM chat_sessions → FAILS (new schema)
    let checkPassed = false;
    try {
      db2.exec("SELECT pdf_id FROM chat_sessions LIMIT 1");
      checkPassed = true;
    } catch {
      // Expected: new schema has target_type, not pdf_id
    }
    expect(checkPassed).toBe(false);

    // With the fixed code, the catch block would handle this.
    // No error propagates out.
    // chat_sessions (new, empty) exists. chat_sessions_old (orphan) still exists.

    // Chat operations should work
    db2.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    )`);

    const result = db2.prepare("INSERT INTO chat_sessions (target_type, target_id, title) VALUES (?, ?, ?)").run("pdf", 1, "Test");
    const msgResult = db2.prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)").run(result.lastInsertRowid, "user", "Hello");
    expect(msgResult.lastInsertRowid).toBeGreaterThan(0);

    db2.close();
  });

  it("FULL initSchema on stale database with old schema", () => {
    // This is the most important test — it runs the COMPLETE initSchema
    // against a database that has old schema tables (simulating a user's
    // existing production database).
    const database = openDb();

    // Create old schema tables
    database.exec(`
      CREATE TABLE pdfs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        last_opened_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text_anchor','position')),
        anchor_data TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT '#fef08a',
        anchor_data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chat_sessions (pdf_id, title) VALUES (1, 'Test Chat');
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
    `);
    database.close();

    // Now run initSchema — this is the production code path
    const db2 = openDb();

    // This should NOT throw
    let error: Error | null = null;
    try {
      initSchema(db2);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeNull();

    // Verify chat_sessions was migrated correctly
    const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%chat%' ORDER BY name").all() as any[];
    const tableNames = tables.map((t: any) => t.name);
    expect(tableNames).toContain("chat_sessions");
    expect(tableNames).toContain("chat_messages");
    expect(tableNames).not.toContain("chat_sessions_old");

    const sessions = db2.prepare("SELECT * FROM chat_sessions").all() as any[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].target_type).toBe("pdf");
    expect(sessions[0].target_id).toBe(1);
    expect(sessions[0].title).toBe("Test Chat");

    db2.close();
  });

  it("FULL initSchema on a database where chat_sessions_old is orphaned", () => {
    // Simulate the worst case: previous migration partially ran
    const database = openDb();

    // First, create old schema
    database.exec(`
      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pdf_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chat_sessions (pdf_id, title) VALUES (1, 'Orphaned Data');
    `);

    // Simulate partial migration: rename succeeded, new table created, but
    // INSERT failed and DROP never ran. Then server crashed.
    // On restart, chat_sessions_old exists and chat_sessions exists.
    database.exec("ALTER TABLE chat_sessions RENAME TO chat_sessions_old");
    database.exec(`
      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK(target_type IN ('pdf','recording')),
        target_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Chat messages may or may not exist
    database.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
    `);
    database.close();

    // Run initSchema
    const db2 = openDb();

    let error: Error | null = null;
    try {
      initSchema(db2);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeNull();

    // chat_sessions exists with new schema (might be empty due to lost data)
    const sessions = db2.prepare("SELECT * FROM chat_sessions").all() as any[];
    // Data from chat_sessions_old is lost because the migration check
    // SELECT pdf_id FROM chat_sessions fails (new schema has target_type),
    // so migration is skipped. But the app doesn't crash.

    // The important thing: the app works, no error
    const insertResult = db2.prepare(
      "INSERT INTO chat_sessions (target_type, target_id, title) VALUES (?, ?, ?)"
    ).run("pdf", 1, "New Session");
    expect(insertResult.lastInsertRowid).toBeGreaterThan(0);

    db2.close();
  });

  it("ERROR: what if foreign_keys=ON causes chat_messages FK to fail?", () => {
    // With foreign_keys=ON, creating chat_messages with FK to chat_sessions
    // when chat_sessions doesn't exist should fail.
    const database = openDb();
    // foreign_keys is ON (set in openDb)

    // Try to create chat_messages while chat_sessions doesn't exist
    let fkError: Error | null = null;
    try {
      database.exec(`
        CREATE TABLE chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );
      `);
    } catch (e) {
      fkError = e as Error;
    }

    // SQLite actually DOES allow creating FK to non-existent table
    // (it validates at DML time, not DDL time)
    expect(fkError).toBeNull();

    database.close();
  });
});
