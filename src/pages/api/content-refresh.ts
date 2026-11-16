import type { APIRoute } from 'astro';
import { refreshContent } from '../../lib/contentRefresh';
import { log } from '../../lib/logger';

export const prerender = false;

// WordPress's "the Forsíða was saved" poke (lib/contentRefresh): no body, no key; 204 once the content
// is in, 502 when WordPress could not be read (the editor is then told it will show within the minute).
export const POST: APIRoute = async () => {
  const refreshed = await refreshContent();
  log.info('content refresh', { refreshed });
  return new Response(null, { status: refreshed ? 204 : 502, headers: { 'Cache-Control': 'no-store' } });
};
