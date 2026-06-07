"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { PdfRecord } from "@/lib/db";

export default function WelcomePage() {
  const [favorites, setFavorites] = useState<PdfRecord[]>([]);
  const [recents, setRecents] = useState<PdfRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/pdfs?favorites=1").then(r => r.json()),
      fetch("/api/pdfs?recent=1").then(r => r.json()),
    ]).then(([favs, recs]) => {
      if (Array.isArray(favs)) setFavorites(favs);
      if (Array.isArray(recs)) setRecents(recs);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto w-full p-8 flex flex-col items-center">
        {/* Header */}
        <div className="flex flex-col items-center mb-10">
          <img src="/logo.png" alt="Nookly" className="h-30 w-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Welcome to Nookly</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Your AI-powered PDF reading companion
          </p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading...</div>
        ) : (
          <>
            {/* Favorites */}
            {favorites.length > 0 && (
              <section className="w-full mb-10">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Favorites
                </h2>
                <PdfCardGrid pdfs={favorites} />
              </section>
            )}

            {/* Recent sessions */}
            {recents.length > 0 && (
              <section className="w-full mb-10">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center justify-center gap-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Recent Sessions
                </h2>
                <PdfCardGrid pdfs={recents} />
              </section>
            )}

            {/* Empty state */}
            {favorites.length === 0 && recents.length === 0 && (
              <div className="text-center py-16">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                  <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">Get started</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                  Upload your first PDF to begin reading with AI
                </p>
                <Link href="/library" className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Go to Library
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PdfCardGrid({ pdfs }: { pdfs: PdfRecord[] }) {
  return (
    <div className="flex justify-center">
      <div className="flex flex-wrap justify-center gap-4">
        {pdfs.map((pdf) => (
          <Link key={pdf.id} href={`/pdf/${pdf.id}`}
            className="w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow group">
            <div className="flex items-start gap-3">
              <div className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded p-2 shrink-0">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm" title={pdf.original_name}>
                  {pdf.original_name}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {pdf.page_count > 0 ? `${pdf.page_count} pages` : "Processing..."}
                </p>
                {pdf.last_opened_at && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Opened {new Date(pdf.last_opened_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
