import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';

export const prerender = false;

const json = (body: unknown, status: number, cache = 'no-store') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });

// Proxies the MOS mu-plugin's public droppoints endpoint (server-to-server), which
// lists Pósturinn parcel lockers (postbox) / post offices (parcelpoint) for a
// postcode. The mu-plugin holds the Pósturinn API key; the storefront never sees it.
export const GET: APIRoute = async (ctx) => {
  const postcode = (ctx.url.searchParams.get('postcode') ?? '').replace(/\D/g, '');
  const type = ctx.url.searchParams.get('type') === 'parcelpoint' ? 'parcelpoint' : 'postbox';
  if (postcode.length !== 3) return json({ ok: false, code: 'bad_postcode', items: [] }, 400);

  try {
    const res = await fetch(
      `${WP_INTERNAL_URL}/wp-json/mos/v1/droppoints?postcode=${postcode}&type=${type}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) },
    );
    const text = await res.text();
    return new Response(text || '{"ok":false,"items":[]}', {
      status: res.status,
      // List is stable; let the browser cache it briefly to avoid refetch churn.
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });
  } catch {
    return json({ ok: false, code: 'upstream_error', items: [] }, 502);
  }
};
