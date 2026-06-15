import { NextRequest } from "next/server";
import {
  getChunksForPdf,
  getSegmentsForRecording,
  insertMessage,
  createSession,
  getSetting,
  getMessages,
} from "@/lib/db";
import { generateEmbedding, cosineSimilarity, buildContext } from "@/lib/rag";
import { getSkill } from "@/lib/skills";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    let {
      target_type,
      target_id,
      pdf_id, // deprecated fallback
      session_id: existingSessionId,
      message,
      skill: skillId,
      extra,
    } = body;

    // Resolve target: prefer polymorphic, fall back to pdf_id
    if (!target_type && pdf_id !== undefined) {
      target_type = "pdf";
      target_id = pdf_id;
    }

    if (!target_type || target_id == null || !message) {
      return new Response(
        JSON.stringify({ error: "target_type, target_id, and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!["pdf", "recording"].includes(target_type)) {
      return new Response(
        JSON.stringify({ error: 'target_type must be "pdf" or "recording"' }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get or create session
    let sessionId = existingSessionId;
    if (!sessionId) {
      const session = createSession(target_type, target_id);
      sessionId = session.id;
    }

    // Save user message
    insertMessage(sessionId, "user", message);

    // ── RAG: Retrieve relevant chunks ──────────────
    let context = "";
    const label = target_type === "recording" ? "Segment" : "Page";

    if (target_type === "recording") {
      // Fetch recording segments instead of PDF chunks
      const segments = getSegmentsForRecording(target_id);
      const segmentItems = segments.map((seg) => ({
        text_content: seg.text,
        page_number: seg.segment_index,
        embedding: seg.embedding,
      }));

      const embeddedItems = segmentItems.filter((c) => c.embedding);
      const textItems = segmentItems.filter((c) => !c.embedding);

      if (embeddedItems.length > 0) {
        try {
          const queryEmbedding = await generateEmbedding(message);
          const scored = embeddedItems
            .map((item) => ({
              ...item,
              score: cosineSimilarity(queryEmbedding, JSON.parse(item.embedding!)),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
          context = buildContext(
            scored.map((c) => ({ text_content: c.text_content, page_number: c.page_number })),
            4000,
            label
          );
        } catch (err) {
          console.error("RAG retrieval error:", err);
        }
      }

      if (!context && textItems.length > 0) {
        context = buildContext(
          textItems.slice(0, 15).map((c) => ({
            text_content: c.text_content,
            page_number: c.page_number,
          })),
          4000,
          label
        );
      }
    } else {
      // PDF path (existing logic)
      const allChunks = getChunksForPdf(target_id);
      const embeddedChunks = allChunks.filter((c) => c.embedding);
      const textChunks = allChunks.filter((c) => !c.embedding);

      if (embeddedChunks.length > 0) {
        try {
          const queryEmbedding = await generateEmbedding(message);
          const scored = embeddedChunks
            .map((chunk) => ({
              ...chunk,
              score: cosineSimilarity(queryEmbedding, JSON.parse(chunk.embedding!)),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
          context = buildContext(
            scored.map((c) => ({ text_content: c.text_content, page_number: c.page_number }))
          );
        } catch (err) {
          console.error("RAG retrieval error:", err);
        }
      }

      if (!context && textChunks.length > 0) {
        context = buildContext(
          textChunks
            .slice(0, 15)
            .map((c) => ({ text_content: c.text_content, page_number: c.page_number }))
        );
      }
    }

    // ── Build system prompt ────────────────────────
    const skill = skillId ? getSkill(skillId) : undefined;
    const docType = target_type === "recording" ? "a voice recording transcript" : "a PDF document";
    let systemPrompt: string;

    if (context) {
      if (skill) {
        systemPrompt = skill.systemPrompt(context, extra);
      } else {
        systemPrompt = `You are a helpful assistant analyzing ${docType}. Use the following content to answer the user's question. Always reference the ${label.toLowerCase()} numbers shown in [${label} N] markers when citing information. If the answer isn't found in the provided content, clearly say so.\n\nContent:\n${context}`;
      }
    } else {
      if (target_type === "recording") {
        systemPrompt =
          "You are a helpful assistant. This recording is still being transcribed — its text isn't available yet. Let the user know the recording is still processing and they should wait a moment before retrying.";
      } else {
        systemPrompt =
          "You are a helpful assistant. This PDF is still being processed — its text hasn't been extracted yet. Let the user know the PDF is still processing and they should wait a moment before retrying.";
      }
    }

    // ── Get LLM config ─────────────────────────────
    const endpoint = getSetting("endpoint");
    const apiKey = getSetting("api_key");
    const model = getSetting("model") || "gpt-3.5-turbo";

    if (!endpoint || !apiKey) {
      // Fallback: return non-streaming error
      return new Response(
        JSON.stringify({
          session_id: sessionId,
          error: "LLM endpoint and API key must be configured in Settings.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build chat history from previous messages
    const history = getMessages(sessionId);

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    // ── Stream LLM response ────────────────────────
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("LLM API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ session_id: sessionId, error: `LLM error: ${response.status}` }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream back with SSE
    const encoder = new TextEncoder();
    let fullResponse = "";

    const stream = new ReadableStream({
      async start(controller) {
        // Send session_id as first event
        controller.enqueue(
          encoder.encode(`event: meta\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`)
        );

        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  // Save assistant message
                  if (fullResponse) {
                    insertMessage(sessionId, "assistant", fullResponse);
                  }
                  controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    fullResponse += content;
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                    );
                  }
                } catch {
                  // Skip unparseable chunks
                }
              }
            }
          }
        } catch (err) {
          console.error("Stream read error:", err);
          // Save partial response even on error
          if (fullResponse) {
            try {
              insertMessage(sessionId, "assistant", fullResponse);
            } catch {}
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: "Chat processing failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
