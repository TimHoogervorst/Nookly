import { getDb } from "./db-core";

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

// ── Comments ────────────────────────────────────────

export function getComments(
  targetType: string,
  targetId: number,
  pageNumber?: number
): Comment[] {
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
  targetType: string,
  targetId: number,
  pageNumber: number,
  type: "text_anchor" | "position",
  anchorData: object,
  content: string,
  opts?: { startWord?: number | null; endWord?: number | null }
): Comment {
  const { startWord = null, endWord = null } = opts || {};
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

// ── Highlights ──────────────────────────────────────

export function getHighlights(
  targetType: string,
  targetId: number,
  pageNumber?: number
): Highlight[] {
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
  targetType: string,
  targetId: number,
  pageNumber: number,
  color: string,
  anchorData: object,
  opts?: { startWord?: number | null; endWord?: number | null }
): Highlight {
  const { startWord = null, endWord = null } = opts || {};
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
