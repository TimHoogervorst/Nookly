import { getDb } from "./db-core";

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
