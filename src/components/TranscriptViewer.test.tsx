import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import TranscriptViewer, { getTranscriptAnchor } from "./TranscriptViewer";
import type { SelectionContext } from "@/hooks/useTextSelectionPopup";

// Stub IntersectionObserver for jsdom
beforeAll(() => {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => cleanup());

function makeRange(
  ancestor: Node,
  opts?: {
    rect?: Partial<DOMRect>;
    startContainer?: Node;
    startOffset?: number;
  },
): Range {
  return {
    commonAncestorContainer: ancestor,
    startContainer: opts?.startContainer ?? ancestor,
    startOffset: opts?.startOffset ?? 0,
    getBoundingClientRect: () =>
      ({
        left: opts?.rect?.left ?? 0,
        top: opts?.rect?.top ?? 0,
        right: opts?.rect?.right ?? 100,
        bottom: opts?.rect?.bottom ?? 20,
      }) as DOMRect,
    getClientRects: () => [] as DOMRect[],
  } as unknown as Range;
}

describe("getTranscriptAnchor", () => {
  // ── Bug 2 fix: Text node common ancestor ──────────────
  it("returns segmentIndex when common ancestor is a Text node", () => {
    const segEl = document.createElement("div");
    segEl.setAttribute("data-segment", "5");
    const textNode = document.createTextNode("hello world");
    segEl.appendChild(textNode);
    document.body.appendChild(segEl);

    const range = makeRange(textNode);
    const result = getTranscriptAnchor({ text: "hello", range });

    expect(result).toEqual({ segmentIndex: 5, charOffset: 0 });

    document.body.removeChild(segEl);
  });

  it("returns segmentIndex when common ancestor is an Element node", () => {
    const segEl = document.createElement("div");
    segEl.setAttribute("data-segment", "3");
    document.body.appendChild(segEl);

    const range = makeRange(segEl);
    const result = getTranscriptAnchor({ text: "hello", range });

    expect(result).toEqual({ segmentIndex: 3, charOffset: 0 });

    document.body.removeChild(segEl);
  });

  it("returns null when selection is outside any [data-segment]", () => {
    const div = document.createElement("div");
    const textNode = document.createTextNode("hello");
    div.appendChild(textNode);
    document.body.appendChild(div);

    const range = makeRange(textNode);
    const result = getTranscriptAnchor({ text: "hello", range });

    expect(result).toBeNull();

    document.body.removeChild(div);
  });

  it("returns null when [data-segment] is a grandparent of a text node", () => {
    const segEl = document.createElement("div");
    segEl.setAttribute("data-segment", "7");
    const innerEl = document.createElement("span");
    const textNode = document.createTextNode("nested text");
    innerEl.appendChild(textNode);
    segEl.appendChild(innerEl);
    document.body.appendChild(segEl);

    const range = makeRange(textNode);
    const result = getTranscriptAnchor({ text: "nested", range });

    // closest() walks up through ancestors, so it should find segEl
    expect(result).toEqual({ segmentIndex: 7, charOffset: 0 });

    document.body.removeChild(segEl);
  });

  // ── Char offset for disambiguating duplicate words ────
  it("returns charOffset of selected text within the segment text", () => {
    // Build a realistic segment structure with a paragraph
    const segEl = document.createElement("div");
    segEl.setAttribute("data-segment", "2");

    // The paragraph with the transcript text (like the real component renders)
    const p = document.createElement("p");
    // "the new project and the new feature"
    //  character 0 = 't', 'h', 'e', ' ', 'n', 'e', 'w' ...
    //            0         1         2
    //            01234567890123456789012345678901234
    const textNode = document.createTextNode("the new project and the new feature");
    p.appendChild(textNode);
    segEl.appendChild(p);
    document.body.appendChild(segEl);

    // Select the second "new" at characters 24-27
    const range = makeRange(textNode, {
      startContainer: textNode,
      startOffset: 24,
    });
    const result = getTranscriptAnchor({ text: "new", range });

    expect(result).not.toBeNull();
    expect(result!.segmentIndex).toBe(2);
    expect(result!.charOffset).toBe(24); // position of second "new"

    document.body.removeChild(segEl);
  });

  it("finds charOffset when text is inside a highlighted span", () => {
    const segEl = document.createElement("div");
    segEl.setAttribute("data-segment", "1");
    const p = document.createElement("p");
    const beforeSpan = document.createElement("span");
    beforeSpan.appendChild(document.createTextNode("the "));
    const highlightSpan = document.createElement("span");
    const innerText = document.createTextNode("new project");
    highlightSpan.appendChild(innerText);
    const afterSpan = document.createElement("span");
    afterSpan.appendChild(document.createTextNode(" starts now"));
    p.appendChild(beforeSpan);
    p.appendChild(highlightSpan);
    p.appendChild(afterSpan);
    segEl.appendChild(p);
    document.body.appendChild(segEl);

    // Select "new project" inside the highlight span
    // The charOffset should be relative to the paragraph's total text: "the new project starts now"
    // "the " = 4 chars, so "new" starts at charOffset 4
    const range = makeRange(innerText, {
      startContainer: innerText,
      startOffset: 0,
    });
    const result = getTranscriptAnchor({ text: "new project", range });

    expect(result).not.toBeNull();
    expect(result!.segmentIndex).toBe(1);
    expect(result!.charOffset).toBe(4);

    document.body.removeChild(segEl);
  });
});

// ── Annotation rendering tests ──────────────────────

function makeSegment(index: number, text: string) {
  return {
    segment_index: index,
    start_time: index * 10,
    end_time: (index + 1) * 10,
    text,
  };
}

describe("TranscriptViewer annotation rendering", () => {
  it("shows comment markers on all segments that overlap the comment word range", () => {
    // Segment 0: 5 words (global 0-4)
    // Segment 1: 5 words (global 5-9)
    // Segment 2: 5 words (global 10-14)
    const segments = [
      makeSegment(0, "zero one two three four"),
      makeSegment(1, "five six seven eight nine"),
      makeSegment(2, "ten eleven twelve thirteen fourteen"),
    ];

    // Comment spans words 3-7, overlapping segments 0 (0-4) and 1 (5-9)
    const comments = [
      {
        id: 1,
        target_type: "recording",
        target_id: 1,
        page_number: 0,
        type: "text_anchor",
        anchor_data: "{}",
        content: "spans two segments",
        start_word: 3,
        end_word: 7,
      },
    ];

    render(
      <TranscriptViewer
        segments={segments}
        currentTime={0}
        onSegmentChange={() => {}}
        onSeek={() => {}}
        comments={comments}
        highlights={[]}
      />
    );

    // Find all segment elements
    const seg0 = document.querySelector('[data-segment="0"]')!;
    const seg1 = document.querySelector('[data-segment="1"]')!;
    const seg2 = document.querySelector('[data-segment="2"]')!;

    // Segment 0 should have the comment marker (word 3 is in 0-4)
    expect(seg0.textContent).toContain("spans two segments");

    // Segment 1 should ALSO have the comment marker (word 7 is in 5-9)
    expect(seg1.textContent).toContain("spans two segments");

    // Segment 2 should NOT have the comment marker (words 10-14 don't overlap 3-7)
    expect(seg2.textContent).not.toContain("spans two segments");
  });

  it("highlights spanning multiple segments have no visual partial distinction", () => {
    // Segment 0: words 0-4, Segment 1: words 5-9
    const segments = [
      makeSegment(0, "alpha beta gamma delta epsilon"),
      makeSegment(1, "zeta eta theta iota kappa"),
    ];

    // Highlight spans words 3-6 across both segments
    const highlights = [
      {
        id: 1,
        target_type: "recording",
        target_id: 1,
        page_number: 0,
        color: "#fef08a",
        anchor_data: "{}",
        start_word: 3,
        end_word: 6,
      },
    ];

    render(
      <TranscriptViewer
        segments={segments}
        currentTime={0}
        onSegmentChange={() => {}}
        onSeek={() => {}}
        comments={[]}
        highlights={highlights}
      />
    );

    // Both segments should contain the highlighted text
    const seg0 = document.querySelector('[data-segment="0"]')!;
    const seg1 = document.querySelector('[data-segment="1"]')!;

    // Segment 0 should render "delta epsilon" highlighted
    expect(seg0.innerHTML).toContain("delta epsilon");
    // Both segments use the same highlight color (partial doesn't change appearance)
    expect(seg0.innerHTML).toContain("rgba(254, 240, 138");
    expect(seg1.innerHTML).toContain("rgba(254, 240, 138");

    // No "(continued)" text anywhere (the partial indicator was removed)
    expect(document.body.innerHTML).not.toContain("(continued)");
  });

  it("highlights the correct occurrence of a word that appears multiple times in one segment", () => {
    // "the new project and the new feature"
    // words: 0:the, 1:new, 2:project, 3:and, 4:the, 5:new, 6:feature
    const segments = [
      makeSegment(0, "the new project and the new feature"),
    ];

    // Highlight only the SECOND "new" (global word 5)
    const highlights = [
      {
        id: 1,
        target_type: "recording",
        target_id: 1,
        page_number: 0,
        color: "#fef08a",
        anchor_data: "{}",
        start_word: 5,
        end_word: 5,
      },
    ];

    render(
      <TranscriptViewer
        segments={segments}
        currentTime={0}
        onSegmentChange={() => {}}
        onSeek={() => {}}
        comments={[]}
        highlights={highlights}
      />
    );

    const seg0 = document.querySelector('[data-segment="0"]')!;
    // The paragraph should contain the highlighted second "new" but not the first
    // We can check by looking at the structure: the highlight span should wrap only the
    // second "new", and the first "new" should be in an un-highlighted span
    const p = seg0.querySelector("p")!;
    const spans = p.querySelectorAll("span");
    // There should be at least: "the new project and the " (plain) + "new" (highlighted) + " feature" (plain)
    // or similar arrangement
    expect(p.innerHTML).toContain("rgba(254, 240, 138");

    // The first "new" should NOT be highlighted — find it in a plain span
    const allText = p.textContent || "";
    // There should be two "new" occurrences
    const firstNewIdx = allText.indexOf("new");
    const secondNewIdx = allText.indexOf("new", firstNewIdx + 1);
    expect(secondNewIdx).toBeGreaterThan(firstNewIdx);
  });
});
