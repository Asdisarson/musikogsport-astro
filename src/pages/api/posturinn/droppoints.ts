import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { jsonResponse } from '../../../lib/http';

export const prerender = false;

// Proxies the MOS mu-plugin's public droppoints endpoint (server-to-server), which
// lists Pósturinn parcel lockers (postbox) / post offices (parcelpoint) for a
// postcode. The mu-plugin holds the Pósturinn API key; the storefront never sees it.
export const GET: APIRoute = async (ctx) => {
  const postcode = (ctx.url.searchParams.get('postcode') ?? '').replace(/\D/g, '');
  const type = ctx.url.searchParams.get('type') === 'parcelpoint' ? 'parcelpoint' : 'postbox';
  if (postcode.length !== 3) return jsonResponse({ ok: false, code: 'bad_postcode', items: [] }, 400);

  try {
    const res = await fetch(
      `${WP_INTERNAL_URL}/wp-json/mos/v1/droppoints?postcode=${postcode}&type=${type}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) },
    );
    const text = await res.text();
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
