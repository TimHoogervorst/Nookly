import path from "path";
import { pathToFileURL } from "url";
import fs from "fs/promises";
import * as pdfjsLib from "pdfjs-dist";

// In Node.js, pdfjs-dist defaults workerSrc to "./pdf.worker.mjs" (relative).
// In Next.js bundled output, that relative path resolves against the chunk file in
// .next/server/chunks/, where the worker doesn't exist — Turbopack rewrites the
// internal dynamic import despite the webpackIgnore:true comment.
//
// Point workerSrc at the actual node_modules file so the runtime import succeeds.
// On Windows, absolute paths must be file:// URLs for the ESM loader.
// This must execute before any pdfjs-dist API calls (getDocument, etc.).
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "build",
    "pdf.worker.mjs",
  ),
).href;

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
