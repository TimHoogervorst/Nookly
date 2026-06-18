# ADR-0001: Split the data monolith

**Date:** 2026-06-18
**Status:** Accepted

## Context

`src/lib/db.ts` (1037 lines) holds schema definition, migrations, and CRUD for 12 entities — pdfs, tags, chunks, comments, highlights, chat sessions, chat messages, settings, users, sessions, recordings, and recording segments — in a single module exporting 60+ functions. The interface is nearly as wide as the implementation. Every API route imports from one file; understanding any entity's data access requires navigating past 900 lines of unrelated SQL. Zero tests exist, and the monolithic structure makes in-memory SQLite testing impractical.

## Decision

Split `db.ts` into six entity modules, each with a small interface (5–14 exports) hiding SQL behind it:

| Module | Entities | Exports |
|---|---|---|
| `pdfs.ts` | pdfs, pdf_chunks, pdf_tags | ~12 |
| `recordings.ts` | recordings, recording_segments, recording_tags | ~14 |
| `annotations.ts` | comments, highlights | ~10 |
| `chat.ts` | chat_sessions, chat_messages | ~6 |
| `users.ts` | users, sessions, settings | ~8 |
| `tags.ts` | tags (shared vocabulary) | ~5 |

### Schema ownership

`db-core.ts` retains the schema definition (`initSchema()`) and all cross-entity migrations. Entity modules assume the schema exists when they query it. Schema is a cross-cutting concern; distributing it across modules risks migration ordering bugs across foreign key relationships.

### Database access

Entity modules import `getDb()` from `db-core.ts`. A `setDbForTesting(db)` escape hatch allows tests to swap in a `:memory:` database before importing entity modules. Production call sites remain clean — no database threading required.

### Migration path

1. **First:** extract `tags.ts` (smallest module, fewest call sites) to establish the pattern
2. Extract remaining modules in any order
3. All existing call sites are renamed in the same PR — no re-export facade
4. Legacy polymorphic overloads (`pdfId`-first signatures on `getComments`, `insertComment`, `listSessions`, `createSession`, `getHighlights`, `insertHighlight`) are dropped during the move; only `(targetType, targetId, ...)` signatures are exported from the new modules

## Consequences

- **Locality:** a bug in comment queries means opening `annotations.ts` (~100 lines), not `db.ts` (1037 lines)
- **Leverage:** each API route imports only the entity modules it needs (~5 exports) instead of a 60+ export surface
- **Testability:** each entity module is independently testable with an in-memory SQLite adapter; `setDbForTesting` is the single test seam
- **Pattern:** new entities get their own module file or slot into the nearest existing group; future additions (bookmarks, reactions) would join `annotations.ts`
