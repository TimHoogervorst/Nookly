import { describe, it, expect } from "vitest";
import { getPDFAnchor } from "./PDFViewer";
import type { SelectionContext } from "@/hooks/useTextSelectionPopup";

/** Builds a minimal PDF page DOM structure and returns the wrapper + a text node inside it. */
function setupPageDOM(
  pageNumber: number,
  overrides?: { left?: number; top?: number; width?: number; height?: number },
): { pageWrapper: HTMLElement; textNode: Text } {
  const left = overrides?.left ?? 50;
  const top = overrides?.top ?? 100;
  const width = overrides?.width ?? 800;
  const height = overrides?.height ?? 1000;

  const pageWrapper = document.createElement("div");
  pageWrapper.setAttribute("data-page", String(pageNumber));
  const rect = new DOMRect(left, top, width, height);
  pageWrapper.getBoundingClientRect = () => rect;

  const pageEl = document.createElement("div");
  pageEl.className = "react-pdf__Page";
  pageWrapper.appendChild(pageEl);

  const textSpan = document.createElement("span");
  const textNode = document.createTextNode("some pdf text");
  textSpan.appendChild(textNode);
  pageEl.appendChild(textSpan);

  document.body.appendChild(pageWrapper);
  return { pageWrapper, textNode };
}

function makeRange(
  ancestor: Node,
  rects: DOMRect[],
  boundingRect?: DOMRect,
): Range {
  return {
    commonAncestorContainer: ancestor,
    getBoundingClientRect: () =>
      boundingRect ?? new DOMRect(200, 150, 200, 20),
    getClientRects: () => rects,
  } as unknown as Range;
}

describe("getPDFAnchor", () => {
  // ── Bug 3 fix: zero-width rect filtering ─────────────
  it("filters out zero-width rects while keeping valid ones", () => {
    const { pageWrapper, textNode } = setupPageDOM(2);
    const validRect = new DOMRect(200, 150, 200, 20);
    const zeroWidthRect = new DOMRect(0, 200, 0, 20);

    const range = makeRange(textNode, [validRect, zeroWidthRect]);
    const result = getPDFAnchor({ text: "some pdf text", range });

    expect(result).not.toBeNull();
    expect(result!.pageNumber).toBe(2);
    expect(result!.rects).toHaveLength(1);

    const dw = pageWrapper.getBoundingClientRect();
    const r0 = result!.rects![0];
    expect(r0.left).toBeCloseTo((200 - dw.left) / dw.width);
    expect(r0.right).toBeCloseTo((400 - dw.left) / dw.width);

    document.body.removeChild(pageWrapper);
  });

  it("filters out all rects when every rect is zero-width", () => {
    const { pageWrapper, textNode } = setupPageDOM(1);
    const zeroRects = [
      new DOMRect(0, 0, 0, 10),
      new DOMRect(0, 20, 0, 10),
    ];

    const range = makeRange(textNode, zeroRects);
    const result = getPDFAnchor({ text: "text", range });

    expect(result).not.toBeNull();
    expect(result!.rects).toHaveLength(0);

    document.body.removeChild(pageWrapper);
  });

  it("keeps near-zero-width rects that are genuinely tiny (e.g. single character selections)", () => {
    const { pageWrapper, textNode } = setupPageDOM(1);
    // A 2px-wide rect from selecting a narrow character like "i"
    const narrowRect = new DOMRect(300, 150, 2, 20);

    const range = makeRange(textNode, [narrowRect]);
    const result = getPDFAnchor({ text: "i", range });

    expect(result).not.toBeNull();
    expect(result!.rects).toHaveLength(1);

    document.body.removeChild(pageWrapper);
  });

  it("returns normalized rects for a normal multi-line selection", () => {
    const { pageWrapper, textNode } = setupPageDOM(3);
    const line1 = new DOMRect(100, 200, 600, 20);
    const line2 = new DOMRect(100, 220, 550, 20);

    const range = makeRange(textNode, [line1, line2]);
    const result = getPDFAnchor({ text: "multi-line text", range });

    expect(result).not.toBeNull();
    expect(result!.pageNumber).toBe(3);
    // Both lines should be preserved (they are on different visual lines)
    expect(result!.rects).toHaveLength(2);

    for (const r of result!.rects!) {
      expect(r.right - r.left).toBeGreaterThan(0);
    }

    document.body.removeChild(pageWrapper);
  });

  it("returns null when selection is outside a PDF page", () => {
    const div = document.createElement("div");
    const textNode = document.createTextNode("not in a pdf");
    div.appendChild(textNode);
    document.body.appendChild(div);

    const range = makeRange(textNode, []);
    const result = getPDFAnchor({ text: "not in a pdf", range });

    expect(result).toBeNull();

    document.body.removeChild(div);
  });
});
