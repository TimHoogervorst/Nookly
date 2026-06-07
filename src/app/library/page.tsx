"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import PDFUpload from "@/components/PDFUpload";
import type { PdfRecord, Tag } from "@/lib/db";

const TAG_COLORS = [
  "#012B67", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
];

interface DeleteTagModal {
  tag: Tag;
  affectedCount: number;
}

export default function LibraryPage() {
  const [pdfs, setPdfs] = useState<(PdfRecord & { tags?: Tag[] })[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Tag creation
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);

  // Tag popover state
  const [openTagPopover, setOpenTagPopover] = useState<number | null>(null);
  const [openOverflowId, setOpenOverflowId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Close overflow on outside click
  useEffect(() => {
    if (openOverflowId === null) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOpenOverflowId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openOverflowId]);

  // Delete tag modal
  const [deleteModal, setDeleteModal] = useState<DeleteTagModal | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null);

  useEffect(() => { fetchData(); }, [selectedTagId]);

  // Close popover on outside click
  useEffect(() => {
    if (openTagPopover === null) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenTagPopover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTagPopover]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const url = selectedTagId ? `/api/pdfs?tag_id=${selectedTagId}` : "/api/pdfs";
      const [pdfsRes, tagsRes] = await Promise.all([fetch(url), fetch("/api/tags")]);
      if (pdfsRes.ok) {
        const pdfData = await pdfsRes.json();
        const pdfsWithTags = await Promise.all(
          pdfData.map(async (pdf: PdfRecord) => {
            try {
              const tRes = await fetch(`/api/pdfs/${pdf.id}/tags`);
              if (tRes.ok) return { ...pdf, tags: await tRes.json() };
            } catch {}
            return { ...pdf, tags: [] };
          })
        );
        setPdfs(pdfsWithTags);
      }
      if (tagsRes.ok) setTags(await tagsRes.json());
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await fetch("/api/pdfs", { method: "POST", body: formData });
      await fetchData();
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleUploadUrl = async (url: string) => {
    setUploading(true);
    try {
      const res = await fetch("/api/pdfs/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "URL upload failed");
      }
      await fetchData();
    } catch (err) {
      console.error("URL upload failed:", err);
      alert(err instanceof Error ? err.message : "Failed to download PDF from URL");
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePdf = async (id: number) => {
    if (!confirm("Delete this PDF and all its comments and chats?")) return;
    try {
      await fetch(`/api/pdfs/${id}`, { method: "DELETE" });
      setPdfs((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      if (res.ok) {
        setNewTagName("");
        setShowTagInput(false);
        await fetchData();
      }
    } catch (err) {
      console.error("Failed to create tag:", err);
    }
  };

  // ── Delete tag flow ──────────────────────────────

  const handleDeleteTagClick = (tag: Tag) => {
    // Count how many PDFs have this tag
    const affected = pdfs.filter((p) => (p.tags || []).some((t) => t.id === tag.id));
    if (affected.length > 0) {
      setDeleteModal({ tag, affectedCount: affected.length });
      setMoveTargetId(null);
    } else {
      // No PDFs affected, just delete
      executeDeleteTag(tag.id);
    }
  };

  const executeDeleteTag = async (tagId: number) => {
    try {
      await fetch(`/api/tags/${tagId}`, { method: "DELETE" });
      if (selectedTagId === tagId) setSelectedTagId(null);
      await fetchData();
    } catch (err) {
      console.error("Failed to delete tag:", err);
    }
    setDeleteModal(null);
  };

  const handleDeleteAndRemove = async () => {
    if (!deleteModal) return;
    // Just delete the tag — cascade will remove from pdf_tags
    await executeDeleteTag(deleteModal.tag.id);
  };

  const handleDeleteAndMove = async () => {
    if (!deleteModal || !moveTargetId) return;

    const targetTag = tags.find((t) => t.id === moveTargetId);
    if (!targetTag) return;

    // For each PDF that has the old tag, replace it with the new tag
    const affected = pdfs.filter((p) => (p.tags || []).some((t) => t.id === deleteModal.tag.id));
    for (const pdf of affected) {
      const currentIds = (pdf.tags || []).map((t) => t.id);
      const newIds = currentIds
        .filter((id) => id !== deleteModal.tag.id) // remove old tag
        .concat(moveTargetId); // add new tag
      // Deduplicate
      const unique = [...new Set(newIds)];
      try {
        await fetch(`/api/pdfs/${pdf.id}/tags`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_ids: unique }),
        });
      } catch (err) {
        console.error(`Failed to move tags for PDF ${pdf.id}:`, err);
      }
    }

    // Now delete the old tag
    await executeDeleteTag(deleteModal.tag.id);
  };

  // ── Tag toggle on PDF cards ──────────────────────

  const handleToggleTag = async (pdfId: number, tagId: number, currentTags: Tag[]) => {
    const hasTag = currentTags.some((t) => t.id === tagId);
    const newTagIds = hasTag
      ? currentTags.filter((t) => t.id !== tagId).map((t) => t.id)
      : [...currentTags.map((t) => t.id), tagId];
    try {
      await fetch(`/api/pdfs/${pdfId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_ids: newTagIds }),
      });
      setPdfs((prev) =>
        prev.map((p) => {
          if (p.id !== pdfId) return p;
          const updatedTags = hasTag
            ? (p.tags || []).filter((t) => t.id !== tagId)
            : [...(p.tags || []), tags.find((t) => t.id === tagId)!].filter(Boolean);
          return { ...p, tags: updatedTags };
        })
      );
    } catch (err) {
      console.error("Failed to toggle tag:", err);
    }
  };

  return (
    <div className="flex-1 p-6 max-w-6xl mx-auto w-full overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">PDF Library</h1>
        <PDFUpload onUpload={handleUpload} onUploadUrl={handleUploadUrl} disabled={uploading} compact />
      </div>

      {/* ── Tag bar ────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setSelectedTagId(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            selectedTagId === null
              ? "bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800"
              : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          All
        </button>

        {tags.map((tag) => (
          <div key={tag.id} className="flex items-center group/tag">
            <button
              onClick={() => setSelectedTagId(selectedTagId === tag.id ? null : tag.id)}
              className="px-3 py-1.5 rounded-l-full text-xs font-medium transition-colors flex items-center gap-1.5"
              style={{
                backgroundColor: selectedTagId === tag.id ? tag.color : `${tag.color}18`,
                color: selectedTagId === tag.id ? "#fff" : tag.color,
                borderTop: `1px solid ${tag.color}40`,
                borderBottom: `1px solid ${tag.color}40`,
                borderLeft: `1px solid ${tag.color}40`,
              }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteTagClick(tag);
              }}
              className="px-2 py-1.5 rounded-r-full text-xs transition-colors flex items-center"
              style={{
                backgroundColor: `${tag.color}18`,
                color: `${tag.color}99`,
                borderTop: `1px solid ${tag.color}40`,
                borderBottom: `1px solid ${tag.color}40`,
                borderRight: `1px solid ${tag.color}40`,
              }}
              title="Delete tag"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}

        {showTagInput ? (
          <div className="flex items-center gap-1">
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
              placeholder="Tag name..."
              className="w-24 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex gap-0.5">
              {TAG_COLORS.slice(0, 5).map((c) => (
                <button
                  key={c}
                  onClick={() => setNewTagColor(c)}
                  className="w-4 h-4 rounded-full border-2 transition-colors"
                  style={{
                    backgroundColor: c,
                    borderColor: newTagColor === c ? "#000" : "transparent",
                  }}
                />
              ))}
            </div>
            <button onClick={handleCreateTag} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
            <button onClick={() => setShowTagInput(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>
        ) : (
          <button
            onClick={() => setShowTagInput(true)}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            + New Tag
          </button>
        )}
      </div>

      {/* ── Delete tag modal ────────────────────────── */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDeleteModal(null)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${deleteModal.tag.color}20` }}
              >
                <svg
                  className="w-5 h-5"
                  style={{ color: deleteModal.tag.color }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  Delete &quot;{deleteModal.tag.name}&quot;?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  This tag is used by{" "}
                  <strong className="text-gray-700 dark:text-gray-300">
                    {deleteModal.affectedCount} PDF{deleteModal.affectedCount > 1 ? "s" : ""}
                  </strong>
                  . What would you like to do?
                </p>
              </div>
            </div>

            {/* Option 1: Remove from all */}
            <button
              onClick={handleDeleteAndRemove}
              className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 mb-2 transition-colors"
            >
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                Remove label from all PDFs
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                The tag will be deleted. PDFs keep their other tags unchanged.
              </p>
            </button>

            {/* Option 2: Move to another tag */}
            <div className="px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 mb-4">
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                Move labeled PDFs to a new tag
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
                Replace this tag with another existing tag on all affected PDFs.
              </p>

              <select
                value={moveTargetId || ""}
                onChange={(e) => setMoveTargetId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a tag...</option>
                {tags
                  .filter((t) => t.id !== deleteModal.tag.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>

              <button
                onClick={handleDeleteAndMove}
                disabled={!moveTargetId}
                className="mt-3 w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Move & Delete Tag
              </button>
            </div>

            {/* Cancel */}
            <button
              onClick={() => setDeleteModal(null)}
              className="w-full py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── PDF grid ───────────────────────────────── */}
      {loading ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-12">Loading...</div>
      ) : pdfs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400 mb-4">No PDFs found.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">Upload a PDF to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pdfs.map((pdf) => (
            <div
              key={pdf.id}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow group"
            >
              <Link href={`/pdf/${pdf.id}`}>
                <div className="flex items-start gap-3">
                  <div className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded p-2 shrink-0">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    {renamingId === pdf.id ? (
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            fetch(`/api/pdfs/${pdf.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ name: renameValue.trim() || pdf.original_name }),
                            })
                              .then(() => {
                                setPdfs((prev) =>
                                  prev.map((p) => (p.id === pdf.id ? { ...p, original_name: renameValue.trim() || pdf.original_name } : p))
                                );
                                setRenamingId(null);
                              })
                              .catch(console.error);
                          }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={() => setRenamingId(null)}
                        className="w-full text-sm font-medium px-1 py-0.5 border border-blue-400 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                        onClick={(e) => e.preventDefault()}
                      />
                    ) : (
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate" title={pdf.original_name}>
                        {pdf.original_name}
                      </h3>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {pdf.page_count > 0 ? `${pdf.page_count} pages` : "Processing..."}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {new Date(pdf.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </Link>

              {/* Bottom: overflow menu + tags */}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-1">
                {/* Star favorite */}
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      const res = await fetch(`/api/pdfs/${pdf.id}/favorite`, { method: "PUT" });
                      if (res.ok) {
                        const updated = await res.json();
                        setPdfs(prev => prev.map(p => p.id === pdf.id ? { ...p, is_favorite: updated.is_favorite } : p));
                      }
                    } catch {}
                  }}
                  className={`p-1 transition-colors ${pdf.is_favorite ? "text-yellow-500" : "text-gray-300 dark:text-gray-600 hover:text-yellow-400"}`}
                  title={pdf.is_favorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <svg className="w-4 h-4" fill={pdf.is_favorite ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </button>

                {/* Three-dot overflow menu */}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenOverflowId(openOverflowId === pdf.id ? null : pdf.id);
                    }}
                    className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 opacity-0 group-hover:opacity-100 transition-all"
                    title="More actions"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>

                  {openOverflowId === pdf.id && (
                    <div
                      ref={overflowRef}
                      className="absolute bottom-8 left-0 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1"
                    >
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setOpenOverflowId(null);
                          setRenamingId(pdf.id);
                          setRenameValue(pdf.original_name);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setOpenOverflowId(null);
                          handleDeletePdf(pdf.id);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                </div>

                {/* Tag button + popover */}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenTagPopover(openTagPopover === pdf.id ? null : pdf.id);
                    }}
                    className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    title="Manage tags"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    {(pdf.tags?.length || 0) > 0 && (
                      <span className="text-[10px]">{pdf.tags!.length}</span>
                    )}
                  </button>

                  {(pdf.tags?.length || 0) > 0 && (
                    <div className="flex gap-0.5 mt-1">
                      {pdf.tags!.map((t) => (
                        <span
                          key={t.id}
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: t.color }}
                          title={t.name}
                        />
                      ))}
                    </div>
                  )}

                  {openTagPopover === pdf.id && (
                    <div
                      ref={popoverRef}
                      className="absolute bottom-full right-0 mb-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 p-2"
                    >
                      <p className="text-[10px] uppercase text-gray-400 dark:text-gray-500 font-medium px-2 mb-1">Tags</p>
                      {tags.length === 0 ? (
                        <p className="text-xs text-gray-400 px-2 py-1">No tags yet. Create one above.</p>
                      ) : (
                        tags.map((tag) => {
                          const isActive = (pdf.tags || []).some((t) => t.id === tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={(e) => { e.preventDefault(); handleToggleTag(pdf.id, tag.id, pdf.tags || []); }}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                              <span className="flex-1 text-left text-gray-700 dark:text-gray-300">{tag.name}</span>
                              {isActive && (
                                <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
