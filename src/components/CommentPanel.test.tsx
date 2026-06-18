import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CommentPanel from "./CommentPanel";

afterEach(() => cleanup());

describe("CommentPanel fetch URLs", () => {
  let fetchCalls: string[];

  beforeEach(() => {
    fetchCalls = [];
    (globalThis as any).fetch = async (url: string) => {
      fetchCalls.push(url);
      return { ok: true, json: async () => [] };
    };
  });

  it("omits page param for recordings to show all comments", () => {
    render(
      <CommentPanel
        targetType="recording"
        targetId={42}
        segmentIndex={3}
      />
    );

    // Should have calls to both comments and highlights endpoints
    const commentUrls = fetchCalls.filter((u) => u.includes("/api/comments"));
    const highlightUrls = fetchCalls.filter((u) => u.includes("/api/highlights"));

    // Comment URL should NOT have page param
    expect(commentUrls.length).toBeGreaterThan(0);
    for (const url of commentUrls) {
      expect(url).not.toContain("page=");
    }

    // Highlight URL should NOT have page param
    expect(highlightUrls.length).toBeGreaterThan(0);
    for (const url of highlightUrls) {
      expect(url).not.toContain("page=");
    }
  });

  it("includes page param for PDFs", () => {
    render(
      <CommentPanel
        targetType="pdf"
        targetId={7}
        segmentIndex={5}
      />
    );

    const commentUrls = fetchCalls.filter((u) => u.includes("/api/comments"));
    const highlightUrls = fetchCalls.filter((u) => u.includes("/api/highlights"));

    // Comment URL should have page param
    expect(commentUrls.length).toBeGreaterThan(0);
    for (const url of commentUrls) {
      expect(url).toContain("page=5");
    }

    // Highlight URL should have page param
    expect(highlightUrls.length).toBeGreaterThan(0);
    for (const url of highlightUrls) {
      expect(url).toContain("page=5");
    }
  });
});
