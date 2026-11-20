import type { APIRoute } from 'astro';
import { refreshContent } from '../../lib/contentRefresh';
import { log } from '../../lib/logger';

export const prerender = false;

// WordPress's "the Forsíða was saved" poke (lib/contentRefresh): no body, no key. The front page and the chrome are
// refetched; when what the pages render changed, every stored page is marked stale. A visitor's next view of a marked
// page still gets the copy stored before (once; it is rendered again in the background), so the change shows from the
// view after that, and Cloudflare may hold a page for up to 5 minutes more. A save that changes nothing marks nothing.
// 204 once the content is in. 502 when WordPress could not be read in full: the pages are marked only if what they
// render changed in part, and a chrome that was failing marks the pages itself when it reads WordPress again.
export const POST: APIRoute = async () => {
  const refreshed = await refreshContent();
  log.info('content refresh', { refreshed });
  return new Response(null, { status: refreshed ? 204 : 502, headers: { 'Cache-Control': 'no-store' } });
};
