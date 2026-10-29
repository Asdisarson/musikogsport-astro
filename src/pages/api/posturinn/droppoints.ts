import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { jsonResponse, tooManyRequests } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// Proxies the MOS mu-plugin's public droppoints endpoint (server-to-server), which
// lists Pósturinn parcel lockers (postbox) / post offices (parcelpoint) for a
// postcode. The mu-plugin holds the Pósturinn API key; the storefront never sees it.
// Limited per visitor (each call costs a Pósturinn lookup through WordPress): 60 a minute is several times a shopper
// retyping postcodes, and a successful list is browser- and CDN-cacheable for 10 minutes anyway.
const WINDOW_MS = 60 * 1000;
const requests = createLimiter(60, WINDOW_MS);

export const GET: APIRoute = async (ctx) => {
  const postcode = (ctx.url.searchParams.get('postcode') ?? '').replace(/\D/g, '');
  const type = ctx.url.searchParams.get('type') === 'parcelpoint' ? 'parcelpoint' : 'postbox';
  if (postcode.length !== 3) return jsonResponse({ ok: false, code: 'bad_postcode', items: [] }, 400);
  if (!requests.take(visitorKey(ctx))) return tooManyRequests(WINDOW_MS / 1000);

  try {
    const res = await fetch(
      `${WP_INTERNAL_URL}/wp-json/mos/v1/droppoints?postcode=${postcode}&type=${type}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) },
    );
    const text = await res.text();
    if (!res.ok) console.warn(`[droppoints] upstream answered ${res.status}`);
    // Only cache successful lists (stable, browser-cacheable to avoid refetch churn). An upstream
    // 4xx/5xx must NOT be cached publicly for 10 min — pass it through with no-store.
    const cache = res.ok ? 'public, max-age=600' : 'no-store';
    return new Response(text || '{"ok":false,"items":[]}', {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
    });
  } catch (err) {
    console.warn(`[droppoints] upstream failed: ${err instanceof Error ? err.message : String(err)}`);
    return jsonResponse({ ok: false, code: 'upstream_error', items: [] }, 502);
  }
};
