# ADR-0002: RAG orchestration lives in rag.ts

**Date:** 2026-06-18
**Status:** Accepted

## Context

The chat API route (`src/app/api/chat/route.ts`) held 80 lines of RAG orchestration — fetching chunks/segments, generating embeddings, scoring similarity, sorting, slicing, and building context — duplicated for PDF and recording paths. The utility functions (`generateEmbedding`, `cosineSimilarity`, `buildContext`) already lived in `src/lib/rag.ts`, but the orchestration was inlined in the route handler, making it untestable and invisible to future consumers.

## Decision

Add a single `retrieveContext` export to `src/lib/rag.ts`:

```typescript
export async function retrieveContext(
  targetType: "pdf" | "recording",
  targetId: number,
  query: string
): Promise<string>
```

It dispatches to the correct entity module (pdfs or recordings), generates a query embedding, scores chunks/segments by cosine similarity, takes the top 8, and returns a pre-built context string ready for prompt injection. Falls back to un-embedded chunks when no embeddings exist.

The utility functions (`generateEmbedding`, `cosineSimilarity`, `buildContext`, `splitIntoChunks`) remain exported — they are called independently by upload/processing routes for chunk indexing, not just by `retrieveContext`.

## Consequences

- **Chat route handler** drops from ~285 lines to ~200; RAG is a one-line call
- **Future search/QA endpoints** discover `retrieveContext` by reading `rag.ts`
- **`generateEmbedding`** remains public — 5 call sites outside rag.ts (pdf upload, recording processing, retry flows) justify its export
