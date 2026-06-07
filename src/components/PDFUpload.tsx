"use client";

import { useCallback, useRef, useState, useEffect } from "react";

interface Props {
  onUpload: (file: File) => Promise<void>;
  onUploadUrl?: (url: string) => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

export default function PDFUpload({ onUpload, onUploadUrl, disabled, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [open, setOpen] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");
  const [urlUploading, setUrlUploading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setUrlMode(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) return;
      await onUpload(file);
      if (inputRef.current) inputRef.current.value = "";
      setOpen(false);
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleUrlSubmit = async () => {
    if (!url.trim() || !onUploadUrl) return;
    setUrlUploading(true);
    try {
      await onUploadUrl(url.trim());
      setUrl("");
      setUrlMode(false);
      setOpen(false);
    } catch (err) {
      console.error("URL upload failed:", err);
    } finally {
      setUrlUploading(false);
    }
  };

  // ── Compact: + button with dropdown ──────────
  if (compact) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          disabled={disabled}
          className={`inline-flex items-center justify-center w-9 h-9 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title="Add PDF"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
            {!urlMode ? (
              <>
                {/* Upload file */}
                <label className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload file
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleChange}
                    disabled={disabled}
                    className="hidden"
                  />
                </label>

                {/* Upload from URL */}
                {onUploadUrl && (
                  <button
                    onClick={() => setUrlMode(true)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Upload from URL
                  </button>
                )}
              </>
            ) : (
              <div className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => setUrlMode(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Paste PDF URL</span>
                </div>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
                  placeholder="https://example.com/doc.pdf"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                  autoFocus
                />
                <button
                  onClick={handleUrlSubmit}
                  disabled={!url.trim() || urlUploading}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {urlUploading ? "Downloading..." : "Download PDF"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Full: drag-and-drop (welcome page) ───────
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-12 transition-colors ${
        dragOver
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/10"
          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <div className="flex flex-col items-center gap-3">
        <svg
          className={`w-12 h-12 ${dragOver ? "text-blue-500" : "text-gray-400"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        <p className="text-gray-600 dark:text-gray-300 font-medium">
          {dragOver ? "Drop your PDF here" : "Drag and drop your PDF here"}
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500">or</p>
        <label
          className={`px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 cursor-pointer transition-colors ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {disabled ? "Uploading..." : "Browse Files"}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            onChange={handleChange}
            disabled={disabled}
            className="hidden"
          />
        </label>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Only PDF files are accepted</p>
      </div>
    </div>
  );
}
