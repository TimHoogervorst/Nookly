import { NextRequest, NextResponse } from "next/server";
import { insertPdf, insertChunk } from "@/lib/pdfs";
import { getDb } from "@/lib/db-core";
import { getSetting } from "@/lib/users";
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

    const safeUrl = validateAndNormalizeExternalUrl(url);
    if (!safeUrl) {
      return NextResponse.json({ error: "Invalid or disallowed URL" }, { status: 400 });
    }

    const parsed = new URL(safeUrl);

    // Try multiple fetch strategies — many hosts block non-browser requests
    const buffer = await fetchPdfWithRetry(safeUrl);
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

const MAX_REDIRECTS = 5;

function validateAndNormalizeExternalUrl(input: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  if (isDisallowedHostname(parsed.hostname)) {
    return null;
  }

  return parsed.toString();
}

function isDisallowedHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();

  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "::1") return true;

  // IPv6 literal in URL.hostname may appear without brackets in WHATWG URL.
  if (h.includes(":")) {
    return isDisallowedIPv6(h);
  }

  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    return isDisallowedIPv4(h);
  }

  return false;
}

function isDisallowedIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);

  // loopback 127.0.0.0/8
  if (a === 127) return true;
  // private 10.0.0.0/8
  if (a === 10) return true;
  // private 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // private 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // link-local 169.254.0.0/16
  if (a === 169 && b === 254) return true;
  // unspecified/current network 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

function isDisallowedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified
  if (normalized.startsWith("fe80:")) return true; // link-local fe80::/10
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local fc00::/7

  // IPv4-mapped IPv6 (::ffff:0:0/96) — these encode internal IPv4 addresses
  // and should never be reachable on the public internet.
  if (normalized.startsWith("::ffff:")) return true;

  return false;
}

async function fetchWithRedirectValidation(
  url: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount < MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });

    if (response.status >= 300 && response.status < 400) {
      // Release the response body since we won't read it
      await response.body?.cancel();

      const location = response.headers.get("location");
      if (!location) return null;

      // Resolve relative redirects against the current URL per WHATWG URL
      const nextUrl = new URL(location, currentUrl).toString();
      const validated = validateAndNormalizeExternalUrl(nextUrl);
      if (!validated) return null; // redirect to internal/invalid host — block

      currentUrl = validated;
      continue;
    }

    return response;
  }

  return null; // too many redirects
}

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
      const response = await fetchWithRedirectValidation(url, headers);
      if (!response) continue; // blocked redirect or too many hops — try next headers

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
  console.log(`[pdf:${pdfId}] Starting background processing (${(buffer.length / 1024).toFixed(0)} KB)...`);
  try {
    const { pages: pageTexts, pageCount } = await extractPdfFullText(buffer);
    console.log(`[pdf:${pdfId}] Text extracted: ${pageCount} pages`);
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
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error(`[pdf:${pdfId}] Processing failed: ${message}`);
    if (stack) console.error(`[pdf:${pdfId}] Stack:`, stack);
  }
}
