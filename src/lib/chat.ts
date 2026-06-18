import { getDb } from "./db-core";

export interface ChatSession {
  id: number;
  target_type: string;
  target_id: number;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

// ── Sessions ────────────────────────────────────────

export function listSessions(targetType: string, targetId: number): ChatSession[] {
  return getDb()
    .prepare("SELECT * FROM chat_sessions WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC")
    .all(targetType, targetId) as ChatSession[];
}

export function createSession(targetType: string, targetId: number, title?: string): ChatSession {
  const stmt = getDb().prepare("INSERT INTO chat_sessions (target_type, target_id, title) VALUES (?, ?, ?)");
  const result = stmt.run(targetType, targetId, title || "New Chat");
  return getDb()
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get(result.lastInsertRowid) as ChatSession;
}

export function deleteSession(id: number): void {
  getDb().prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
}

// ── Messages ────────────────────────────────────────

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
