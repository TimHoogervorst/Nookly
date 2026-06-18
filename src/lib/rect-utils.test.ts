import { describe, it, expect } from "vitest";
import { mergeAdjacentRects } from "./rect-utils";
import type { RectAnchor } from "@/components/PDFViewer";

describe("mergeAdjacentRects", () => {
  it("merges adjacent lines with overlapping horizontal spans into one rect", () => {
    const rects: RectAnchor[] = [
      { left: 0.1, top: 0.20, right: 0.9, bottom: 0.22 },
      { left: 0.1, top: 0.23, right: 0.9, bottom: 0.25 },
      { left: 0.1, top: 0.26, right: 0.9, bottom: 0.28 },
    ];

    const result = mergeAdjacentRects(rects);

    expect(result).toHaveLength(1);
    expect(result[0].left).toBeCloseTo(0.1);
    expect(result[0].top).toBeCloseTo(0.20);
    expect(result[0].right).toBeCloseTo(0.9);
    expect(result[0].bottom).toBeCloseTo(0.28);
  });

  it("does not merge rects separated by a gap larger than 1.5× median height", () => {
    const rects: RectAnchor[] = [
      { left: 0.1, top: 0.20, right: 0.9, bottom: 0.22 },
      // gap = 0.28 - 0.22 = 0.06, median height = 0.02, threshold = 0.03
      // 0.06 > 0.03 → paragraph break, not merged
      { left: 0.1, top: 0.28, right: 0.9, bottom: 0.30 },
    ];

    const result = mergeAdjacentRects(rects);

    expect(result).toHaveLength(2);
    expect(result[0].top).toBeCloseTo(0.20);
    expect(result[1].top).toBeCloseTo(0.28);
  });

  it("does not merge adjacent lines whose horizontal spans do not overlap", () => {
    // Pointed-end selection: left half of line 1, right half of line 2.
    // Their horizontal spans don't intersect, so they stay separate.
    const rects: RectAnchor[] = [
      { left: 0.1, top: 0.20, right: 0.5, bottom: 0.22 },
      { left: 0.6, top: 0.23, right: 0.9, bottom: 0.25 },
    ];

    const result = mergeAdjacentRects(rects);

    expect(result).toHaveLength(2);
    expect(result[0].left).toBeCloseTo(0.1);
    expect(result[1].left).toBeCloseTo(0.6);
  });

  it("returns a single rect unchanged", () => {
    const rects: RectAnchor[] = [
      { left: 0.1, top: 0.20, right: 0.9, bottom: 0.28 },
    ];

    const result = mergeAdjacentRects(rects);

    expect(result).toHaveLength(1);
    expect(result[0].left).toBeCloseTo(0.1);
    expect(result[0].top).toBeCloseTo(0.20);
    expect(result[0].right).toBeCloseTo(0.9);
    expect(result[0].bottom).toBeCloseTo(0.28);
  });

  it("returns empty array for empty input", () => {
    const result = mergeAdjacentRects([]);
    expect(result).toEqual([]);
  });

  it("does not merge rects whose horizontal edges differ significantly, even if spans overlap", () => {
    // Right half of line 1, then full-width line 2. They overlap horizontally
    // (0.6–0.9 is shared), but the left edges differ by 0.5 (50% of page width).
    // These represent different selection shapes and must stay separate blocks.
    const rects: RectAnchor[] = [
      { left: 0.6, top: 0.20, right: 0.9, bottom: 0.22 },
      { left: 0.1, top: 0.23, right: 0.9, bottom: 0.25 },
    ];

    const result = mergeAdjacentRects(rects);

    // Should be 2 rects: the right-half block and the full-width block
    expect(result).toHaveLength(2);
    expect(result[0].left).toBeCloseTo(0.6);
    expect(result[0].right).toBeCloseTo(0.9);
    expect(result[1].left).toBeCloseTo(0.1);
    expect(result[1].right).toBeCloseTo(0.9);
  });

  it("still merges rects with same horizontal extent across multiple lines", () => {
    // All 3 lines have the same full width — should merge into 1 block
    const rects: RectAnchor[] = [
      { left: 0.1, top: 0.20, right: 0.9, bottom: 0.22 },
      { left: 0.1, top: 0.23, right: 0.9, bottom: 0.25 },
      { left: 0.1, top: 0.26, right: 0.9, bottom: 0.28 },
    ];

    const result = mergeAdjacentRects(rects);

    expect(result).toHaveLength(1);
    expect(result[0].left).toBeCloseTo(0.1);
    expect(result[0].right).toBeCloseTo(0.9);
    expect(result[0].top).toBeCloseTo(0.20);
    expect(result[0].bottom).toBeCloseTo(0.28);
  });
});
