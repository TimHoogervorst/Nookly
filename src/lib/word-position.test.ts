import { describe, it, expect } from "vitest";
import { findWordPosition } from "./word-position";

const fullWords = [
  "the", "cat", "sat", "on", "the", "mat",   // words 0-5
  "the", "dog", "ran", "past", "the", "cat",  // words 6-11
];

describe("findWordPosition", () => {
  it("finds a word in the full text (no constraint)", () => {
    const result = findWordPosition(fullWords, "dog");
    expect(result).toEqual({ startWord: 7, endWord: 7 });
  });

  it("finds the first match when word appears multiple times (legacy behavior without constraint)", () => {
    const result = findWordPosition(fullWords, "cat");
    // Without constraint, returns the first "cat" at index 1
    expect(result).toEqual({ startWord: 1, endWord: 1 });
  });

  it("constrains search to the given segment word range — finds second 'cat' in segment 1", () => {
    // Segment 1 covers words 6-11 ("the dog ran past the cat")
    const result = findWordPosition(fullWords, "cat", { startWord: 6, endWord: 11 });
    // Should find "cat" at index 11 (in segment 1), NOT index 1 (in segment 0)
    expect(result).toEqual({ startWord: 11, endWord: 11 });
  });

  it("constrains search — finds 'the' in segment 1 (not segment 0)", () => {
    // Segment 1: words 6-11. "the" appears at 6 and 10. Search should find 6.
    const result = findWordPosition(fullWords, "the", { startWord: 6, endWord: 11 });
    expect(result).toEqual({ startWord: 6, endWord: 6 });
  });

  it("finds multi-word phrase within constraint", () => {
    const result = findWordPosition(fullWords, "the cat", { startWord: 6, endWord: 11 });
    expect(result).toEqual({ startWord: 10, endWord: 11 });
  });

  it("returns null when phrase is outside constraint range", () => {
    // "sat" is at index 2, outside constraint 6-11
    const result = findWordPosition(fullWords, "sat", { startWord: 6, endWord: 11 });
    expect(result).toBeNull();
  });

  it("returns null when first word doesn't match anything in constrained range", () => {
    // "xyz" doesn't appear anywhere in the segment
    const result = findWordPosition(fullWords, "xyz ran", { startWord: 6, endWord: 11 });
    expect(result).toBeNull();
  });

  it("partial match within constraint finds first matching first-word", () => {
    const result = findWordPosition(fullWords, "the ran", { startWord: 6, endWord: 11 });
    // "the ran" doesn't appear exactly. But "the" is first word, matches at 6.
    // Partial fallback returns { startWord: 6, endWord: 7 }
    expect(result).toEqual({ startWord: 6, endWord: 7 });
  });

  it("returns null when no word matches within constraint", () => {
    const result = findWordPosition(fullWords, "elephant", { startWord: 6, endWord: 11 });
    expect(result).toBeNull();
  });
});
