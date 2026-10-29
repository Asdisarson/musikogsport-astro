// In-place archive updates (ArchiveView's script): the pure parts — which URL a filter click leads to, which
// clicks the browser keeps, what to announce, where focus goes. Pure: runs in the browser and in vitest.
import { countWord } from './facets';
import { FILTER_KEYS, clearFilterHref, clearFiltersHref, toggleFilterHref, withQuery, type FilterKey } from './liveFilters';

/** One filter interaction: an option or chip (toggle), a per-group "Hreinsa", "Hreinsa allt", or the sort. */
export type NavOp =
  | { type: 'toggle'; key: FilterKey; value: string }
  | { type: 'clear'; key: FilterKey }
  | { type: 'clear-all' }
  | { type: 'sort'; value: string };

/** The path + query `op` leads to from `url` (the URL the archive is showing or already heading to, so quick
 *  clicks compose instead of each undoing the last). Always page 1 of the archive's `base` path; no hash. These
 *  match the server-rendered hrefs (liveFilters), which stay the no-JS path. */
export function applyOp(url: string, base: string, op: NavOp): string {
  const params = new URL(url, 'http://archive.invalid').searchParams;
  switch (op.type) {
    case 'toggle':
      return toggleFilterHref(base, params, op.key, op.value);
    case 'clear':
      return clearFilterHref(base, params, op.key);
    case 'clear-all':
      return clearFiltersHref(base, params);
    case 'sort':
      params.set('orderby', op.value);
      return withQuery(base, params);
  }
}

export function isFilterKey(key: string | undefined): key is FilterKey {
  return key !== undefined && (FILTER_KEYS as readonly string[]).includes(key);
}

/** A plain left click: modified or middle clicks (new tab, new window, download) stay the browser's. */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/** The polite announcement after a filter change: "Sýni 24 vörur" / "Engar vörur fundust". */
export function announceText(total: number): string {
  return total === 0 ? 'Engar vörur fundust' : `Sýni ${countWord(total)}`;
}

/** Focus keys (data-fkey) to try, in order, for the control that had focus before a swap: the same control, else
 *  the nearest thing that still exists (its group heading, the chips heading, the sheet's close button), else the
 *  archive title. `group` is the rail group the control sits in. */
export function focusFallbacks(fkey: string, group?: string): string[] {
  const out = [fkey];
  if (fkey.startsWith('chip:') || fkey === 'clear-all') out.push('chips');
  else if (fkey === 'sheet-clear') out.push('sheet-close');
  else if (group && fkey !== `group:${group}`) out.push(`group:${group}`);
  if (fkey !== 'title') out.push('title');
  return out;
}

/** After a chip is removed, the chip to focus: the one now at its place, else the new last one; -1 when none. */
export function chipFocusIndex(removedIndex: number, remaining: number): number {
  return remaining === 0 ? -1 : Math.min(removedIndex, remaining - 1);
}

/** What a history entry shows: path + query (a hash, e.g. the skip link's #main, is not a filter change). */
export function viewKey(href: string): string {
  const u = new URL(href, 'http://archive.invalid');
  return u.pathname + u.search;
}

/** Where to scroll when the page loads into one of our history entries without the bfcache (Back from a product
 *  page that wasn't kept, a reload, a restored session). Those entries were made while scroll restoration was
 *  "manual", which the browser remembers per entry, so it would open them at the top: the saved `scrollY` is used
 *  instead. Null: leave it to the browser (a bfcache restore keeps the page as it was; not our entry). */
export function initialScroll(state: unknown, persisted: boolean): number | null {
  if (persisted || !state || typeof state !== 'object') return null;
  const s = state as { mosArchive?: unknown; scrollY?: unknown };
  if (typeof s.mosArchive !== 'number') return null;
  return typeof s.scrollY === 'number' && Number.isFinite(s.scrollY) && s.scrollY >= 0 ? s.scrollY : null;
}

/** What a landed swap does to the history: a new view is pushed; a click that led back to the view already shown
 *  (a filter ticked and unticked before the fetch) replaces the entry instead of stacking a duplicate; back/forward
 *  ('pop') leaves the history alone. */
export function historyAction(mode: 'push' | 'pop', landed: string, shown: string): 'push' | 'replace' | 'none' {
  if (mode === 'pop') return 'none';
  return landed === shown ? 'replace' : 'push';
}

/** A signal that aborts when `signal` does or after `ms`, whichever is first; `timedOut()` tells the two apart
 *  (the caller's own abort means "superseded", a timeout means "give up and navigate"). Uses AbortSignal.any and
 *  AbortSignal.timeout where the browser has them, else a timer. */
export function withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  if (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(ms);
    return { signal: AbortSignal.any([signal, timeout]), timedOut: () => timeout.aborted && !signal.aborted, clear: () => {} };
  }
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  if (signal.aborted) ctrl.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    clear: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
  };
}

/** Folded for the option-list search: lowercase, accents and Icelandic letters reduced ("Þór" = "thor",
 *  "Keflavík" = "keflavik"), so a visitor finds an option however they type it. Keep in step with
 *  mos_clean_fold() in wp-mu-plugins/mos-catalog-clean.php. */
export function searchFold(s: string): string {
  return s
    .toLocaleLowerCase('is')
    .replace(/þ/g, 'th')
    .replace(/ð/g, 'd')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether an option's name matches the search: every typed word appears in it (an empty search matches all). */
export function matchesSearch(name: string, query: string): boolean {
  const words = searchFold(query).split(' ').filter(Boolean);
  const hay = searchFold(name);
  return words.every((w) => hay.includes(w));
}
