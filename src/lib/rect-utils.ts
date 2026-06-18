import type { RectAnchor } from "@/components/PDFViewer";

/**
 * Merge adjacent rects from consecutive lines into contiguous blocks.
 *
 * Two rects are merged when all of these hold:
 * 1. Their horizontal edges align (left and right edges each within 1.5×
 *    median height of each other). This keeps irregular selections
 *    (e.g. half-sentence → full-width) as separate blocks.
 * 2. Their vertical gap is at most 1.5× the median rect height.
 *
 * This merges within a paragraph of same-width lines but preserves
 * paragraph breaks and irregular (half-line) selection shapes.
 */
export function mergeAdjacentRects(rects: RectAnchor[]): RectAnchor[] {
  if (rects.length <= 1) return rects;

  const sorted = [...rects].sort((a, b) => a.top - b.top);

  const heights = sorted.map((r) => r.bottom - r.top).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)];
  const gapThreshold = medianHeight * 1.5;

  const merged: RectAnchor[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const gap = r.top - current.bottom;
    const leftAligned = Math.abs(r.left - current.left) <= gapThreshold;
    const rightAligned = Math.abs(r.right - current.right) <= gapThreshold;

    if (leftAligned && rightAligned && gap >= 0 && gap <= gapThreshold) {
      current = {
        left: Math.min(current.left, r.left),
        top: current.top,
        right: Math.max(current.right, r.right),
        bottom: r.bottom,
      };
    } else {
      merged.push(current);
      current = { ...r };
    }
  }
  merged.push(current);
  return merged;
}
