# Ubiquitous Language

## Documents & Media

| Term             | Definition                                                                 | Aliases to avoid                     |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| **PDF**          | A user-uploaded PDF file with extracted text, page count, and metadata     | pdf, file, document (ambiguous)      |
| **Recording**    | A user-uploaded or in-browser-recorded audio memo with transcription       | recording, audio, voice memo, file   |
| **Document**     | Informal umbrella term for a **PDF** or **Recording** (no concrete type)   | item, resource, asset                |

## Annotation & Markup

| Term                | Definition                                                                          | Aliases to avoid                        |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| **Comment**         | A user-written note anchored to a position or text selection in a document          | annotation, note, sticky note           |
| **Highlight**       | A colored overlay on selected text within a document                                | markup, selection highlight             |
| **Text Anchor**     | Anchoring method that binds a comment or highlight to a specific text selection       | text selection, text range              |
| **Position Anchor** | Anchoring method that binds a comment to an (x, y) coordinate on a page             | point anchor, sticky note anchor        |
| **Anchor Data**     | The serialized payload describing how an annotation attaches to content             | anchor, anchor payload                  |
| **Word Position**   | Integer offset into a document's word array, used for cross-segment annotation spans | start_word/end_word, word index         |
| **Page Number**     | A 1-based page index within a **PDF**                                               | page, page index                        |
| **Segment Index**   | A 0-based index into the grouped sentence blocks of a **Recording** transcript      | segment, block index — do NOT use "page number" for recordings |

## AI & Chat

| Term               | Definition                                                                          | Aliases to avoid                     |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------ |
| **Chat Session**   | A conversation thread scoped to a single **Document**                               | chat, conversation, thread           |
| **Chat Message**   | An individual message within a **Chat Session** (role: user, assistant, or system)  | message, turn, response              |
| **Skill**          | A predefined AI interaction mode with a tailored system prompt (e.g. Summarize)     | prompt preset, AI mode               |
| **Quick Action**   | A canned chat button that invokes a **Skill** with a pre-written message            | shortcut, quick prompt               |
| **RAG**            | Retrieval-Augmented Generation: embedding a query, retrieving relevant chunks, and injecting them into the LLM prompt | context injection, semantic search   |
| **Embedding**      | A vector representation of text used for semantic similarity search                 | vector, text embedding               |
| **Chunk**          | A ~800-character fragment of extracted text, split at sentence boundaries           | text chunk, PDF chunk                |
| **Streaming**      | Server-Sent Events protocol delivering LLM tokens in real time                      | SSE, real-time response              |

## Processing

| Term                      | Definition                                                                          | Aliases to avoid                     |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| **Transcription**         | The process of converting **Recording** audio to text via a Whisper-compatible API  | speech-to-text, STT                  |
| **Transcript**            | The full textual output of **Transcription**                                        | transcription text, full text        |
| **Raw Segment**           | A single timestamped utterance from the Whisper API, before sentence grouping       | segment, utterance                   |
| **Recording Segment**     | A group of **Raw Segments** combined by sentence count, displayed as a paragraph    | segment, sentence block              |
| **Sentences Per Block**   | User-adjustable parameter controlling how many sentences form one **Recording Segment** | grouping size, block size            |
| **Background Processing** | Asynchronous text extraction, transcription, chunking, and embedding after upload   | async processing, post-upload work   |

## Organization

| Term                | Definition                                                                          | Aliases to avoid                     |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| **Library**         | The unified browsing page listing all user **Documents**                            | dashboard, documents page            |
| **Library Item**    | A **PDF** or **Recording** displayed in the **Library** grid                        | item, entry, document card           |
| **Tag**             | A user-defined label with a name and color, attachable to any **Document**          | label, category                      |
| **Favorite**        | A boolean flag marking a **Document** for quick access                              | starred, bookmarked, pinned          |
| **Recent Session**  | A **Document** the user last opened, tracked by last-opened timestamp               | recent, history entry                |

## People & Auth

| Term                | Definition                                                                          | Aliases to avoid                     |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| **User**            | A person authenticated to use the system, with a username and password              | account, login                       |
| **Auth Session**    | A token (httpOnly cookie) linking a browser to an authenticated **User**            | session, auth token, cookie session  |
| **Registration**    | First-run account creation; only allowed when no **Users** exist                    | sign-up, setup, first-run setup      |
| **Admin Seeding**   | Automatic creation of an admin **User** from environment variables on first launch  | auto-admin, env admin                |

