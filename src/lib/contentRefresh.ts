// The "content changed" poke — SERVER-ONLY. WordPress calls POST /api/content-refresh when the Forsíða is saved
// (mos-headless-api.php), and the front-page and chrome caches are refetched at once instead of at the end of
// their minute. It needs no key: it carries no data, and all a stranger can cause is one refetch per window.
import { refreshFrontPage } from './frontPage';
import { refreshSiteChrome } from './siteChrome';

export const REFRESH_WINDOW_MS = 2000;

let lastAt = -Infinity;
let pending: Promise<boolean> | null = null;

/** Refetch the WordPress content the pages cache; resolves when it is in, to false when WordPress could not be
 *  read (the pages keep what they had). Refetches start at most once per window:
 *  a poke inside the window is not dropped (its save would then wait out the minute) but waits for the window's end,
 *  and every poke that arrives while one waits shares that refetch. One that arrives after a refetch has started
 *  gets the next one, since that refetch may have read before its save. */
export function refreshContent(): Promise<boolean> {
  const wait = Math.max(0, lastAt + REFRESH_WINDOW_MS - Date.now());
  return (pending ??= new Promise<void>((resolve) => setTimeout(resolve, wait)).then(async () => {
    pending = null;
    lastAt = Date.now();
    const front = await refreshFrontPage();
    const chrome = await refreshSiteChrome(); // after the front page: the chrome is built from it
    return front && chrome;
  }));
}
