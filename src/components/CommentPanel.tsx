"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PositionAnchor, TextAnchor, RectAnchor } from "./PDFViewer";

interface Comment {
  id: number;
  pdf_id: number;
  page_number: number;
  type: "text_anchor" | "position";
  anchor_data: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface Highlight {
  id: number;
  pdf_id: number;
  page_number: number;
  color: string;
  anchor_data: string;
  created_at: string;
}

interface Props {
  pdfId: number;
  pageNumber: number;
  onCommentAdded?: () => void;
  pendingAnchor?: { type: "text_anchor" | "position"; data: TextAnchor | PositionAnchor } | null;
  pendingHighlight?: { rect: RectAnchor; text: string; color: string } | null;
  onAnchorConsumed?: () => void;
  highlightedCommentId?: number | null;
}

export default function CommentPanel({
  pdfId,
  pageNumber,
  onCommentAdded,
  pendingAnchor,
  pendingHighlight,
  onAnchorConsumed,
  highlightedCommentId,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [newComment, setNewComment] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [tab, setTab] = useState<"comments" | "highlights">("comments");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const commentRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Focus input when pending anchor arrives
  useEffect(() => {
    if (pendingAnchor) {
      setTab("comments");
      inputRef.current?.focus();
    }
  }, [pendingAnchor]);

  // Scroll to highlighted comment (retry until refs are populated)
  useEffect(() => {
    if (highlightedCommentId == null) return;
    setTab("comments");
    let attempts = 0;
    const tryScroll = () => {
      const el = commentRefs.current.get(highlightedCommentId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (++attempts < 10) setTimeout(tryScroll, 150);
    };
    setTimeout(tryScroll, 150);
  }, [highlightedCommentId]);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?pdf_id=${pdfId}&page=${pageNumber}`);
      if (res.ok) setComments(await res.json());
    } catch (err) {
      console.error("Failed to fetch comments:", err);
    }
  }, [pdfId, pageNumber]);

  const fetchHighlights = useCallback(async () => {
    try {
      const res = await fetch(`/api/highlights?pdf_id=${pdfId}&page=${pageNumber}`);
      if (res.ok) setHighlights(await res.json());
    } catch (err) {
      console.error("Failed to fetch highlights:", err);
    }
  }, [pdfId, pageNumber]);

  useEffect(() => { fetchComments(); }, [fetchComments]);
  useEffect(() => { fetchHighlights(); }, [fetchHighlights]);

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    const anchorData = { ...(pendingAnchor?.data || { x: 0.5, y: 0.5 }), page_number: pageNumber };
    const anchorType = pendingAnchor?.type || "position";
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdf_id: pdfId,
          page_number: pageNumber,
          type: anchorType,
          anchor_data: anchorData,
          content: newComment.trim(),
        }),
      });
      if (res.ok) {
        setNewComment("");
        await fetchComments();
        onCommentAdded?.();
        onAnchorConsumed?.();
      }
    } catch (err) {
      console.error("Failed to add comment:", err);
    }
  };

  const handleAddHighlight = async () => {
    if (!pendingHighlight) return;
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdf_id: pdfId,
          page_number: pageNumber,
          color: pendingHighlight.color,
          anchor_data: {
            rect: pendingHighlight.rect,
            text: pendingHighlight.text,
            page_number: pageNumber,
          },
        }),
      });
      if (res.ok) {
        await fetchHighlights();
        onAnchorConsumed?.();
      }
    } catch (err) {
      console.error("Failed to add highlight:", err);
    }
  };

  // When there's a pending highlight, auto-add it
  useEffect(() => {
    if (pendingHighlight) handleAddHighlight();
  }, [pendingHighlight]);

  const handleUpdate = async (id: number) => {
    if (!editContent.trim()) return;
    try {
      await fetch(`/api/comments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      setEditingId(null);
      await fetchComments();
      onCommentAdded?.();
    } catch (err) {
      console.error("Failed to update comment:", err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/comments/${id}`, { method: "DELETE" });
      await fetchComments();
      onCommentAdded?.();
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const handleDeleteHighlight = async (id: number) => {
    try {
      await fetch(`/api/highlights/${id}`, { method: "DELETE" });
      await fetchHighlights();
      onCommentAdded?.();
    } catch (err) {
      console.error("Failed to delete highlight:", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">Page {pageNumber}</h3>
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            <button
              onClick={() => setTab("comments")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                tab === "comments"
                  ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              Comments ({comments.length})
            </button>
            <button
              onClick={() => setTab("highlights")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                tab === "highlights"
                  ? "bg-white dark:bg-gray-700 text-yellow-600 dark:text-yellow-400 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              Highlights ({highlights.length})
            </button>
          </div>
        </div>
        {pendingAnchor && (
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            {pendingAnchor.type === "text_anchor" ? "Commenting on selected text" : "Placing comment at clicked position"}
          </p>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {tab === "comments" && (
          <>
            {comments.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 text-sm mt-8">
                No comments on this page.<br />
                <span className="text-xs">Click on the PDF or select text to comment.</span>
              </p>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  ref={(el) => { if (el) commentRefs.current.set(comment.id, el); }}
                  className={`rounded-lg p-3 group border-l-2 transition-colors ${
                    highlightedCommentId === comment.id
                      ? "bg-blue-50 dark:bg-blue-900/20 border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800"
                      : "bg-gray-50 dark:bg-gray-800 border-blue-400 dark:border-blue-600"
                  }`}
                >
                  {editingId === comment.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={3}
                        className="w-full resize-none rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdate(comment.id)} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-[10px] uppercase font-medium text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                        {comment.type === "text_anchor" ? "Selection" : "Sticky Note"}
                      </span>
                      <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap mt-1.5">{comment.content}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(comment.created_at).toLocaleString()}</span>
                        <div className="flex gap-2">
                          <button onClick={() => { setEditingId(comment.id); setEditContent(comment.content); }} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800">Edit</button>
                          <button onClick={() => handleDelete(comment.id)} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800">Delete</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {tab === "highlights" && (
          <>
            {highlights.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 text-sm mt-8">
                No highlights on this page.<br />
                <span className="text-xs">Select text on the PDF and click "Highlight".</span>
              </p>
            ) : (
              highlights.map((h) => {
                const anchor = JSON.parse(h.anchor_data);
                return (
                  <div key={h.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 group border-l-2 border-yellow-400">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: h.color }} />
                      <span className="text-[10px] uppercase font-medium text-yellow-600 dark:text-yellow-400">
                        Highlight
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 italic">
                      "{anchor.text?.slice(0, 150)}"
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(h.created_at).toLocaleString()}</span>
                      <button onClick={() => handleDeleteHighlight(h.id)} className="text-xs text-red-600 dark:text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-800 transition-opacity">Delete</button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Add comment input (only in comments tab) */}
      {tab === "comments" && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <textarea
            ref={inputRef}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
            placeholder="Select text or click on the PDF to comment... (Enter to send, Shift+Enter for new line)"
            rows={3}
            className="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button
            onClick={handleAddComment}
            disabled={!newComment.trim()}
            className="mt-2 w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add Comment
          </button>
        </div>
      )}
    </div>
  );
}
