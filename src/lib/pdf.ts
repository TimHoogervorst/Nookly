import path from "path";
import fs from "fs/promises";
import * as pdfjsLib from "pdfjs-dist";

const PDFS_DIR = path.join(process.cwd(), "data", "pdfs");

/**
 * Ensure the PDFs storage directory exists.
 */
export async function ensurePdfDir(): Promise<void> {
  await fs.mkdir(PDFS_DIR, { recursive: true });
}

/**
 * Generate a unique filename for a stored PDF.
 */
export function generateStoredFilename(originalName: string): string {
  const ext = path.extname(originalName) || ".pdf";
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}

/**
 * Get the full filesystem path for a stored PDF.
 */
export function getPdfFilePath(filename: string): string {
  return path.join(PDFS_DIR, filename);
}

/**
 * Delete a PDF file from the filesystem.
 */
export async function deletePdfFile(filename: string): Promise<void> {
  const filePath = getPdfFilePath(filename);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Extract full text from a PDF buffer using pdfjs-dist directly.
 * Returns per-page text arrays, full text, and page count.
 */
export async function extractPdfFullText(buffer: Uint8Array): Promise<{
  text: string;
  pageCount: number;
  pages: string[];
}> {
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(pageText);
  }

  return {
    text: pages.join("\n\n"),
    pageCount: pdf.numPages,
    pages,
  };
}
