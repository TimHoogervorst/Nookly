"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type RecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "reviewing"
  | "uploading"
  | "error"
  | "unsupported";

interface Props {
  onUploadComplete: (recordingId: number) => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function AudioRecorder({ onUploadComplete }: Props) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const startRecording = useCallback(async () => {
    setErrorMsg("");
    setState("requesting");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMsg("Your browser does not support audio recording.");
      setState("unsupported");
      return;
    }

    if (!window.MediaRecorder) {
      setErrorMsg("Your browser does not support MediaRecorder.");
      setState("unsupported");
      return;
    }

    try {
      // Request mic with explicit constraints — disable processing that can cause issues
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Log audio track info for debugging
      const audioTrack = stream.getAudioTracks()[0];
      console.log("[AudioRecorder] Mic:", audioTrack?.label || "unknown");
      console.log("[AudioRecorder] Track settings:", audioTrack?.getSettings());

      // Set up Web Audio API for live waveform
      const audioCtx = new AudioContext();
      // Ensure AudioContext is running (Chrome may suspend it)
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      console.log("[AudioRecorder] AudioContext state:", audioCtx.state);
      audioCtxRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      // Detect best MIME type
      let mimeType = "audio/webm";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
        mimeType = "audio/ogg";
      }
      console.log("[AudioRecorder] MIME type:", mimeType);

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        console.log("[AudioRecorder] Chunk:", e.data.size, "bytes");
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        const totalDuration = Date.now() - startTimeRef.current;
        setDurationMs(totalDuration);
        const blob = new Blob(chunksRef.current, {
          type: mimeType.split(";")[0],
        });
        console.log(
          "[AudioRecorder] Stopped — chunks:",
          chunksRef.current.length,
          "total size:",
          blob.size,
          "bytes",
          "duration:",
          totalDuration,
          "ms"
        );
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        // Stop the stream
        stream.getTracks().forEach((t) => t.stop());
        if (audioCtx.state !== "closed") audioCtx.close().catch(() => {});
        // Detect empty recording
        if (blob.size < 100) {
          setErrorMsg(
            "No audio was captured. Check that your microphone is connected and selected as the default input device in Windows Sound Settings. The detected mic was: " +
              (audioTrack?.label || "unknown")
          );
          setState("error");
        } else {
          setState("reviewing");
        }
      };

      // Start
      recorder.start();
      startTimeRef.current = Date.now();
      setElapsed(0);
      setState("recording");

      // Timer
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);

      // Waveform animation
      drawWaveform();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errName =
        err instanceof DOMException ? err.name : "";

      if (
        errName === "SecurityError" ||
        msg.includes("secure") ||
        msg.includes("SecurityError")
      ) {
        // Non-HTTPS and non-localhost — browser blocks getUserMedia
        setErrorMsg(
          "Recording requires a secure connection (HTTPS). Please access this page via HTTPS or use localhost. Try running: npm run dev:https"
        );
      } else if (
        errName === "NotAllowedError" ||
        msg.includes("Permission") ||
        msg.includes("denied") ||
        msg.includes("NotAllowed")
      ) {
        setErrorMsg(
          "Microphone access was denied. Please allow microphone access in your browser settings and try again."
        );
      } else {
        setErrorMsg(`Failed to start recording: ${msg}`);
      }
      setState("error");
    }
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Gradient stroke
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#ef4444");
      gradient.addColorStop(0.5, "#a855f7");
      gradient.addColorStop(1, "#3b82f6");
      ctx.lineWidth = 2;
      ctx.strokeStyle = gradient;
      ctx.beginPath();

      const sliceWidth = width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    };
    draw();
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!blobUrl) return;
    setState("uploading");

    try {
      // Convert blob URL to actual blob
      const response = await fetch(blobUrl);
      const blob = await response.blob();

      const formData = new FormData();
      const ext = blob.type.includes("webm")
        ? "webm"
        : blob.type.includes("mp4")
        ? "mp4"
        : "webm";
      formData.append("file", blob, `recording_${Date.now()}.${ext}`);

      const res = await fetch("/api/recordings", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const recording = await res.json();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
      onUploadComplete(recording.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setErrorMsg(msg);
      setState("error");
    }
  }, [blobUrl, onUploadComplete]);

  const handleReRecord = useCallback(() => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setElapsed(0);
    setDurationMs(0);
    setErrorMsg("");
    startRecording();
  }, [startRecording]);

  const handleCancel = useCallback(() => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setElapsed(0);
    setDurationMs(0);
    setErrorMsg("");
    setState("idle");
  }, []);

  // Audio element for review playback
  const audioElement =
    state === "reviewing" && blobUrl ? (
      <audio ref={audioRef} src={blobUrl} controls className="w-full max-w-md" />
    ) : null;

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12">
      {/* Idle state */}
      {state === "idle" && (
        <>
          <button
            onClick={startRecording}
            className="w-24 h-24 rounded-full bg-red-500 hover:bg-red-600 transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-lg shadow-red-500/30"
            aria-label="Start recording"
          >
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3z" />
              <path d="M17 11a1 1 0 012 0 7 7 0 01-6 6.93V20h2a1 1 0 010 2H9a1 1 0 010-2h2v-2.07A7 7 0 015 11a1 1 0 012 0 5 5 0 0010 0z" />
            </svg>
          </button>
          <p className="text-gray-600 dark:text-gray-400 text-lg font-medium">
            Tap to Record
          </p>
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            Works on desktop and mobile browsers
          </p>
        </>
      )}

      {/* Requesting permission */}
      {state === "requesting" && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 dark:text-gray-400">Requesting microphone access...</p>
        </div>
      )}

      {/* Recording state */}
      {state === "recording" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          {/* Live waveform */}
          <canvas
            ref={canvasRef}
            width={400}
            height={120}
            className="w-full h-28 rounded-lg bg-gray-100 dark:bg-gray-800"
          />

          {/* Timer and indicator */}
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-3xl font-mono font-bold text-gray-800 dark:text-gray-200 tabular-nums">
              {formatTime(elapsed)}
            </span>
          </div>

          {/* Stop button */}
          <button
            onClick={stopRecording}
            className="w-16 h-16 rounded-lg bg-red-500 hover:bg-red-600 transition-all flex items-center justify-center shadow-lg"
            aria-label="Stop recording"
          >
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        </div>
      )}

      {/* Review state */}
      {state === "reviewing" && (
        <div className="flex flex-col items-center gap-6 w-full max-w-md">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            Recording complete
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Duration: {formatTime(durationMs)}
          </p>

          {audioElement}

          <div className="flex gap-3 w-full">
            <button
              onClick={handleReRecord}
              className="flex-1 py-3 px-4 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Re-record
            </button>
            <button
              onClick={handleUpload}
              className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Upload & Transcribe
            </button>
          </div>

          <button
            onClick={handleCancel}
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Discard
          </button>
        </div>
      )}

      {/* Uploading state */}
      {state === "uploading" && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 dark:text-gray-400 font-medium">Uploading recording...</p>
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            Transcription will begin automatically
          </p>
        </div>
      )}

      {/* Error state */}
      {(state === "error" || state === "unsupported") && (
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-red-600 dark:text-red-400 font-medium">
            {errorMsg || "An error occurred"}
          </p>
          <button
            onClick={handleCancel}
            className="py-2 px-6 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
