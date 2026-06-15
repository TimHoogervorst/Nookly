"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Props {
  targetType?: "pdf" | "recording";
  targetId?: number;
  pdfId?: number; // deprecated — use targetType + targetId
  sessionId: number | null;
  onSessionCreated: (sessionId: number) => void;
  selectionText?: string | null;
  onSelectionConsumed?: () => void;
}

const QUICK_ACTIONS: Record<string, { label: string; message: string }> = {
  summarize: { label: "Summarize document", message: "Summarize this document" },
  keypoints: { label: "Extract key points", message: "Extract the key points from this document" },
  quiz: { label: "Quiz me", message: "Quiz me on this document" },
};

export default function ChatWindow({
  targetType: explicitTargetType,
  targetId: explicitTargetId,
  pdfId: deprecatedPdfId,
  sessionId,
  onSessionCreated,
  selectionText,
  onSelectionConsumed,
}: Props) {
  const targetType = explicitTargetType || "pdf";
  const targetId = explicitTargetId ?? deprecatedPdfId ?? 0;
  const docLabel = targetType === "recording" ? "recording" : "PDF";

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [ctxPrompt, setCtxPrompt] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamBufferRef = useRef("");

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (sessionId) {
      setLoadingMessages(true);
      fetch(`/api/chat/sessions/${sessionId}`)
        .then((res) => res.json())
        .then((data) => { if (!data.error) setMessages(data); })
        .catch(console.error)
        .finally(() => setLoadingMessages(false));
    } else {
      setMessages([]);
    }
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  const sendMessage = useCallback(
    async (text: string, skill?: string) => {
      if (!text.trim() || streaming) return;
      const userMessage: Message = { role: "user", content: text };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setStreaming(true);
      streamBufferRef.current = "";
      setStreamContent("");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_type: targetType, target_id: targetId, session_id: sessionId, message: text, skill: skill || null }),
        });
        if (!res.ok) { const err = await res.json(); setStreamContent("Error: " + err.error); return; }
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) { streamBufferRef.current += parsed.content; setStreamContent(streamBufferRef.current); }
              } catch { /* skip */ }
            }
          }
        }
      } catch {
        streamBufferRef.current = "";
        setStreamContent("Connection error. Please try again.");
      } finally {
        setStreaming(false);
        const finalContent = streamBufferRef.current;
        if (finalContent) setMessages((msgs) => [...msgs, { role: "assistant", content: finalContent }]);
        setStreamContent("");
        streamBufferRef.current = "";
      }
    },
    [targetType, targetId, sessionId, streaming]
  );

  const handleSend = () => sendMessage(input);

  const handleQuickAction = (skillId: string) => {
    const action = QUICK_ACTIONS[skillId];
    if (action) sendMessage(action.message, skillId);
  };

  const handleSelectionAction = (skillId: string) => {
    if (!selectionText) return;
    const prompts: Record<string, string> = {
      summarize: `Summarize the following text from the ${docLabel}: "` + selectionText + '"',
      explain: `Explain the following text from the ${docLabel}: "` + selectionText + '"',
      keypoints: 'Extract the key points from the following text: "' + selectionText + '"',
    };
    sendMessage(prompts[skillId] || 'Regarding this text: "' + selectionText + '"', skillId);
    onSelectionConsumed?.();
  };

  const handleCustomAsk = () => {
    if (!ctxPrompt.trim() || !selectionText) return;
    sendMessage('Regarding the following text: "' + selectionText + '"\n\n' + ctxPrompt.trim());
    setCtxPrompt("");
    onSelectionConsumed?.();
  };

  const handleCtxKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && ctxPrompt.trim()) handleCustomAsk();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {loadingMessages ? (
          <p className="text-center text-gray-400 dark:text-gray-500 text-sm">Loading messages...</p>
        ) : !hasMessages && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 mb-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-1">Ask anything about this {docLabel}</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs">Try a quick action below or type your question</p>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-4 py-2 text-sm ${msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"}`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
            {streamContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                  <div className="whitespace-pre-wrap">{streamContent}</div>
                </div>
              </div>
            )}
            {streaming && !streamContent && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Contextual: selection pushed from PDF */}
      {selectionText && (
        <div className="px-4 py-3 border-t border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wide text-green-600 dark:text-green-400 font-medium">Text Selection</p>
            <button onClick={onSelectionConsumed} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">x</button>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 italic line-clamp-2">
            &ldquo;{selectionText.slice(0, 200)}{selectionText.length > 200 ? "..." : ""}&rdquo;
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => handleSelectionAction("summarize")} disabled={streaming}
              className="px-3 py-1.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors">
              Summarize selection
            </button>
            <button onClick={() => handleSelectionAction("explain")} disabled={streaming}
              className="px-3 py-1.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors">
              Explain selection
            </button>
            <button onClick={() => handleSelectionAction("keypoints")} disabled={streaming}
              className="px-3 py-1.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors">
              Key points about selection
            </button>
          </div>
          <div className="flex gap-2">
            <input value={ctxPrompt} onChange={e => setCtxPrompt(e.target.value)} onKeyDown={handleCtxKeyDown}
              placeholder="Or ask something custom..."
              className="flex-1 px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-green-500"
            />
            <button onClick={handleCustomAsk} disabled={!ctxPrompt.trim() || streaming}
              className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-40 transition-colors">
              Ask
            </button>
          </div>
        </div>
      )}

      {/* Quick actions */}
      {!hasMessages ? (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Quick Actions</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(QUICK_ACTIONS).map(([skillId, action]) => (
              <button key={skillId} onClick={() => handleQuickAction(skillId)} disabled={streaming}
                className="px-3 py-1.5 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors">
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-100 dark:border-gray-700">
          <button onClick={() => setQuickActionsOpen(!quickActionsOpen)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <span className="font-medium">Quick Actions</span>
            <svg className={`w-3.5 h-3.5 transition-transform ${quickActionsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {quickActionsOpen && (
            <div className="px-4 pb-3 space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(QUICK_ACTIONS).map(([skillId, action]) => (
                  <button key={skillId} onClick={() => { handleQuickAction(skillId); setQuickActionsOpen(false); }} disabled={streaming}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors">
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-2">
          <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={`Ask a question about this ${docLabel}...`} rows={2} disabled={streaming}
            className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-50 dark:disabled:bg-gray-700"
          />
          <button onClick={handleSend} disabled={streaming || !input.trim()}
            className="shrink-0 w-10 h-10 bg-blue-600 text-white rounded-lg flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
