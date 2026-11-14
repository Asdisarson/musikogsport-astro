// The search field's live suggestions (SearchOverlay.astro, /api/search/suggest). Client-safe and pure.
//
// The products come from the product search itself (wp-mu-plugins/mos-search.php, through the Store API). The
// category and brand links are matched here against the catalog terms the storefront already holds, with that
// plugin's rules kept small: folded words, the stem without its ending, a word matched from its start or by its end.
import { searchFold } from './archiveNav';

export const SUGGEST_MIN_LENGTH = 2;
const SUGGEST_MAX_LENGTH = 80;
// As MOS_SEARCH_ENDINGS in mos-search.php (folded, longest first).
const ENDINGS = ['urnar', 'arnir', 'arnar', 'unum', 'anna', 'inum', 'inn', 'ana', 'ina', 'nar', 'nir', 'num', 'ur', 'ar', 'ir', 'um', 'an', 'in', 'id', 'a', 'i', 'u', 'r', 's'];

/** The text worth asking with: trimmed, single-spaced, capped; '' when it is too short to mean anything. */
export function suggestQuery(raw: string | null | undefined): string {
  const q = Array.from((raw ?? '').replace(/\s+/g, ' ').trim()).slice(0, SUGGEST_MAX_LENGTH).join('').trim();
  return Array.from(q).length >= SUGGEST_MIN_LENGTH ? q : '';
}

const split = (text: string): string[] => searchFold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);

function stem(word: string): string {
  if (word.length < 5 || /\d/.test(word)) return word;
  for (const ending of ENDINGS) {
    if (word.length - ending.length >= (ending.length === 1 ? 4 : 3) && word.endsWith(ending)) return word.slice(0, -ending.length);
  }
  return word;
}

/** A stem and, for a word that lost an ending, its u-umlaut twin (task / tosk). */
function spellings(word: string): string[] {
  const s = stem(word);
  const m = s !== word ? /^(.*)([ao])([^aeiouy]+)$/.exec(s) : null;
  return m ? [s, m[1] + (m[2] === 'a' ? 'o' : 'a') + m[3]] : [s];
}

/** Whether a (folded) word answers to a stem: it starts with it, or (three letters or more) ends with it plus at
 *  most an ending. */
export function wordMatches(stemmed: string, word: string): boolean {
  if (word.startsWith(stemmed)) return true;
  if (stemmed.length < 3) return false;
  const at = word.lastIndexOf(stemmed);
  if (at < 0) return false;
  const rest = word.slice(at + stemmed.length);
  return rest === '' || ENDINGS.includes(rest);
}

export interface SuggestTerm {
  name: string;
  path: string;
  /** Products in it; a term with none is not suggested. */
  count: number;
}

/** The categories and brands whose name has every typed word, the bigger first, at most `limit`. */
export function suggestTerms<T extends SuggestTerm>(query: string, terms: readonly T[], limit: number): T[] {
  const typed = split(query).map(spellings);
  if (typed.length === 0) return [];
  return terms
    .filter((t) => {
      if (t.count <= 0) return false;
      const words = split(t.name);
      return typed.every((forms) => words.some((w) => forms.some((f) => wordMatches(f, w))));
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'is'))
    .slice(0, limit);
}
