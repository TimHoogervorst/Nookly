import { setSetting, getSetting } from "./db";

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
  maxLength = 4000
): string {
  let context = "";
  for (const chunk of chunks) {
    const chunkWithPage = `[Page ${chunk.page_number}] ${chunk.text_content}\n\n`;
    if (context.length + chunkWithPage.length > maxLength) break;
    context += chunkWithPage;
  }
  return context.trim();
}
