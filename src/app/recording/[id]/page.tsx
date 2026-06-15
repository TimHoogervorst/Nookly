"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import ChatWindow from "@/components/ChatWindow";
import CommentPanel from "@/components/CommentPanel";
import type { TextAnchor, PositionAnchor } from "@/components/PDFViewer";
import TranscriptViewer from "@/components/TranscriptViewer";

interface RecordingInfo {
  id: number;
  original_name: string;
  duration_seconds: number;
  transcript_status: "processing" | "done" | "error";
  transcript_text: string | null;
}

interface Segment {
  id: number;
  recording_id: number;
  segment_index: number;
  start_time: number;
  end_time: number;
  text: string;
}

type RightPanel = "chat" | "comments";

export default function RecordingViewerPage() {
  const params = useParams();
  const recordingId = parseInt(params.id as string);

  const [recording, setRecording] = useState<RecordingInfo | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sentencesPerBlock, setSentencesPerBlock] = useState(10);

  const [allComments, setAllComments] = useState<
    { id: number; target_type: string; target_id: number; page_number: number; type: string; anchor_data: string; content: string; start_word: number | null; end_word: number | null }[]
  >([]);
  const [allHighlights, setAllHighlights] = useState<
    { id: number; target_type: string; target_id: number; page_number: number; color: string; anchor_data: string; start_word: number | null; end_word: number | null }[]
  >([]);
  const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<{
    type: "text_anchor" | "position";
    data: TextAnchor | PositionAnchor;
  } | null>(null);
  const [selectionText, setSelectionText] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [waveformAmps, setWaveformAmps] = useState<number[]>([]);

  // Compute waveform amplitudes once audio is loaded
  useEffect(() => {
    if (!recording || recording.transcript_status !== "done") return;
    let cancelled = false;
    async function compute() {
      try {
        const audioCtx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)();
        const resp = await fetch(`/api/recordings/${recordingId}/file`);
        const buf = await resp.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(buf);
        await audioCtx.close();
        if (cancelled) return;

        const data = audioBuffer.getChannelData(0);
        const windowSamples = Math.floor(audioBuffer.sampleRate * 0.05);
        const amps: number[] = [];
        for (let i = 0; i < data.length; i += windowSamples) {
          let sum = 0;
          const end = Math.min(i + windowSamples, data.length);
          for (let j = i; j < end; j++) sum += data[j] * data[j];
          amps.push(Math.sqrt(sum / (end - i)));
        }
        const max = Math.max(...amps, 0.001);
        setWaveformAmps(amps.map((a) => a / max));
      } catch (err) {
        console.error("Waveform computation failed:", err);
      }
    }
    compute();
    return () => { cancelled = true; };
  }, [recording?.transcript_status, recordingId]);
  useEffect(() => {
    async function fetchRecording() {
      try {
        const res = await fetch(
          `/api/recordings/${recordingId}?sentences_per_block=${sentencesPerBlock}`
        );
        const data = await res.json();
        if (data.error) {
          setError(data.error);
          return;
        }
        setRecording(data);

        // Poll while transcribing
        if (data.transcript_status === "processing") {
          const interval = setInterval(async () => {
            const r = await fetch(`/api/recordings/${recordingId}?sentences_per_block=${sentencesPerBlock}`);
            const d = await r.json();
            if (d.transcript_status !== "processing") {
              clearInterval(interval);
              setRecording(d);
              if (d.segments) setSegments(d.segments);
            }
          }, 2000);
          return () => clearInterval(interval);
        } else if (data.transcript_status === "done" && data.segments) {
          setSegments(data.segments);
        }
      } catch {
        setError("Failed to load recording");
      } finally {
        setLoading(false);
      }
    }
    fetchRecording();

    // Touch recording visit
    fetch(`/api/recordings/${recordingId}/touch`, { method: "POST" }).catch(() => {});
  }, [recordingId, sentencesPerBlock]);

  // Fetch segments when recording becomes ready or threshold changes
  useEffect(() => {
    if (!recording || recording.transcript_status !== "done") return;
    fetch(`/api/recordings/${recordingId}?sentences_per_block=${sentencesPerBlock}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.segments) {
          setSegments(d.segments);
          setDuration(
            d.duration_seconds ||
              (d.segments.length > 0
                ? d.segments[d.segments.length - 1].end_time
                : 0)
          );
        }
      })
      .catch(console.error);
  }, [recording?.transcript_status, recordingId, sentencesPerBlock]);

  // Session management
  useEffect(() => {
    if (recordingId) {
      fetch(`/api/chat/sessions?target_type=recording&target_id=${recordingId}`)
        .then((r) => r.json())
        .then(async (sessions) => {
          if (Array.isArray(sessions) && sessions.length > 0) {
            setSessionId(sessions[0].id);
          } else {
            const r2 = await fetch("/api/chat/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                target_type: "recording",
                target_id: recordingId,
                title: "Chat",
              }),
            });
            const d = await r2.json();
            if (d.id) setSessionId(d.id);
          }
        })
        .catch(console.error);
    }
  }, [recordingId]);

  // Find which segment contains the given anchor text
  const remapToSegment = useCallback(
    (text: string): number => {
      if (!text || segments.length === 0) return 0;
      // Strip punctuation and lowercase for fuzzy matching
      const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      const words = clean.split(" ").filter((w) => w.length > 1);

      let bestIdx = 0;
      let bestScore = 0;

      for (const seg of segments) {
        const segClean = seg.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        // Check for substring match (either direction)
        if (segClean.includes(clean) || clean.includes(segClean.slice(0, clean.length + 20))) {
          return seg.segment_index; // exact match, use immediately
        }
        // Word overlap score
        const segWords = new Set(segClean.split(" "));
        const overlap = words.filter((w) => segWords.has(w)).length;
        if (overlap > bestScore) {
          bestScore = overlap;
          bestIdx = seg.segment_index;
        }
      }

      return bestIdx;
    },
    [segments]
  );

  // Refresh comments & highlights (with remapping built in)
  const refreshData = useCallback(() => {
    fetch(`/api/comments?target_type=recording&target_id=${recordingId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error && Array.isArray(d)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setAllComments(
            d.map((c: any) => {
              try {
                const anchor = JSON.parse(c.anchor_data);
                return { ...c, page_number: remapToSegment(anchor.text || "") };
              } catch {
                return c;
              }
            })
          );
        }
      })
      .catch(() => {});
    fetch(`/api/highlights?target_type=recording&target_id=${recordingId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error && Array.isArray(d)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setAllHighlights(
            d.map((h: any) => {
              try {
                const anchor = JSON.parse(h.anchor_data);
                return { ...h, page_number: remapToSegment(anchor.text || "") };
              } catch {
                return h;
              }
            })
          );
        }
      })
      .catch(() => {});
  }, [recordingId, remapToSegment]);

  useEffect(() => {
    refreshData();
  }, [refreshData, sentencesPerBlock]);

  // Audio player event handlers
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleDurationChange = useCallback(() => {
    if (audioRef.current && audioRef.current.duration) {
      setDuration(audioRef.current.duration);
    }
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleEnded = useCallback(() => setIsPlaying(false), []);

  const handleSeek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, []);

  const handleSpeedChange = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const skipTime = useCallback(
    (seconds: number) => {
      if (audioRef.current) {
        const newTime = Math.max(
          0,
          Math.min(audioRef.current.currentTime + seconds, duration)
        );
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      }
    },
    [duration]
  );

  // Comment handlers
  const handleCommentAdded = useCallback(() => {
    refreshData();
  }, [refreshData]);

  const handleAnchorConsumed = useCallback(() => {
    setPendingAnchor(null);
    refreshData();
  }, [refreshData]);

  // ── Word position helpers ──

  // Full transcript as word array (concat all segment texts)
  const fullWords = segments
    .map((s) => s.text)
    .join(" ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const findWordPosition = useCallback(
    (text: string): { startWord: number; endWord: number } | null => {
      if (!text || fullWords.length === 0) return null;
      const targetWords = text.split(/\s+/).filter((w) => w.length > 0);
      if (targetWords.length === 0) return null;

      // Search for the sequence of words in the full text
      for (let i = 0; i <= fullWords.length - targetWords.length; i++) {
        let match = true;
        for (let j = 0; j < targetWords.length; j++) {
          if (
            fullWords[i + j].toLowerCase().replace(/[^a-z0-9]/g, "") !==
            targetWords[j].toLowerCase().replace(/[^a-z0-9]/g, "")
          ) {
            match = false;
            break;
          }
        }
        if (match) {
          return { startWord: i, endWord: i + targetWords.length - 1 };
        }
      }
      // Partial match: find best overlap
      const firstWord = targetWords[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      for (let i = 0; i < fullWords.length; i++) {
        if (fullWords[i].toLowerCase().replace(/[^a-z0-9]/g, "") === firstWord) {
          return { startWord: i, endWord: i + targetWords.length - 1 };
        }
      }
      return null;
    },
    [fullWords]
  );

  // ── Selection popup handlers (PDFViewer pattern) ──

  const handleHighlightText = useCallback(
    async (text: string, segmentIndex: number) => {
      const pos = findWordPosition(text);
      try {
        await fetch("/api/highlights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_type: "recording",
            target_id: recordingId,
            page_number: segmentIndex,
            color: "#fef08a",
            start_word: pos?.startWord,
            end_word: pos?.endWord,
            anchor_data: {
              rect: { left: 0, top: 0, right: 0, bottom: 0 },
              text,
              page_number: segmentIndex,
            },
          }),
        });
        refreshData();
      } catch (err) {
        console.error("Failed to create highlight:", err);
      }
    },
    [recordingId, refreshData, findWordPosition]
  );

  const handleCommentText = useCallback(
    (text: string, segmentIndex: number) => {
      const pos = findWordPosition(text);
      setPendingAnchor({
        type: "text_anchor",
        data: {
          text,
          rect: { left: 0, top: 0, right: 0, bottom: 0 },
          pageNumber: segmentIndex,
          startWord: pos?.startWord,
          endWord: pos?.endWord,
        } as TextAnchor & { startWord?: number; endWord?: number },
      });
      setCurrentSegment(segmentIndex);
      setRightPanel("comments");
      setSidebarOpen(true);
    },
    [findWordPosition]
  );

  const handleSendToChat = useCallback((text: string) => {
    setSelectionText(text);
    setRightPanel("chat");
    setSidebarOpen(true);
  }, []);

  // Format helpers
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-500 dark:text-gray-400">
          Loading recording...
        </div>
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-red-500">{error || "Recording not found"}</div>
      </div>
    );
  }

  const isProcessing = recording.transcript_status === "processing";
  const isFailed = recording.transcript_status === "error";
  const isReady = recording.transcript_status === "done";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Audio Player Bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <audio
          ref={audioRef}
          src={`/api/recordings/${recordingId}/file`}
          preload="auto"
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
        />

        {/* Skip back */}
        <button
          onClick={() => skipTime(-10)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Skip back 10s"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors"
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Skip forward */}
        <button
          onClick={() => skipTime(10)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Skip forward 10s"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
          </svg>
        </button>

        {/* Time display */}
        <span className="text-sm text-gray-600 dark:text-gray-400 tabular-nums min-w-[90px]">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={(e) => handleSeek(parseFloat(e.target.value))}
          className="flex-1 h-1 accent-blue-600 cursor-pointer"
        />

        {/* Speed selector */}
        <select
          value={playbackRate}
          onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
          className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer"
        >
          <option value={0.5}>0.5x</option>
          <option value={0.75}>0.75x</option>
          <option value={1}>1x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>

        {/* Sentences-per-block slider */}
        <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-gray-200 dark:border-gray-700">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
            ~{sentencesPerBlock} sent.
          </span>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={sentencesPerBlock}
            onChange={(e) => setSentencesPerBlock(parseInt(e.target.value))}
            className="w-16 h-1 accent-blue-600 cursor-pointer"
            title={`${sentencesPerBlock} sentence${sentencesPerBlock > 1 ? "s" : ""} per block — lower = more paragraphs, higher = fewer`}
          />
        </div>
      </div>

      {/* Main content: Transcript + Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Transcript */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {isProcessing && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="font-medium">Transcribing your recording...</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                This may take a moment
              </p>
            </div>
          )}

          {isFailed && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <svg
                  className="w-7 h-7 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-red-600 dark:text-red-400 font-medium">
                Transcription failed
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
                Check that your transcription API is configured in Settings
                (endpoint, API key, and model).
              </p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={async () => {
                    setRecording((prev) =>
                      prev ? { ...prev, transcript_status: "processing" } : null
                    );
                    try {
                      await fetch(`/api/recordings/${recordingId}/retry`, {
                        method: "POST",
                      });
                    } catch {
                      setRecording((prev) =>
                        prev ? { ...prev, transcript_status: "error" } : null
                      );
                    }
                  }}
                  className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Retry Transcription
                </button>
              </div>
            </div>
          )}

          {isReady && (
            <TranscriptViewer
              segments={segments}
              currentTime={currentTime}
              onSegmentChange={setCurrentSegment}
              onSeek={handleSeek}
              onHighlightText={handleHighlightText}
              onCommentText={handleCommentText}
              onSendToChat={handleSendToChat}
              amplitudes={waveformAmps}
              duration={duration}
              comments={allComments}
              highlights={allHighlights}
              onCommentClick={(commentId) => {
                setHighlightedCommentId(commentId);
                setRightPanel("comments");
                setSidebarOpen(true);
              }}
            />
          )}
        </div>

        {/* Sidebar */}
        {sidebarOpen ? (
          <div className="w-[420px] shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col">
            <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <button
                onClick={() => setSidebarOpen(false)}
                className="px-3 py-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Hide panel"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
              <button
                onClick={() => setRightPanel("chat")}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  rightPanel === "chat"
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setRightPanel("comments")}
                className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                  rightPanel === "comments"
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                Comments
                {pendingAnchor && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full" />
                )}
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              {!isReady ? (
                <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500 px-4 text-center">
                  {isProcessing
                    ? "Chat and comments will be available once transcription completes."
                    : "Chat and comments are unavailable because transcription failed."}
                </div>
              ) : rightPanel === "chat" ? (
                <ChatWindow
                  targetType="recording"
                  targetId={recordingId}
                  sessionId={sessionId}
                  onSessionCreated={setSessionId}
                  selectionText={selectionText}
                  onSelectionConsumed={() => setSelectionText(null)}
                />
              ) : (
                <CommentPanel
                  targetType="recording"
                  targetId={recordingId}
                  segmentIndex={currentSegment}
                  pendingAnchor={pendingAnchor}
                  onAnchorConsumed={handleAnchorConsumed}
                  onCommentAdded={handleCommentAdded}
                  highlightedCommentId={highlightedCommentId}
                />
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
              <svg
                className="w-4 h-4 group-hover:scale-110 transition-transform"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div className="flex-1 flex flex-col items-center pt-2 gap-4">
              <button
                onClick={() => {
                  setSidebarOpen(true);
                  setRightPanel("chat");
                }}
                className={`writing-vertical py-3 px-2 text-xs font-medium transition-colors rounded ${
                  rightPanel === "chat"
                    ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
                title="Chat"
                style={{ writingMode: "vertical-rl" }}
              >
                Chat
              </button>
              <button
                onClick={() => {
                  setSidebarOpen(true);
                  setRightPanel("comments");
                }}
                className={`writing-vertical py-3 px-2 text-xs font-medium transition-colors rounded relative ${
                  rightPanel === "comments"
                    ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
                title="Comments"
                style={{ writingMode: "vertical-rl" }}
              >
                Comments
                {pendingAnchor && (
                  <span className="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
