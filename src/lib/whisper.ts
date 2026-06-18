import { getSetting } from "./users";

export interface TranscriptionResult {
  text: string;
  segments: { start: number; end: number; text: string }[];
}

/**
 * Transcribe audio via an OpenAI-compatible Whisper API.
 * Supports verbose_json for timestamped segments, with a plain-text fallback.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<TranscriptionResult> {
  // Resolve transcription settings
  const model = getSetting("transcription_model") || "whisper-1";
  const apiKey = getSetting("transcription_api_key") || getSetting("api_key");
  let endpoint = getSetting("transcription_endpoint");

  if (!endpoint) {
    // Derive from chat endpoint: strip /chat/completions, append /audio/transcriptions
    const chatEndpoint = getSetting("endpoint") || "";
    endpoint = chatEndpoint.replace(/\/chat\/completions\/?$/, "/audio/transcriptions");
    if (!endpoint.endsWith("/audio/transcriptions")) {
      endpoint = chatEndpoint.replace(/\/+$/, "") + "/audio/transcriptions";
    }
  }

  if (!endpoint) {
    throw new Error(
      "No transcription endpoint configured. Set the chat endpoint or transcription endpoint in Settings."
    );
  }

  if (!apiKey) {
    throw new Error(
      "No API key configured for transcription. Set the API key in Settings."
    );
  }

  // Detect MIME type from filename extension
  const ext = filename.toLowerCase().split(".").pop();
  const mimeMap: Record<string, string> = {
    webm: "audio/webm",
    mp4: "audio/mp4",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
  };
  const mimeType = mimeMap[ext || ""] || "audio/webm";

  // Build FormData
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  formData.append("file", blob, filename);
  formData.append("model", model);
  formData.append("response_format", "verbose_json");

  // First attempt: verbose_json for timestamped segments
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Whisper API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.segments && Array.isArray(data.segments)) {
      return {
        text: data.text || "",
        segments: data.segments.map(
          (seg: { start: number; end: number; text: string }) => ({
            start: seg.start,
            end: seg.end,
            text: seg.text.trim(),
          })
        ),
      };
    }

    // Plain text response (no segments) — split by sentence boundaries
    const fullText = data.text || "";
    const sentences = fullText.split(/(?<=[.!?])\s+/);
    const avgDuration = 5; // seconds per segment as fallback
    return {
      text: fullText,
      segments: sentences
        .filter((s: string) => s.trim())
        .map((s: string, i: number) => ({
          start: i * avgDuration,
          end: (i + 1) * avgDuration,
          text: s.trim(),
        })),
    };
  } catch (err) {
    // If verbose_json wasn't supported, try plain text response
    if (
      err instanceof Error &&
      err.message.includes("verbose_json")
    ) {
      formData.delete("response_format");
      formData.append("response_format", "text");

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error ${response.status}: ${errorText}`);
      }

      const fullText = await response.text();
      const sentences = fullText.split(/(?<=[.!?])\s+/);
      const avgDuration = 5;
      return {
        text: fullText.trim(),
        segments: sentences
          .filter((s: string) => s.trim())
          .map((s: string, i: number) => ({
            start: i * avgDuration,
            end: (i + 1) * avgDuration,
            text: s.trim(),
          })),
      };
    }
    throw err;
  }
}
