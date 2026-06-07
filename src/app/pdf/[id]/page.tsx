"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import PDFViewer from "@/components/PDFViewer";
import type { PositionAnchor, TextAnchor } from "@/components/PDFViewer";
import ChatWindow from "@/components/ChatWindow";
import CommentPanel from "@/components/CommentPanel";

interface PdfInfo { id: number; original_name: string; page_count: number; }
interface Comment { id: number; pdf_id: number; page_number: number; type: "text_anchor" | "position"; anchor_data: string; content: string; created_at: string; updated_at: string; }
interface Highlight { id: number; pdf_id: number; page_number: number; color: string; anchor_data: string; created_at: string; }

type RightPanel = "chat" | "comments";

export default function PDFReaderPage() {
  const params = useParams();
  const pdfId = parseInt(params.id as string);

  const [pdf, setPdf] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [allComments, setAllComments] = useState<Comment[]>([]);
  const [allHighlights, setAllHighlights] = useState<Highlight[]>([]);
  const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null);

  const [pendingAnchor, setPendingAnchor] = useState<{
    type: "text_anchor" | "position"; data: TextAnchor | PositionAnchor;
  } | null>(null);

  // Text pushed to chat from PDF selection
  const [selectionText, setSelectionText] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pdfs/${pdfId}`).then(r => r.json()).then(d => { if (d.error) setError(d.error); else setPdf(d); }).catch(() => setError("Failed to load PDF info")).finally(() => setLoading(false));
    // Record this visit for recent sessions
    fetch(`/api/pdfs/${pdfId}/touch`, { method: "POST" }).catch(() => {});
  }, [pdfId]);

  useEffect(() => {
    if (pdfId) {
      fetch(`/api/chat/sessions?pdf_id=${pdfId}`).then(r => r.json()).then(async sessions => {
        if (Array.isArray(sessions) && sessions.length > 0) { setSessionId(sessions[0].id); }
        else { const r2 = await fetch("/api/chat/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pdf_id: pdfId, title: "Chat" }) }); const d = await r2.json(); if (d.id) setSessionId(d.id); }
      }).catch(console.error);
    }
  }, [pdfId]);

  const refreshData = useCallback(() => {
    fetch(`/api/comments?pdf_id=${pdfId}`).then(r => r.json()).then(d => { if (!d.error) setAllComments(d); }).catch(() => {});
    fetch(`/api/highlights?pdf_id=${pdfId}`).then(r => r.json()).then(d => { if (!d.error) setAllHighlights(d); }).catch(() => {});
  }, [pdfId]);

  useEffect(() => { refreshData(); }, [refreshData]);

  const handlePageChange = useCallback((p: number) => setCurrentPage(p), []);

  // ── PDF interaction handlers ──────────────────

  const handlePositionClick = useCallback((anchor: PositionAnchor) => {
    setPendingAnchor({ type: "position", data: anchor });
    setRightPanel("comments");
    setSidebarOpen(true);
  }, []);

  const handleCommentText = useCallback((anchor: TextAnchor) => {
    setPendingAnchor({ type: "text_anchor", data: anchor });
    if (anchor.pageNumber) setCurrentPage(anchor.pageNumber);
    setRightPanel("comments");
    setSidebarOpen(true);
  }, []);

  const handleHighlightText = useCallback(async (anchor: TextAnchor) => {
    const page = anchor.pageNumber || currentPage;
    try {
      await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_id: pdfId, page_number: page, color: "#fef08a", anchor_data: { rect: anchor.rect, text: anchor.text, page_number: page } }),
      });
      refreshData();
    } catch (err) { console.error("Failed to create highlight:", err); }
  }, [pdfId, currentPage, refreshData]);

  const handleSendToChat = useCallback((text: string) => {
    setSelectionText(text);
    setRightPanel("chat");
    setSidebarOpen(true);
  }, []);

  const handleCommentClick = useCallback((commentId: number) => {
    setHighlightedCommentId(commentId);
    setRightPanel("comments");
    setSidebarOpen(true);
  }, []);

  const handleCommentDelete = useCallback(async (commentId: number) => {
    try {
      await fetch(`/api/comments/${commentId}`, { method: "DELETE" });
      refreshData();
    } catch (err) { console.error("Failed to delete comment:", err); }
  }, [refreshData]);

  const handleHighlightColorChange = useCallback(async (highlightId: number, color: string) => {
    try {
      await fetch(`/api/highlights/${highlightId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ color }) });
      refreshData();
    } catch (err) { console.error("Failed to update highlight color:", err); }
  }, [refreshData]);

  const handleHighlightDelete = useCallback(async (highlightId: number) => {
    try {
      await fetch(`/api/highlights/${highlightId}`, { method: "DELETE" });
      refreshData();
    } catch (err) { console.error("Failed to delete highlight:", err); }
  }, [refreshData]);

  const handleAnchorConsumed = useCallback(() => {
    setPendingAnchor(null);
    refreshData();
  }, [refreshData]);

  if (loading) return <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950"><div className="text-gray-500 dark:text-gray-400">Loading PDF...</div></div>;
  if (error || !pdf) return <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950"><div className="text-red-500">{error || "PDF not found"}</div></div>;

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 min-w-0">
        <PDFViewer
          fileUrl={`/api/pdfs/${pdfId}/file`} pageCount={pdf.page_count}
          onPageChange={handlePageChange}
          onPositionClick={handlePositionClick}
          onHighlightText={handleHighlightText}
          onCommentText={handleCommentText}
          onSendToChat={handleSendToChat}
          onCommentClick={handleCommentClick}
          onCommentDelete={handleCommentDelete}
          onHighlightColorChange={handleHighlightColorChange}
          onHighlightDelete={handleHighlightDelete}
          comments={allComments} highlights={allHighlights}
          scrollToCommentId={highlightedCommentId}
        />
      </div>

      {sidebarOpen ? (
        <div className="w-[420px] shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <button
              onClick={() => setSidebarOpen(false)}
              className="px-3 py-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Hide panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button onClick={() => setRightPanel("chat")} className={`flex-1 py-3 text-sm font-medium transition-colors ${rightPanel === "chat" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}>Chat</button>
            <button onClick={() => setRightPanel("comments")} className={`flex-1 py-3 text-sm font-medium transition-colors relative ${rightPanel === "comments" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}>
              Comments{pendingAnchor && <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />}
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {rightPanel === "chat" ? (
              <ChatWindow pdfId={pdfId} sessionId={sessionId} onSessionCreated={setSessionId}
                selectionText={selectionText} onSelectionConsumed={() => setSelectionText(null)} />
            ) : (
              <CommentPanel pdfId={pdfId} pageNumber={currentPage} pendingAnchor={pendingAnchor}
                onAnchorConsumed={handleAnchorConsumed} onCommentAdded={refreshData}
                highlightedCommentId={highlightedCommentId} />
            )}
          </div>
        </div>
      ) : (
        <div className="shrink-0 flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
            title="Show panel"
          >
            <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 flex flex-col items-center pt-2 gap-4">
            <button
              onClick={() => { setSidebarOpen(true); setRightPanel("chat"); }}
              className={`writing-vertical py-3 px-2 text-xs font-medium transition-colors rounded ${rightPanel === "chat" ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
              title="Chat"
              style={{ writingMode: "vertical-rl" }}
            >
              Chat
            </button>
            <button
              onClick={() => { setSidebarOpen(true); setRightPanel("comments"); }}
              className={`writing-vertical py-3 px-2 text-xs font-medium transition-colors rounded relative ${rightPanel === "comments" ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}
              title="Comments"
              style={{ writingMode: "vertical-rl" }}
            >
              Comments{pendingAnchor && <span className="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
