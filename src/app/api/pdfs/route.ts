import { NextRequest, NextResponse } from "next/server";
import { listPdfs, insertPdf, insertChunk, getDb, getSetting, getFavorites, getRecentPdfs } from "@/lib/db";
import { ensurePdfDir, generateStoredFilename, getPdfFilePath, extractPdfFullText } from "@/lib/pdf";
import { splitIntoChunks, generateEmbedding } from "@/lib/rag";
import fs from "fs/promises";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get("tag_id");
    const fav = searchParams.get("favorites");
    const recent = searchParams.get("recent");

    let pdfs;
    if (fav === "1") pdfs = getFavorites();
    else if (recent === "1") pdfs = getRecentPdfs();
    else pdfs = listPdfs(tagId ? parseInt(tagId) : undefined);

    return NextResponse.json(pdfs);
  } catch (error) {
    return NextResponse.json({ error: "Failed to list PDFs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await ensurePdfDir();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
    }

    const storedFilename = generateStoredFilename(file.name);
    const filePath = getPdfFilePath(storedFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // Create the PDF record (page count updated after processing)
    const pdf = insertPdf(storedFilename, file.name, storedFilename, 0);

    // Process in background: extract text, chunk, embed
    processPdfInBackground(pdf.id, new Uint8Array(buffer)).catch((err) => {
      console.error(`Background processing failed for PDF ${pdf.id}:`, err);
    });

    return NextResponse.json(pdf, { status: 201 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Failed to upload PDF" }, { status: 500 });
  }
}

async function processPdfInBackground(pdfId: number, buffer: Uint8Array): Promise<void> {
  try {
    // Extract text
    const { pages: pageTexts, pageCount } = await extractPdfFullText(buffer);

    // Update page count
    getDb().prepare("UPDATE pdfs SET page_count = ? WHERE id = ?").run(pageCount, pdfId);

    // Check if embeddings are configured
    const apiKey = getSetting("api_key");
    if (!apiKey) {
      console.log(`Skipping embeddings for PDF ${pdfId} — no API key configured`);
      // Still save chunks without embeddings
      for (let i = 0; i < pageTexts.length; i++) {
        const pageNum = i + 1;
        const chunks = splitIntoChunks(pageTexts[i]);
        for (let j = 0; j < chunks.length; j++) {
          insertChunk(pdfId, pageNum, j, chunks[j]);
        }
      }
      return;
    }

    // Process each page
    for (let i = 0; i < pageTexts.length; i++) {
      const pageNum = i + 1;
      const chunks = splitIntoChunks(pageTexts[i]);

      for (let j = 0; j < chunks.length; j++) {
        const chunkText = chunks[j];
        try {
          const embedding = await generateEmbedding(chunkText);
          insertChunk(pdfId, pageNum, j, chunkText, embedding);
        } catch (err) {
          // Save without embedding if generation fails
          console.error(`Embedding failed for chunk ${j} on page ${pageNum}:`, err);
          insertChunk(pdfId, pageNum, j, chunkText);
        }
      }
    }

    console.log(`Processed PDF ${pdfId}: ${pageCount} pages, embeddings generated`);
  } catch (err) {
    console.error(`PDF processing error for ${pdfId}:`, err);
  }
}