## Configuration

| Term                         | Definition                                                                          | Aliases to avoid                     |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| **LLM Endpoint**             | The base URL for the OpenAI-compatible chat completion API                          | chat endpoint, API URL               |
| **Chat Model**               | The model name used for chat completions (default: gpt-3.5-turbo)                   | model, LLM model                     |
| **Embedding Endpoint**       | The base URL for the embeddings API (falls back to **LLM Endpoint** + /embeddings)  | vector endpoint                      |
| **Embedding Model**          | The model name used for generating **Embeddings** (default: text-embedding-ada-002) | vector model                         |
| **Transcription Endpoint**   | The base URL for the Whisper-compatible audio transcription API                     | STT endpoint, Whisper endpoint       |
| **Transcription Model**      | The model name used for **Transcription** (default: whisper-1)                      | STT model, Whisper model             |
| **API Key**                  | The authentication token for the LLM API; may also serve as fallback for other services | auth token, secret, LLM key          |

## Relationships

- A **User** uploads many **PDFs** and **Recordings**
- A **PDF** has many **Chunks**; a **Recording** has many **Raw Segments** and **Recording Segments**
- A **Comment** or **Highlight** belongs to one **Document** (polymorphic via target_type/target_id) and uses either a **Text Anchor** or **Position Anchor**
- A **Chat Session** belongs to one **Document** and contains many **Chat Messages**
- A **Tag** can be attached to many **Documents**; a **Document** can have many **Tags**
- **Transcription** of a **Recording** produces **Raw Segments**, which are grouped into **Recording Segments** based on **Sentences Per Block**
- **RAG** uses **Embeddings** of **Chunks** and **Recording Segments** to retrieve context for **Chat Messages**

## Example dialogue

> **Dev:** "When a user highlights text in a **PDF** and leaves a **Comment**, what anchoring method do we use?"

> **Domain expert:** "That's a **Text Anchor**. The **Anchor Data** stores the bounding rects and the selected text so we can render the comment icon in the right spot. If they just click on the page without selecting text, it's a **Position Anchor** — just an x,y coordinate."

> **Dev:** "Got it. And what about **Recordings**? Do we use **Page Number** for those?"

> **Domain expert:** "No — use **Segment Index**. The database column is unfortunately named `page_number` for both, but for **Recordings** it stores the index into the **Recording Segments** array, not a page."

> **Dev:** "So a **Comment** on a **Recording** uses a **Text Anchor** with start_word and end_word that can span multiple **Recording Segments**?"

> **Domain expert:** "Exactly. The **Word Positions** are absolute offsets into the full transcript word array, so a highlight can cross **Recording Segment** boundaries even when the user changes **Sentences Per Block**."

> **Dev:** "And **RAG** — does that use **Chunks** or **Recording Segments**?"

> **Domain expert:** "Both. For **PDFs**, **RAG** retrieves **Chunks**. For **Recordings**, it retrieves **Recording Segments**. They're stored in separate tables but the retrieval logic treats them as the same thing: text with an **Embedding**."

## Flagged ambiguities

- **"page_number" is overloaded** — the database column `page_number` stores a PDF page number for PDFs but a segment index for recordings. Use **Page Number** only for PDFs and **Segment Index** for recordings. The API still accepts `page_number` for both; new code should prefer the domain-correct term.

- **"segment" is overloaded** — **Raw Segment** (a single Whisper utterance) and **Recording Segment** (a grouped block of sentences) are distinct concepts that share the word "segment." Always qualify which one you mean.

- **"document" has no concrete type** — the codebase uses "document" informally to mean "a PDF or Recording," but there is no `Document` interface or table. When precision matters, say **PDF** or **Recording** explicitly.

- **"pdf_id" is a deprecated parameter** — several API endpoints still accept `pdf_id` as a fallback for the newer `target_type`/`target_id` polymorphic pair. New code should use **target_type** and **target_id** exclusively.

- **"pdfai" appears in internal filenames** — the database file (`pdfai.db`), localStorage keys, and Docker volumes use "pdfai," a leftover from the project's original name. The product is now **Nookly**. These internal names have no bearing on domain language but may confuse newcomers.

- **"is_favorite" uses integer storage** — despite being a boolean concept, it is stored as `INTEGER 0/1` and toggled via `1 - is_favorite`. Treat it as a boolean in domain discussions.
