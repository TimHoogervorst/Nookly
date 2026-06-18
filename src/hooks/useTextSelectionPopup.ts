"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface SelectionContext {
  text: string;
  range: Range;
}

/**
 * Generic text-selection popup hook. Handles mouseup detection, selection
 * validation, container bounds checking, popup positioning, and outside-click
 * dismissal. Callers provide a `getAnchor` callback to extract domain-specific
 * data (page number, segment index, rects, etc.) from the raw selection range.
 *
 * If `getAnchor` returns `null`, no popup is shown for that selection.
 */
export function useTextSelectionPopup<Anchor = void>(
  getAnchor?: (ctx: SelectionContext) => Anchor | null
) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const [popup, setPopup] = useState<
    ({ x: number; y: number; text: string } & Anchor) | null
  >(null);
  const dismiss = useCallback(() => setPopup(null), []);

  // Mouseup listener for text selection detection
  useEffect(() => {
    const handler = (_e: MouseEvent) => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          setPopup(null);
          return;
        }
        const txt = sel.toString().trim();
        if (txt.length < 2) {
          setPopup(null);
          return;
        }
        const container = containerRef.current;
        if (
          !container ||
          !container.contains(sel.getRangeAt(0).commonAncestorContainer)
        ) {
          setPopup(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const sr = range.getBoundingClientRect();

        let anchor: Anchor | null = null;
        if (getAnchor) {
          anchor = getAnchor({ text: txt, range });
          if (anchor === null) {
            setPopup(null);
            return;
          }
        }

        setPopup({
          x: sr.right + 4,
          y: sr.top - 12,
          text: txt,
          ...(anchor as Anchor),
        } as { x: number; y: number; text: string } & Anchor);
      }, 10);
    };
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, [getAnchor]);

  // Dismiss popup on outside click
  useEffect(() => {
    if (!popup) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-sel-popup]")) {
        setPopup(null);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [popup]);

  return { popup, containerRef, dismiss };
}
