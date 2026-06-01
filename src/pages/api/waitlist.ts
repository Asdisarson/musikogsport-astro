import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { badRequest, isNonEmptyString, isPosInt, readJson } from '../../lib/cartProxy';

export const prerender = false;

// Proxies a back-in-stock signup to the StoreDash plugin's public waitlist
// endpoint (server-to-server, as the plugin intends). Returns its { ok, code,
// message } JSON through to the client.
export const POST: APIRoute = async (ctx) => {
  const body = await readJson<{ product_id?: unknown; variation_id?: unknown; email?: unknown }>(ctx);
  if (!body || !isPosInt(body.product_id) || !isNonEmptyString(body.email)) {
    return badRequest('Ógild beiðni.');
  }
  const payload = {
    product_id: body.product_id,
    variation_id: isPosInt(body.variation_id) ? body.variation_id : 0,
    email: body.email,
    language: 'is',
  };
  const res = await fetch(`${WP_INTERNAL_URL}/wp-json/storedash/v1/waitlist/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return new Response(text || '{}', {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
