// Small text helpers. Pure.

export interface TextSegment {
  text: string;
  nowrap: boolean;
}

// A number range: "10-18", "10–18", "10:00-18:00" (optionally with spaces around the dash).
const RANGE = /\d+(?::\d\d)?\s*[-–]\s*\d+(?::\d\d)?/g;

/** No-break spaces where a line break reads badly: a number stays with the word before it ("Dalshraun 10") and a
 *  spaced dash with the word before it, so a wrapped line never starts with "10 …" or "- ". */
export function glueBreaks(text: string): string {
  // The dash rule runs first (it needs both plain spaces); the number rule uses a lookahead so a run like "1 2 3"
  // doesn't consume the digit the next match starts from.
  return text.replace(/ ([-–]) /g, '\u00a0$1 ').replace(/(\S) (?=\d)/g, '$1\u00a0');
}

/** Splits text into segments, marking number ranges as `nowrap` so a narrow line can't break "10-18" after the dash. */
export function nowrapRanges(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(RANGE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), nowrap: false });
    out.push({ text: m[0], nowrap: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), nowrap: false });
  return out;
}

/** First `n` words + "..." — how live's Goya product cards shorten titles ("Nike Vomero Plus..."). Kept on purpose:
 *  the storefront now shows full names clamped to two lines in CSS, but this documents and tests live's rule. */
export function truncateWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > n ? `${words.slice(0, n).join(' ')}...` : words.join(' ');
}
