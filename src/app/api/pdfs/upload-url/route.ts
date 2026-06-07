import { NextRequest, NextResponse } from "next/server";
import { insertPdf, insertChunk, getDb, getSetting } from "@/lib/db";
import { ensurePdfDir, generateStoredFilename, getPdfFilePath, extractPdfFullText } from "@/lib/pdf";
import { splitIntoChunks, generateEmbedding } from "@/lib/rag";
import fs from "fs/promises";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await ensurePdfDir();

    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Try multiple fetch strategies — many hosts block non-browser requests
    const buffer = await fetchPdfWithRetry(url);
    if (!buffer) {
      return NextResponse.json(
        { error: "Could not download this PDF. The server may be blocking automated requests. Try downloading the file manually and uploading it instead." },
        { status: 400 }
      );
    }

    // Generate a filename from the URL
    const urlPath = parsed.pathname;
    const urlFilename = urlPath.split("/").pop() || "document.pdf";
    const originalName = urlFilename.endsWith(".pdf") ? urlFilename : `${urlFilename}.pdf`;

    const storedFilename = generateStoredFilename(originalName);
    const filePath = getPdfFilePath(storedFilename);

    await fs.writeFile(filePath, buffer);

    // Create PDF record
    const pdf = insertPdf(storedFilename, originalName, storedFilename, 0);

    // Process in background
    processPdfInBackground(pdf.id, new Uint8Array(buffer)).catch((err) => {
      console.error(`Background processing failed for PDF ${pdf.id}:`, err);
    });

    return NextResponse.json(pdf, { status: 201 });
  } catch (error) {
    console.error("URL upload error:", error);
    return NextResponse.json({ error: "Failed to download PDF from URL" }, { status: 500 });
  }
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CURL_UA = "curl/8.0";

async function fetchPdfWithRetry(url: string): Promise<Buffer | null> {
  const headersList: Array<Record<string, string>> = [
    // Strategy 1: Full browser headers
    {
      "User-Agent": BROWSER_UA,
      "Accept": "application/pdf,text/html,application/xhtml+xml,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
    // Strategy 2: Curl-like
    {
      "User-Agent": CURL_UA,
      "Accept": "*/*",
    },
    // Strategy 3: Bare minimum
    {
      "User-Agent": BROWSER_UA,
    },
  ];

  for (const headers of headersList) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.slice(0, 5).toString().startsWith("%PDF-")) {
          return buf;
        }
        return null; // Not a PDF, don't retry
      }

      // 403/401 — try next strategy; anything else, stop
      if (response.status !== 403 && response.status !== 401) {
        return null;
      }
    } catch {
      continue; // Network error — try next
    }
  }

  return null;
}

async function processPdfInBackground(pdfId: number, buffer: Uint8Array): Promise<void> {
  try {
    const { pages: pageTexts, pageCount } = await extractPdfFullText(buffer);
    getDb().prepare("UPDATE pdfs SET page_count = ? WHERE id = ?").run(pageCount, pdfId);

    const apiKey = getSetting("api_key");
    for (let i = 0; i < pageTexts.length; i++) {
      const pageNum = i + 1;
      const chunks = splitIntoChunks(pageTexts[i]);
      for (let j = 0; j < chunks.length; j++) {
        const chunkText = chunks[j];
        if (apiKey) {
          try {
            const embedding = await generateEmbedding(chunkText);
            insertChunk(pdfId, pageNum, j, chunkText, embedding);
            continue;
          } catch {}
        }
        insertChunk(pdfId, pageNum, j, chunkText);
      }
    }
  } catch (err) {
    console.error(`PDF processing error for ${pdfId}:`, err);
  }
}
