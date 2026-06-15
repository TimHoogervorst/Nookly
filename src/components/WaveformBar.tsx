"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface SegmentMarker {
  segment_index: number;
  start_time: number;
  end_time: number;
}

interface Props {
  audioUrl: string;
  currentTime: number;
  duration: number;
  segments: SegmentMarker[];
  onSeek: (time: number) => void;
}

export default function WaveformBar({
  audioUrl,
  currentTime,
  duration,
  segments,
  onSeek,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [amplitudes, setAmplitudes] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function computeWaveform() {
      try {
        setLoading(true);
        const audioCtx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)();
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        await audioCtx.close();

        if (cancelled) return;

        const rawData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const windowSamples = Math.floor(sampleRate * 0.05); // 50ms windows
        const amps: number[] = [];

        for (let i = 0; i < rawData.length; i += windowSamples) {
          let sum = 0;
          const end = Math.min(i + windowSamples, rawData.length);
          for (let j = i; j < end; j++) {
            sum += rawData[j] * rawData[j];
          }
          amps.push(Math.sqrt(sum / (end - i)));
        }

        // Normalize to [0, 1]
        const max = Math.max(...amps, 0.001);
        const normalized = amps.map((a) => a / max);
        if (!cancelled) {
          setAmplitudes(normalized);
          setLoading(false);
        }
      } catch (err) {
        console.error("Waveform computation failed:", err);
        if (!cancelled) setLoading(false);
      }
    }
    if (audioUrl) computeWaveform();
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      if (!container || duration <= 0) return;
      const rect = container.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      onSeek(Math.max(0, Math.min(ratio * duration, duration)));
    },
    [duration, onSeek]
  );

  const progressRatio = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="relative w-full h-14 bg-gray-100 dark:bg-gray-800 rounded-lg cursor-pointer overflow-hidden select-none flex-shrink-0"
      title="Click to seek"
    >
      {/* Bars */}
      {!loading && amplitudes.length > 0 && (
        <div className="absolute inset-0 flex items-end px-0.5">
          {amplitudes.map((amp, i) => (
            <div
              key={i}
              className="flex-1 mx-px rounded-t-sm transition-colors duration-75"
              style={{
                height: `${Math.max(amp * 100, 2)}%`,
                backgroundColor:
                  i / amplitudes.length <= progressRatio
                    ? "#3b82f6"
                    : "#9ca3af",
              }}
            />
          ))}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Playback position line */}
      {duration > 0 && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 shadow-sm pointer-events-none"
          style={{ left: `${progressRatio * 100}%` }}
        />
      )}

      {/* Segment boundary markers */}
      {segments.map((seg) => {
        const ratio = duration > 0 ? seg.start_time / duration : 0;
        if (ratio <= 0 || ratio >= 1) return null;
        return (
          <div
            key={`seg-${seg.segment_index}`}
            className="absolute top-0 bottom-0 w-px bg-white/60 dark:bg-white/30 pointer-events-none"
            style={{ left: `${ratio * 100}%` }}
          />
        );
      })}
    </div>
  );
}
