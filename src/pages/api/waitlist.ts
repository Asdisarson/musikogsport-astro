import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { badRequest, isNonEmptyString, isPosInt, readJson } from '../../lib/cartProxy';
import { jsonResponse } from '../../lib/http';

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
  let res: Response;
  try {
    res = await fetch(`${WP_INTERNAL_URL}/wp-json/storedash/v1/waitlist/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // WP unreachable or timed out. Without this guard the throw became an unlogged 500 (the rest
    // of the proxy family standardizes on 502). 'server_error' maps to Icelandic copy in WaitlistForm.
    console.warn(`[waitlist] upstream failed: ${err instanceof Error ? err.message : String(err)}`);
    return jsonResponse({ ok: false, code: 'server_error' }, 502);
  }
  const text = await res.text();
  return new Response(text || '{}', {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
