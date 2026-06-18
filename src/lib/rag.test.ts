import { describe, it, expect } from "vitest";
import { splitIntoChunks, cosineSimilarity, deriveEmbeddingUrl, buildContext } from "./rag";

describe("splitIntoChunks", () => {
  it("returns a single chunk when text fits within chunkSize", () => {
    const result = splitIntoChunks("Hello world. This is a test.", 800);
    expect(result).toEqual(["Hello world. This is a test."]);
  });

  it("splits on sentence boundaries", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const result = splitIntoChunks(text, 20);
    expect(result.length).toBeGreaterThan(1);
    // Each chunk should end at a sentence boundary
    for (const chunk of result) {
      expect(chunk).toMatch(/[.!?]$/);
    }
  });

  it("returns empty array for empty input", () => {
    expect(splitIntoChunks("")).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(splitIntoChunks("   ")).toEqual([]);
  });

  it("handles text without sentence terminators", () => {
    const text = "This is a long text with no sentence terminators at all just one big blob";
    const result = splitIntoChunks(text, 30);
    // Should still produce at least one chunk
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Combined content should equal original
    expect(result.join(" ")).toEqual(text);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const vec = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns 0 when one vector is all zeros", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow("length mismatch");
  });

  it("computes correct similarity", () => {
    // cos(45°) = √2/2 ≈ 0.7071
    const result = cosineSimilarity([1, 0], [1, 1]);
    expect(result).toBeCloseTo(0.7071, 4);
  });
});

describe("deriveEmbeddingUrl", () => {
  it("derives URL from standard OpenAI chat endpoint", () => {
    expect(deriveEmbeddingUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/embeddings"
    );
  });

  it("handles trailing slash on chat endpoint", () => {
    expect(deriveEmbeddingUrl("https://api.openai.com/v1/chat/completions/")).toBe(
      "https://api.openai.com/v1/embeddings"
    );
  });

  it("handles endpoint that is just the base URL (no /chat/completions)", () => {
    expect(deriveEmbeddingUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/embeddings"
    );
  });

  it("handles endpoint with trailing slash and no /chat/completions", () => {
    expect(deriveEmbeddingUrl("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1/embeddings"
    );
  });

  it("handles localhost endpoints (Ollama, LM Studio, etc.)", () => {
    expect(deriveEmbeddingUrl("http://localhost:11434/v1/chat/completions")).toBe(
      "http://localhost:11434/v1/embeddings"
    );
  });

  it("handles Groq-style endpoint", () => {
    expect(deriveEmbeddingUrl("https://api.groq.com/openai/v1/chat/completions")).toBe(
      "https://api.groq.com/openai/v1/embeddings"
    );
  });

  it("handles Together AI-style endpoint", () => {
    expect(deriveEmbeddingUrl("https://api.together.xyz/v1/chat/completions")).toBe(
      "https://api.together.xyz/v1/embeddings"
    );
  });

  it("handles endpoint with multiple trailing slashes", () => {
    // Edge case: someone pastes an endpoint with extra slashes
    expect(deriveEmbeddingUrl("https://api.openai.com/v1/chat/completions///")).toBe(
      "https://api.openai.com/v1/embeddings"
    );
  });

  it("handles endpoint without /v1 prefix", () => {
    expect(deriveEmbeddingUrl("https://custom-proxy.example.com/chat/completions")).toBe(
      "https://custom-proxy.example.com/embeddings"
    );
  });

  it("never produces double slashes before /embeddings", () => {
    const endpoints = [
      "https://api.openai.com/v1/chat/completions",
      "https://api.openai.com/v1/chat/completions/",
      "https://api.openai.com/v1",
      "https://api.openai.com/v1/",
      "http://localhost:11434/v1/chat/completions",
      "https://custom.example.com/chat/completions",
    ];
    for (const ep of endpoints) {
      const url = deriveEmbeddingUrl(ep);
      expect(url).not.toMatch(/\/\/embeddings/);
    }
  });
});

describe("buildContext", () => {
  const chunks = [
    { text_content: "First chunk of text.", page_number: 1 },
    { text_content: "Second chunk on page two.", page_number: 2 },
    { text_content: "Third chunk back on page one.", page_number: 1 },
  ];

  it("builds context with page labels", () => {
    const result = buildContext(chunks, 4000);
    expect(result).toContain("[Page 1] First chunk of text.");
    expect(result).toContain("[Page 2] Second chunk on page two.");
  });

  it("respects maxLength", () => {
    const result = buildContext(chunks, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("uses custom label", () => {
    const result = buildContext(chunks, 4000, "Segment");
    expect(result).toContain("[Segment 1]");
    expect(result).not.toContain("[Page 1]");
  });

  it("returns empty string for empty chunks", () => {
    expect(buildContext([], 4000)).toBe("");
  });
});
