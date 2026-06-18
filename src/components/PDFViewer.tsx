"use client";

import { useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useTextSelectionPopup, type SelectionContext } from "@/hooks/useTextSelectionPopup";

// Let the bundler resolve and emit the worker as a static asset.
// Works in dev, production, and standalone Docker — no manual paths needed.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const HL_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#ddd6fe", "#fed7aa"]; // no pure blue — that's for comments

export interface PositionAnchor { x: number; y: number; }
export interface RectAnchor { left: number; top: number; right: number; bottom: number; }
export interface TextAnchor { text: string; rect: RectAnchor; rects?: RectAnchor[]; pageNumber?: number; }

/**
 * Anchor resolver for PDF text selections.
 *
 * Walks up from the selection common ancestor to find the containing page,
 * then computes normalized rects from the selection's client rects.
 *
 * Filters out zero-width rects (right − left ≈ 0) that react-pdf's
 * absolutely-positioned text layer spans can produce — without this filter,
 * those rects become ghost highlight/comment bars at the left page edge.
 */
export function getPDFAnchor({ text, range }: SelectionContext): TextAnchor | null {
  const ancestor = range.commonAncestorContainer;
  const ancestorEl =
    ancestor.nodeType === Node.TEXT_NODE
      ? ancestor.parentElement!
      : (ancestor as Element);
  const pageEl = ancestorEl?.closest?.(".react-pdf__Page");
  if (!pageEl) return null;
  const pageWrapper = pageEl.closest("[data-page]") as HTMLElement | null;
  if (!pageWrapper) return null;
  const pageNum = parseInt(pageWrapper.dataset.page || "1");
  const dw = pageWrapper.getBoundingClientRect();
  const sr = range.getBoundingClientRect();

  // Filter zero-width rects — react-pdf's absolutely-positioned text layer
  // spans can produce spurious zero-width DOMRect objects on every page.
  const clientRects = Array.from(range.getClientRects()).filter(
    (r) => r.right - r.left > 0.5
  );

  // Merge rects on the same visual line to avoid fragment overlaps
  const lines: DOMRect[][] = [];
  for (const cr of clientRects) {
    const line = lines.find((l) => Math.abs(l[0].top - cr.top) < 3);
    if (line) line.push(cr);
    else lines.push([cr]);
  }

  const rects: RectAnchor[] = lines.map((line) => {
    const l = Math.min(...line.map((r) => r.left));
    const r = Math.max(...line.map((r) => r.right));
    const t = Math.min(...line.map((r) => r.top));
    const b = Math.max(...line.map((r) => r.bottom));
    return {
      left: (l - dw.left) / dw.width,
      top: (t - dw.top) / dw.height,
      right: (r - dw.left) / dw.width,
      bottom: (b - dw.top) / dw.height,
    };
  });
  return {
    text,
    rect: {
      left: (sr.left - dw.left) / dw.width,
      top: (sr.top - dw.top) / dw.height,
      right: (sr.right - dw.left) / dw.width,
      bottom: (sr.bottom - dw.top) / dw.height,
    },
    rects,
    pageNumber: pageNum,
  };
}

interface CommentMarker {
  id: number; page_number: number; type: "text_anchor" | "position";
  anchor_data: string; content?: string;
}
interface HighlightMark {
  id: number; page_number: number; color: string;
  anchor_data: string;
}

interface Props {
  fileUrl: string; pageCount: number;
  onPageChange?: (page: number) => void;
  onPositionClick?: (anchor: PositionAnchor) => void;
  onHighlightText?: (anchor: TextAnchor) => void;
  onCommentText?: (anchor: TextAnchor) => void;
  onSendToChat?: (text: string) => void;
  onCommentClick?: (commentId: number) => void;
  onCommentDelete?: (commentId: number) => void;
  onHighlightColorChange?: (highlightId: number, color: string) => void;
  onHighlightDelete?: (highlightId: number) => void;
  comments?: CommentMarker[]; highlights?: HighlightMark[];
  scrollToCommentId?: number | null;
}

