import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { jsonResponse, sameOrigin } from '../../../lib/http';
import { log } from '../../../lib/logger';
import { createLimiter } from '../../../lib/rateLimit';
import { isPlainObject } from '../../../lib/validate';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// The "Staðfesta skráningu" button on /bidlisti/stadfesta/ (the link in the waitlist's confirmation mail) → WP
// mos/v1/waitlist/confirm, which lists the address the token was mailed to. A press, not the page view, confirms:
// a mail scanner opening the link changes nothing. The token is never logged. WordPress's wording is not passed on.
const requests = createLimiter(10, 15 * 60 * 1000);
const FAILED = 'Ekki tókst að staðfesta skráninguna. Reyndu aftur síðar.';
const EXPIRED = 'Hlekkurinn er útrunninn eða hefur þegar verið notaður.';
const MESSAGES: Record<number, string> = {
  404: EXPIRED,
  409: 'Varan er komin aftur á lager, svo engin þörf er á biðlista.',
  429: 'Of margar tilraunir. Reyndu aftur síðar.',
};
const TOKEN = /^[0-9a-f]{48}$/;   // as mos-waitlist.php makes them

export const POST: APIRoute = async (ctx) => {
  const { request, url } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  let parsed: unknown = null;
  try {
    parsed = await request.json();
  } catch {
    // Unparseable body: carry on with no fields.
  }
  const token = isPlainObject(parsed) ? parsed.token : undefined;
  const respond = (ok: boolean, status: number) => jsonResponse(ok ? { ok: true } : { ok: false, message: MESSAGES[status] ?? FAILED }, status);

  if (typeof token !== 'string' || !TOKEN.test(token)) return respond(false, 404);
  const visitor = visitorKey(ctx);
  if (!requests.take(visitor)) return respond(false, 429);

  try {
    const res = await fetch(`${WP_INTERNAL_URL}/wp-json/mos/v1/waitlist/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(10000),
    });
    // 404, 409 and 429 are the visitor's; anything else (a missing route, the plugin off, an outage) is ours to see
    if (!res.ok && ![404, 409, 429].includes(res.status)) log.warn(`[waitlist] confirm: WordPress answered ${res.status}`);
    if (res.status >= 500) requests.refund(visitor); // not the visitor's fault
    return respond(res.ok, res.ok ? 200 : res.status);
  } catch (err) {
    log.warn('[waitlist] confirm: upstream failure', { err });
    requests.refund(visitor);
    return respond(false, 502);
  }
};
