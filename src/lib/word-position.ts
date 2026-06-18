/**
 * Find the global word position of a text phrase within a transcript.
 *
 * When `segmentWordRange` is provided, the search is constrained to only
 * that segment's word range — preventing a word like "new" in segment 5
 * from matching an earlier "new" in segment 1.
 */
export function findWordPosition(
  fullWords: string[],
  text: string,
  segmentWordRange?: { startWord: number; endWord: number },
): { startWord: number; endWord: number } | null {
  if (!text || fullWords.length === 0) return null;
  const targetWords = text.split(/\s+/).filter((w) => w.length > 0);
  if (targetWords.length === 0) return null;

  const searchStart = segmentWordRange ? Math.max(0, segmentWordRange.startWord) : 0;
  const searchEnd = segmentWordRange
    ? Math.min(fullWords.length - 1, segmentWordRange.endWord)
    : fullWords.length - 1;

  // ── Exact match within constraint ──
  for (let i = searchStart; i <= searchEnd - targetWords.length + 1; i++) {
    let match = true;
    for (let j = 0; j < targetWords.length; j++) {
      if (
        fullWords[i + j].toLowerCase().replace(/[^a-z0-9]/g, "") !==
        targetWords[j].toLowerCase().replace(/[^a-z0-9]/g, "")
      ) {
        match = false;
        break;
      }
    }
    if (match) {
      return { startWord: i, endWord: i + targetWords.length - 1 };
    }
  }

  // ── Partial match: find first-word overlap within constraint ──
  const firstWord = targetWords[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  for (let i = searchStart; i <= searchEnd; i++) {
    if (fullWords[i].toLowerCase().replace(/[^a-z0-9]/g, "") === firstWord) {
      return { startWord: i, endWord: i + targetWords.length - 1 };
    }
  }

  return null;
}
