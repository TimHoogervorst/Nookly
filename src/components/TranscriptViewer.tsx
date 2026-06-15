"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface Segment {
  segment_index: number;
  start_time: number;
  end_time: number;
  text: string;
}

interface CommentItem {
  id: number;
  target_type: string;
  target_id: number;
  page_number: number;
  type: string;
  anchor_data: string;
  content: string;
  start_word: number | null;
  end_word: number | null;
}

interface HighlightItem {
  id: number;
  target_type: string;
  target_id: number;
  page_number: number;
  color: string;
  anchor_data: string;
  start_word: number | null;
  end_word: number | null;
}

interface Props {
  segments: Segment[];
  currentTime: number;
  onSegmentChange: (segmentIndex: number) => void;
  onSeek: (time: number) => void;
  /** Called when user clicks Highlight in the selection popup */
  onHighlightText?: (text: string, segmentIndex: number) => void;
  /** Called when user clicks Comment in the selection popup */
  onCommentText?: (text: string, segmentIndex: number) => void;
  /** Called when user clicks Send to Chat in the selection popup */
  onSendToChat?: (text: string) => void;
  /** Pre-computed amplitude array for inline waveform strips */
  amplitudes?: number[];
  /** Total audio duration for mapping amplitudes to time */
  duration?: number;
  /** Comments to render as overlays */
  comments?: CommentItem[];
  /** Highlights to render as colored underlines */
  highlights?: HighlightItem[];
  /** Called when a comment marker is clicked */
  onCommentClick?: (commentId: number) => void;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function TranscriptViewer({
  segments,
  currentTime,
  onSegmentChange,
  onSeek,
  onHighlightText,
  onCommentText,
  onSendToChat,
  amplitudes,
  duration: totalDuration,
  comments = [],
  highlights = [],
  onCommentClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  // Selection popup state (matching PDFViewer pattern)
  const [selPopup, setSelPopup] = useState<{
    x: number;
    y: number;
    text: string;
    segmentIndex: number;
  } | null>(null);

  const hasCallbacks = !!(onHighlightText || onCommentText || onSendToChat);

  // Find active segment based on currentTime
  useEffect(() => {
    const idx = segments.findIndex(
      (s) => currentTime >= s.start_time && currentTime < s.end_time
    );
    setActiveSegment(idx >= 0 ? segments[idx].segment_index : null);
  }, [currentTime, segments]);

  // IntersectionObserver for scroll-based segment tracking
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (!best || entry.intersectionRatio > best.intersectionRatio) {
            best = entry;
          }
        }
        if (best && best.intersectionRatio > 0.3) {
          const idx = parseInt(
            (best.target as HTMLElement).dataset.segment || "0"
          );
          onSegmentChange(idx);
        }
      },
      {
        root: containerRef.current,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    segmentRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [segments, onSegmentChange]);

