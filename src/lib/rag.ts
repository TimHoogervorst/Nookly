import { setSetting, getSetting } from "./users";
import { getChunksForPdf } from "./pdfs";
import { getSegmentsForRecording } from "./recordings";

const DEFAULT_CHUNK_SIZE = 800; // characters

/**
 * Split text into chunks of roughly `chunkSize` characters,
 * respecting sentence boundaries where possible.
 */
export function splitIntoChunks(text: string, chunkSize = DEFAULT_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  let currentChunk = "";
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Generate an embedding for the given text using the configured LLM endpoint.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const endpoint = getSetting("embedding_endpoint") || getSetting("endpoint");
  const apiKey = getSetting("api_key");
  const model = getSetting("embedding_model") || "text-embedding-ada-002";

  if (!endpoint || !apiKey) {
    throw new Error("LLM endpoint and API key must be configured in Settings.");
  }

  // Normalize endpoint: use /embeddings path
  const baseUrl = endpoint.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  const embeddingUrl = `${baseUrl}/embeddings`;

  const response = await fetch(embeddingUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  // OpenAI-compatible response format: { data: [{ embedding: [...] }] }
  return data.data?.[0]?.embedding || [];
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Build a context string from the top matching chunks.
 */
export function buildContext(
  chunks: { text_content: string; page_number: number }[],
  maxLength = 4000,
  label = "Page"
): string {
  let context = "";
  for (const chunk of chunks) {
    const chunkWithPage = `[${label} ${chunk.page_number}] ${chunk.text_content}\n\n`;
    if (context.length + chunkWithPage.length > maxLength) break;
    context += chunkWithPage;
  }
  return context.trim();
}

/**
 * Retrieve context for a chat query from the appropriate source (PDF or recording).
 * Generates a query embedding, scores chunks/segments by cosine similarity,
 * takes the top 8, and returns a pre-built context string.
 * Falls back to un-embedded chunks when no embeddings exist.
 */
export async function retrieveContext(
  targetType: "pdf" | "recording",
  targetId: number,
  query: string
): Promise<string> {
  const label = targetType === "recording" ? "Segment" : "Page";
  let context = "";

  if (targetType === "recording") {
    const segments = getSegmentsForRecording(targetId);
    const segmentItems = segments.map((seg) => ({
      text_content: seg.text,
      page_number: seg.segment_index,
      embedding: seg.embedding,
    }));

    const embeddedItems = segmentItems.filter((c) => c.embedding);
    const textItems = segmentItems.filter((c) => !c.embedding);

    if (embeddedItems.length > 0) {
      try {
        const queryEmbedding = await generateEmbedding(query);
        const scored = embeddedItems
          .map((item) => ({
            ...item,
            score: cosineSimilarity(queryEmbedding, JSON.parse(item.embedding!)),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        context = buildContext(
          scored.map((c) => ({ text_content: c.text_content, page_number: c.page_number })),
          4000,
          label
        );
      } catch (err) {
        console.error("RAG retrieval error:", err);
      }
    }

    if (!context && textItems.length > 0) {
      context = buildContext(
        textItems.slice(0, 15).map((c) => ({
          text_content: c.text_content,
          page_number: c.page_number,
        })),
        4000,
        label
      );
    }
  } else {
    // PDF path
    const allChunks = getChunksForPdf(targetId);
    const embeddedChunks = allChunks.filter((c) => c.embedding);
    const textChunks = allChunks.filter((c) => !c.embedding);

    if (embeddedChunks.length > 0) {
      try {
        const queryEmbedding = await generateEmbedding(query);
        const scored = embeddedChunks
          .map((chunk) => ({
            ...chunk,
            score: cosineSimilarity(queryEmbedding, JSON.parse(chunk.embedding!)),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        context = buildContext(
          scored.map((c) => ({ text_content: c.text_content, page_number: c.page_number }))
        );
      } catch (err) {
        console.error("RAG retrieval error:", err);
      }
    }

    if (!context && textChunks.length > 0) {
      context = buildContext(
        textChunks.slice(0, 15).map((c) => ({
          text_content: c.text_content,
          page_number: c.page_number,
        }))
      );
    }
  }

  return context;
}
