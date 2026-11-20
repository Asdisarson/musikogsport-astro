import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { currentUser, readAuthToken } from '../../lib/auth';
import { jsonResponse, sameOrigin } from '../../lib/http';
import { log } from '../../lib/logger';
import { createLimiter } from '../../lib/rateLimit';
import { isPlainObject, isPosInt } from '../../lib/validate';
import { visitorKey } from '../../lib/visitor';

export const prerender = false;

// The product page's back-in-stock sign-up → WP mos/v1/waitlist. A visitor's address is mailed a confirmation link
// first (`confirm: true`; the link opens /bidlisti/stadfesta/, which posts to /api/waitlist/confirm); a signed-in
// customer giving the account's own address is listed at once (`confirm: false`): the session's token goes along so
// WordPress can tell. GET answers that customer's address for the form to start with. JSON only: the form exists only in the product island, once the live
// stock answer says the choice is sold out. Rate-limited per visitor here, because WordPress only ever sees the
// storefront server's address. The answer never says whether the address was already on the list, and WordPress's
// own wording is not passed on.
const requests = createLimiter(5, 15 * 60 * 1000);
const FAILED = 'Ekki tókst að skrá á biðlista. Reyndu aftur síðar.';
const MESSAGES: Record<number, string> = {
  400: 'Athugaðu netfangið og reyndu aftur.',
  409: 'Varan er komin aftur á lager. Endurhlaðið síðuna til að setja hana í körfu.',
  429: 'Of margar skráningar. Reyndu aftur síðar.',
};
// As /api/newsletter: enough to keep typos and junk away from WordPress, which is the real judge.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ID = 2 ** 31 - 1;   // a WordPress post id

/** A product id given as a number or a string of digits; null for anything else. */
function productIdOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : NaN;
  return isPosInt(n) && n <= MAX_ID ? n : null;
}

/** The signed-in customer's address ('' for a visitor), read by the form once it shows. Never stored: the product
 *  page itself is shared between visitors. */
export const GET: APIRoute = async ({ cookies }) => jsonResponse({ email: (await currentUser(cookies))?.email ?? '' }, 200);

export const POST: APIRoute = async (ctx) => {
  const { request, url, cookies } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  let parsed: unknown = null;
  try {
    parsed = await request.json();
  } catch {
    // Unparseable body: carry on with no fields.
  }
  const body = isPlainObject(parsed) ? parsed : {};
  const email = String(body.email ?? '').trim();
  const trap = String(body.website ?? '').trim();   // a field people never see; only a script fills it
  const productId = productIdOf(body.productId);

  // `confirm`: a confirmation mail was sent (WordPress says so); false only for a signed-in customer's own address.
  const respond = (ok: boolean, status: number, confirm = true) =>
    jsonResponse(ok ? { ok: true, confirm } : { ok: false, message: MESSAGES[status] ?? FAILED }, status);

  if (trap) return respond(true, 200);
  if (email.length > 200 || !EMAIL.test(email)) return respond(false, 400);
  if (productId === null) return jsonResponse({ ok: false, message: FAILED }, 400);
  const visitor = visitorKey(ctx);
  if (!requests.take(visitor)) return respond(false, 429);

  // Only a token WordPress still takes goes along: a stale one would have it refuse the whole request.
  const token = (await currentUser(cookies)) ? readAuthToken(cookies) : null;
  try {
    const res = await fetch(`${WP_INTERNAL_URL}/wp-json/mos/v1/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ email, product_id: productId }),
      signal: AbortSignal.timeout(10000),
    });
    // 400, 409 and 429 are the visitor's; anything else (a missing route, the plugin off, an outage) is ours to see
    if (!res.ok && ![400, 409, 429].includes(res.status)) log.warn(`[waitlist] WordPress answered ${res.status}`, { productId });
    if (res.status >= 500) requests.refund(visitor); // not the visitor's fault
    const data = (await res.json().catch(() => ({}))) as { confirm?: unknown };
    return respond(res.ok, res.ok ? 200 : res.status, data.confirm !== false);
  } catch (err) {
    log.warn('[waitlist] upstream failure', { err, productId });
    requests.refund(visitor);
    return respond(false, 502);
  }
};
