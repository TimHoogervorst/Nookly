import path from "path";
import { getDb, getPdfPath } from "./db-core";

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

export interface PdfChunk {
  id: number;
  pdf_id: number;
  page_number: number;
  chunk_index: number;
  text_content: string;
  embedding: string | null;
}

// ── PDFs ────────────────────────────────────────────

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

// ── Chunks ──────────────────────────────────────────

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

// Re-export the path helper for convenience
export { getPdfPath };
