// The "content changed" poke — SERVER-ONLY. WordPress calls POST /api/content-refresh when the Forsíða is saved
// (mos-headless-api.php), and the front-page and chrome caches are refetched at once instead of at the end of
// their minute. Then, when that changed what the pages render, every stored page is marked stale
// (src/lib/shellStore.ts), since the stored HTML carries the header, menus and bar too. The poke needs no key: it
// carries no data, and a poke that changes nothing marks nothing (see contentFingerprint), so a stranger's poke costs
// one refetch per window and no re-render.
import { createHash } from 'node:crypto';
import { loadFrontPage, refreshFrontPage } from './frontPage';
import { loadSiteChrome, refreshSiteChrome } from './siteChrome';
import { invalidateAllPages } from './shellRuntime';

export const REFRESH_WINDOW_MS = 2000;

let lastAt = -Infinity;
let pending: Promise<boolean> | null = null;
/** The content the stored pages were last marked for (null until the first mark of this process). */
let markedFor: string | null = null;

/** A fingerprint of the content every page renders: the Forsíða and the chrome, as the caches hold them now. Read after
 *  the refetch, so it is the content a page rendered from now on sees; no WordPress call (the caches just ran). */
export async function contentFingerprint(): Promise<string> {
  const [front, chrome] = await Promise.all([loadFrontPage(), loadSiteChrome()]);
  return createHash('sha1').update(JSON.stringify([front, chrome])).digest('hex');
}

/** Refetch the WordPress content the pages cache, then mark every stored page stale when that changed it; resolves when
 *  the content is in, to false when WordPress could not be read (the pages keep what they had). Refetches start at most
 *  once per window: a poke inside the window is not dropped (its save would then wait out the minute) but waits for the
 *  window's end, and every poke that arrives while one waits shares that refetch. One that arrives after a refetch has
 *  started gets the next one, since that refetch may have read before its save.
 *
 *  The marks come after the refetch, so a page rendered from now on sees the new content. A mark is made only when the
 *  content differs from the last one marked (the first poke of a process always marks): a refetch that failed, or found
 *  nothing new, costs no re-render. A failed refetch that leaves the content changed in part is marked as well, and a
 *  chrome that comes back after a failure marks the pages itself (lib/siteChrome). */
export function refreshContent(): Promise<boolean> {
  const wait = Math.max(0, lastAt + REFRESH_WINDOW_MS - Date.now());
  return (pending ??= new Promise<void>((resolve) => setTimeout(resolve, wait)).then(async () => {
    pending = null;
    lastAt = Date.now();
    const front = await refreshFrontPage();
    const chrome = await refreshSiteChrome(); // after the front page: the chrome is built from it
    const fingerprint = await contentFingerprint();
    if (fingerprint !== markedFor) {
      await invalidateAllPages();
      markedFor = fingerprint;
    }
    return front && chrome;
  }));
}