export default function PDFViewer({
  fileUrl, pageCount, onPageChange, onPositionClick,
  onHighlightText, onCommentText, onSendToChat,
  onCommentClick, onCommentDelete, onHighlightColorChange, onHighlightDelete,
  comments = [], highlights = [], scrollToCommentId,
}: Props) {
  const [numPages, setNumPages] = useState(pageCount);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState("");

  // ── Zoom persistence ──────────────────────────
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(d => {
      if (d.pdf_zoom) { const z = parseFloat(d.pdf_zoom); if (z >= 0.5 && z <= 3) setScale(z); }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdf_zoom: String(scale) }) }).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [scale]);

  // ── Selection popup ───────────────────────────
  const { popup: selPopup, containerRef, dismiss: dismissSelPopup } =
    useTextSelectionPopup(getPDFAnchor);

  // ── Highlight click popup (rendered at body level) ──
  const [hlPopup, setHlPopup] = useState<{ x: number; y: number; highlightId: number; color: string } | null>(null);
  useEffect(() => {
    if (!hlPopup) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-hl-popup]")) setHlPopup(null);
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [hlPopup]);

  // ── Comment click popup ───────────────────────
  const [cmPopup, setCmPopup] = useState<{ x: number; y: number; commentId: number; content: string } | null>(null);
  useEffect(() => {
    if (!cmPopup) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-cm-popup]")) setCmPopup(null);
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [cmPopup]);

  // ── Track visible page ─────────────────────────
  useEffect(() => {
    const c = containerRef.current; if (!c || !onPageChange) return;
    const obs = new IntersectionObserver(entries => {
      const best = entries.reduce((a, b) => b.intersectionRatio > a.intersectionRatio ? b : a);
      if (best?.target) onPageChange(parseInt((best.target as HTMLElement).dataset.page || "1"));
    }, { root: c, threshold: [0.5] });
    c.querySelectorAll("[data-page]").forEach(p => obs.observe(p));
    return () => obs.disconnect();
  }, [numPages, onPageChange]);

  // ── Scroll to comment ──────────────────────────
  useEffect(() => {
    if (scrollToCommentId == null || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-comment-id="${scrollToCommentId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollToCommentId, comments]);

  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-sm text-gray-600 dark:text-gray-400">{numPages || pageCount} pages</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4"/></svg></button>
          <span className="text-xs text-gray-500 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(3, s + 0.2))} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg></button>
        </div>
      </div>

      {/* PDF content */}
      <div ref={containerRef} className="flex-1 overflow-auto flex flex-col items-center p-4 gap-4 relative">
        {error ? (
          <p className="text-red-500">{error}</p>
        ) : (
          <Document file={fileUrl} onLoadSuccess={({ numPages: p }) => setNumPages(p)} onLoadError={e => setError(`Failed to load PDF: ${e.message}`)}
            loading={<div className="flex gap-1.5 py-12">{Array.from({length:3}).map((_,i)=><span key={i} className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:`${i*150}ms`}}/>)}</div>}>
            {Array.from({ length: numPages || pageCount }, (_, i) => i + 1).map(pn => (
              <div key={pn} data-page={pn} className="relative shadow-lg bg-white">
                <Page pageNumber={pn} scale={scale} renderTextLayer={true} renderAnnotationLayer={true} />

                {/* Highlight overlays */}
                {highlights.filter(h => { try { const a=JSON.parse(h.anchor_data); return (a.page_number||a.pageNumber)===pn||h.page_number===pn } catch { return true } }).map(h => {
                  try {
                    const a = JSON.parse(h.anchor_data);
                    const rects: RectAnchor[] = a.rects || (a.rect ? [a.rect] : []);
                    return rects.map((r, i) => {
                      const w = Math.max((r.right - r.left) * 100, 2);
                      const ht = Math.max((r.bottom - r.top) * 100, 3);
                      return (
                        <div key={`hl-${h.id}-${i}`} data-highlight-id={h.id}
                          onClick={e => { e.stopPropagation(); const b = (e.target as HTMLElement).getBoundingClientRect(); setHlPopup({ x: b.right, y: b.bottom - 4, highlightId: h.id, color: h.color }); }}
                          className="absolute cursor-pointer opacity-35 hover:opacity-55 transition-opacity z-10"
                          style={{ backgroundColor: h.color, left: `${r.left*100}%`, top: `${r.top*100}%`, width: `${w}%`, height: `${ht}%` }}
                        />
                      );
                    });
                  } catch { return null; }
                })}

                {/* Comment markers */}
                {comments.filter(c => { try { const a=JSON.parse(c.anchor_data); return (a.page_number||a.pageNumber)===pn||c.page_number===pn } catch { return true } }).map(c => {
                  try {
                    const a = JSON.parse(c.anchor_data);
                    if (c.type === "text_anchor" && a.rect) {
                      const rects: RectAnchor[] = a.rects || [a.rect];
                      const isHighlighted = scrollToCommentId === c.id;
                      return rects.map((r, i) => {
                        const w = Math.max((r.right - r.left) * 100, 2);
                        const ht = Math.max((r.bottom - r.top) * 100, 3);
                        return (
                          <div key={`cm-${c.id}-${i}`} data-comment-id={c.id}
                            onClick={e => { e.stopPropagation(); const b = (e.target as HTMLElement).getBoundingClientRect(); setCmPopup({ x: b.right + 4, y: b.top, commentId: c.id, content: c.content || "" }); }}
                            className="absolute cursor-pointer group/cm z-20"
                            style={{ left: `${r.left*100}%`, top: `${r.top*100}%`, width: `${w}%`, height: `${ht}%` }}
                          >
                            <div className={`absolute inset-0 border-b-2 border-dashed transition-colors ${isHighlighted ? 'bg-blue-400/50 border-blue-600 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-blue-200/25 border-blue-400 group-hover/cm:bg-blue-300/35'}`} />
                            {i === 0 && <div className={`absolute -right-2 -top-2 w-4 h-4 rounded-full flex items-center justify-center shadow text-white text-[8px] transition-all ${isHighlighted ? 'bg-blue-600 scale-125 opacity-100' : 'bg-blue-500 opacity-0 group-hover/cm:opacity-100'}`}>💬</div>}
                          </div>
                        );
                      });
                    }
                    return (
                      <div key={`cm-${c.id}`} data-comment-id={c.id}
                        onClick={e => { e.stopPropagation(); const r = (e.target as HTMLElement).getBoundingClientRect(); setCmPopup({ x: r.right + 4, y: r.top, commentId: c.id, content: c.content || "" }); }}
                        className={`absolute cursor-pointer -translate-x-1/2 -translate-y-1/2 z-20 ${scrollToCommentId === c.id ? 'scale-125' : ''}`}
                        style={{ left: `${(a.x||0.5)*100}%`, top: `${(a.y||0.5)*100}%` }}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shadow-md transition-colors ${scrollToCommentId === c.id ? 'bg-blue-600 ring-2 ring-blue-300' : 'bg-blue-500 hover:bg-blue-600'}`}><span className="text-white text-[10px]">💬</span></div>
                      </div>
                    );
                  } catch { return null; }
                })}
              </div>
            ))}
          </Document>
        )}
      </div>

      {/* ── Popups rendered outside the scroll container ── */}

      {/* Selection popup */}
      {selPopup && (onHighlightText || onCommentText || onSendToChat) && (
        <div data-sel-popup className="fixed z-[100] flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl" style={{ left: selPopup.x, top: selPopup.y }}>
          {onHighlightText && (
            <button onClick={() => { onHighlightText({ text: selPopup.text, rect: selPopup.rect, rects: selPopup.rects, pageNumber: selPopup.pageNumber }); dismissSelPopup(); window.getSelection()?.removeAllRanges(); }}
              className="p-2 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-l-lg transition-colors" title="Highlight">
              <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
            </button>
          )}
          {onCommentText && (
            <button onClick={() => { onCommentText({ text: selPopup.text, rect: selPopup.rect, rects: selPopup.rects, pageNumber: selPopup.pageNumber }); dismissSelPopup(); window.getSelection()?.removeAllRanges(); }}
              className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Comment">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
            </button>
          )}
          {onSendToChat && (
            <button onClick={() => { onSendToChat(selPopup.text); dismissSelPopup(); window.getSelection()?.removeAllRanges(); }}
              className="p-2 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-r-lg transition-colors" title="Send to Chat">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
            </button>
          )}
        </div>
      )}

      {/* Highlight color popup */}
      {hlPopup && (
        <div data-hl-popup className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-2" style={{ left: hlPopup.x, top: hlPopup.y }}>
          <div className="flex gap-1 mb-2">
            {HL_COLORS.map(c => (
              <button key={c} onClick={() => { onHighlightColorChange?.(hlPopup.highlightId, c); setHlPopup(null); }}
                className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: hlPopup.color === c ? "#012B67" : "transparent" }}
              />
            ))}
          </div>
          <button onClick={() => { onHighlightDelete?.(hlPopup.highlightId); setHlPopup(null); }}
            className="w-full flex items-center justify-center gap-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded py-1 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            Delete
          </button>
        </div>
      )}

      {/* Comment popup */}
      {cmPopup && (
        <div data-cm-popup className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-3 max-w-[280px]" style={{ left: cmPopup.x, top: cmPopup.y }}>
          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap mb-3 leading-relaxed">
            {cmPopup.content || "(empty comment)"}
          </p>
          <div className="flex gap-2">
            <button onClick={() => { onCommentClick?.(cmPopup.commentId); setCmPopup(null); }}
              className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors font-medium">
              View in panel
            </button>
            <button onClick={() => { onCommentDelete?.(cmPopup.commentId); setCmPopup(null); }}
              className="flex items-center justify-center gap-1 text-xs py-1.5 px-3 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}