  // Global mouseup handler for text selection popup (PDFViewer pattern)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Small delay to let the browser settle the selection
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          setSelPopup(null);
          return;
        }
        const txt = sel.toString().trim();
        if (txt.length < 2) {
          setSelPopup(null);
          return;
        }
        const container = containerRef.current;
        if (
          !container ||
          !container.contains(sel.getRangeAt(0).commonAncestorContainer)
        ) {
          setSelPopup(null);
          return;
        }
        // Find which segment the selection is in
        const segEl = (sel.getRangeAt(0).commonAncestorContainer as Element).closest?.(
          "[data-segment]"
        ) as HTMLElement | null;
        const segIdx = segEl ? parseInt(segEl.dataset.segment || "0") : 0;
        const sr = sel.getRangeAt(0).getBoundingClientRect();
        setSelPopup({
          x: sr.right + 4,
          y: sr.top - 12,
          text: txt,
          segmentIndex: segIdx,
        });
      }, 10);
    };
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, []);

  // Close popup on click outside
  useEffect(() => {
    if (!selPopup) return;
    const handler = (e: MouseEvent) => {
      const popup = document.querySelector("[data-sel-popup]");
      if (popup && !popup.contains(e.target as Node)) {
        setSelPopup(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selPopup]);

  // Compute waveform bars for a single segment
  const getSegmentAmplitudes = useCallback(
    (startTime: number, endTime: number): number[] => {
      if (!amplitudes || !totalDuration || totalDuration <= 0) return [];
      const ampCount = amplitudes.length;
      const startIdx = Math.floor((startTime / totalDuration) * ampCount);
      const endIdx = Math.ceil((endTime / totalDuration) * ampCount);
      return amplitudes.slice(
        Math.max(0, startIdx),
        Math.min(ampCount, endIdx)
      );
    },
    [amplitudes, totalDuration]
  );

  if (segments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
        No transcript segments available
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 relative">
      {segments.map((seg) => {
        const isActive = seg.segment_index === activeSegment;
        const segAmps = getSegmentAmplitudes(seg.start_time, seg.end_time);

        // Compute this segment's word range
        const segWordCount = seg.text.split(/\s+/).filter((w) => w.length > 0).length;
        const segWordStart = segments
          .slice(0, seg.segment_index)
          .reduce((sum, s) => sum + s.text.split(/\s+/).filter((w) => w.length > 0).length, 0);
        const segWordEnd = segWordStart + segWordCount - 1;

        // Find comments that start in this segment's word range
        const segComments = comments.filter((c) => {
          if (c.start_word == null) {
            // Fallback: old data without word positions
            return c.page_number === seg.segment_index;
          }
          return c.start_word >= segWordStart && c.start_word <= segWordEnd;
        });

        // Find highlights that overlap this segment's word range (may be partial)
        const segHighlights = highlights.filter((h) => {
          if (h.start_word == null || h.end_word == null) {
            return h.page_number === seg.segment_index;
          }
          // Overlap check
          return h.start_word <= segWordEnd && h.end_word >= segWordStart;
        }).map((h) => {
          if (h.start_word == null || h.end_word == null) return { highlight: h, ratio: 1, partial: false };
          const sw = h.start_word!;
          const ew = h.end_word!;
          // Compute overlap ratio within this segment
          const overlapStart = Math.max(sw, segWordStart);
          const overlapEnd = Math.min(ew, segWordEnd);
          const overlapWords = overlapEnd - overlapStart + 1;
          const totalWords = ew - sw + 1;
          const partial = sw < segWordStart || ew > segWordEnd;
          return {
            highlight: h,
            ratio: totalWords > 0 ? overlapWords / totalWords : 0,
            partial,
          };
        });
        const progressRatio =
          totalDuration && totalDuration > 0 && currentTime >= seg.start_time
            ? Math.min(
                (currentTime - seg.start_time) /
                  (seg.end_time - seg.start_time),
                1
              )
            : 0;

        return (
          <div
            key={seg.segment_index}
            ref={(el) => {
              if (el) segmentRefs.current.set(seg.segment_index, el);
              else segmentRefs.current.delete(seg.segment_index);
            }}
            data-segment={seg.segment_index}
            className={`mb-4 rounded-lg transition-colors ${
              isActive
                ? "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500"
                : "border-l-4 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50"
            }`}
          >
            {/* Timestamp header */}
            <button
              onClick={() => onSeek(seg.start_time)}
              className="inline-flex items-center gap-1.5 px-3 pt-2 text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              title="Click to play from this point"
            >
              <svg
                className="w-3 h-3"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              {formatTimestamp(seg.start_time)} — {formatTimestamp(seg.end_time)}
            </button>

            {/* Transcript text with word-level highlights */}
            <p className="px-3 pt-1 text-gray-800 dark:text-gray-200 leading-relaxed select-text">
              {(() => {
                // Build full word array for extracting highlight text
                const allWords = segments
                  .map((s) => s.text)
                  .join(" ")
                  .split(/\s+/)
                  .filter((w) => w.length > 0);

                // For each highlight, extract the text it covers, then find + wrap it in the segment
                const ranges: { start: number; end: number; color: string }[] = [];
                for (const sh of segHighlights) {
                  if (sh.highlight.start_word == null || sh.highlight.end_word == null) continue;
                  const sw = Math.max(sh.highlight.start_word, segWordStart);
                  const ew = Math.min(sh.highlight.end_word, segWordEnd);
                  if (sw > ew) continue;
                  const highlightText = allWords.slice(sw, ew + 1).join(" ");
                  if (!highlightText) continue;
                  // Find this text in the segment
                  const idx = seg.text.indexOf(highlightText);
                  if (idx >= 0) {
                    ranges.push({ start: idx, end: idx + highlightText.length, color: sh.highlight.color });
                  }
                }

                if (ranges.length === 0) return seg.text;

                // Sort ranges and merge overlapping ones
                ranges.sort((a, b) => a.start - b.start);
                const merged: typeof ranges = [];
                for (const r of ranges) {
                  const last = merged[merged.length - 1];
                  if (last && r.start <= last.end) {
                    last.end = Math.max(last.end, r.end);
                  } else {
                    merged.push({ ...r });
                  }
                }

                // Build highlighted JSX by slicing the text around ranges
                const parts: React.ReactNode[] = [];
                let cursor = 0;
                for (const r of merged) {
                  if (r.start > cursor) {
                    parts.push(<span key={`t-${cursor}`}>{seg.text.slice(cursor, r.start)}</span>);
                  }
                  parts.push(
                    <span
                      key={`h-${r.start}`}
                      style={{ backgroundColor: r.color + "44", borderRadius: "2px" }}
                    >
                      {seg.text.slice(r.start, r.end)}
                    </span>
                  );
                  cursor = r.end;
                }
                if (cursor < seg.text.length) {
                  parts.push(<span key={`t-${cursor}`}>{seg.text.slice(cursor)}</span>);
                }
                return parts;
              })()}
            </p>

            {/* Comment markers */}
            {segComments.length > 0 && (
              <div className="px-3 pb-1 flex flex-wrap gap-1.5">
                {segComments.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onCommentClick?.(c.id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                    title={c.content.slice(0, 100)}
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                      />
                    </svg>
                    {c.content.slice(0, 50)}
                    {c.content.length > 50 ? "..." : ""}
                  </button>
                ))}
              </div>
            )}

            {/* Highlight color indicators */}
            {segHighlights.length > 0 && segComments.length === 0 && (
              <div className="px-3 pb-1 flex gap-1">
                {segHighlights.map((sh) => (
                  <span
                    key={sh.highlight.id}
                    className="w-3 h-3 rounded-full border border-white dark:border-gray-800"
                    style={{ backgroundColor: sh.highlight.color }}
                    title={`Highlight${sh.partial ? " (continued)" : ""}`}
                  />
                ))}
              </div>
            )}

            {/* Inline waveform strip — only visible on active segment */}
            {isActive && segAmps.length > 0 && (
              <div
                className="px-3 pb-2 cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  onSeek(
                    seg.start_time +
                      Math.max(0, Math.min(ratio, 1)) *
                        (seg.end_time - seg.start_time)
                  );
                }}
                title="Click to seek within this segment"
              >
                <div className="flex items-end h-4 gap-px">
                  {segAmps.map((amp, i) => {
                    const barProgress = i / Math.max(segAmps.length - 1, 1);
                    const played = barProgress <= progressRatio;
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm transition-colors"
                        style={{
                          height: `${Math.max(amp * 100, 4)}%`,
                          backgroundColor: played ? "#3b82f6" : "#d1d5db",
                        }}
                      />
                    );
                  })}
                </div>
                {/* Progress indicator dot */}
                {progressRatio > 0 && progressRatio < 1 && (
                  <div
                    className="relative h-0"
                    style={{ marginLeft: `${progressRatio * 100}%` }}
                  >
                    <div className="absolute -top-4 w-0.5 h-4 bg-red-500" />
                  </div>
                )}
              </div>
            )}

            {/* Subtle separator for inactive segments */}
            {!isActive && <div className="pb-2" />}
          </div>
        );
      })}

      {/* ── Selection popup (PDFViewer pattern) ────── */}
      {selPopup && hasCallbacks && (
        <div
          data-sel-popup
          className="fixed z-[100] flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl"
          style={{ left: selPopup.x, top: selPopup.y }}
        >
          {onHighlightText && (
            <button
              onClick={() => {
                onHighlightText(selPopup.text, selPopup.segmentIndex);
                setSelPopup(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="p-2 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-l-lg transition-colors"
              title="Highlight"
            >
              <svg
                className="w-4 h-4 text-yellow-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M15.993 2.385a2.236 2.236 0 00-3.164 0l-8.636 8.636a1.01 1.01 0 00-.257.444L3.03 15.07a.47.47 0 00.572.572l3.605-.906a1.01 1.01 0 00.444-.257l8.636-8.636a2.236 2.236 0 000-3.164l-.294-.294zm-1.414 1.414l.294.294a1.036 1.036 0 010 1.464l-.294.294-1.464-1.464.294-.294a1.036 1.036 0 011.464 0l-.294-.294z" />
              </svg>
            </button>
          )}
          {onCommentText && (
            <button
              onClick={() => {
                onCommentText(selPopup.text, selPopup.segmentIndex);
                setSelPopup(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              title="Comment"
            >
              <svg
                className="w-4 h-4 text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
            </button>
          )}
          {onSendToChat && (
            <button
              onClick={() => {
                onSendToChat(selPopup.text);
                setSelPopup(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="p-2 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-r-lg transition-colors"
              title="Send to Chat"
            >
              <svg
                className="w-4 h-4 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
