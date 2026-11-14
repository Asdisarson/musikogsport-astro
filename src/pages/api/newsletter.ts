import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { jsonResponse, sameOrigin } from '../../lib/http';
import { log } from '../../lib/logger';
import { createLimiter } from '../../lib/rateLimit';
import { isPlainObject } from '../../lib/validate';
import { visitorKey } from '../../lib/visitor';

export const prerender = false;

// The footer's mailing-list sign-up → WP mos/v1/newsletter (which adds the address to the store's Mailchimp
// audience). Accepts JSON (fetch) or a plain form post (no-JS: 303 back to the footer). Rate-limited per visitor
// here, because WordPress only ever sees the storefront server's address. The answer never says whether the address
// was already on the list, and WordPress's own wording is not passed on.
const requests = createLimiter(5, 15 * 60 * 1000);
const FAILED = 'Ekki tókst að skrá netfangið. Reyndu aftur síðar.';
const MESSAGES: Record<number, string> = {
  400: 'Athugaðu netfangið og reyndu aftur.',
  429: 'Of margar skráningar. Reyndu aftur síðar.',
};
// One "@", something on both sides, a dot in the domain: enough to keep typos and junk away from WordPress, which
// (with Mailchimp) is the real judge.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where a no-JS form post came from: the Referer's path when it is one of our own pages, else the home page (the
 *  footer is on every page). Only the path is kept: a redirect never leaves the site or carries a query along. */
function backPath(request: Request, url: URL): string {
  try {
    const from = new URL(request.headers.get('Referer') ?? '');
    // "//host/…" as a Location is another site: a path of ours starts with exactly one slash
    const path = from.pathname.replace(/^[/\\]+/, '/');
    return from.origin === url.origin && !path.startsWith('/api/') ? path : '/';
  } catch {
    return '/';
  }
}

export const POST: APIRoute = async (ctx) => {
  const { request, url, redirect } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const contentType = request.headers.get('content-type') ?? '';
  const isForm = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
  let parsed: unknown = null;
  try {
    parsed = isForm ? Object.fromEntries(await request.formData()) : await request.json();
  } catch {
    // Unparseable body: carry on with no fields.
  }
  const body = isPlainObject(parsed) ? parsed : {};
  const email = String(body.email ?? '').trim();
  const trap = String(body.website ?? '').trim();   // a field people never see; only a script fills it

  // `confirm`: the audience mails a confirmation link (WordPress says so; the same for every address).
  const respond = (ok: boolean, status: number, confirm = true) =>
    isForm
      ? redirect(`${backPath(request, url)}?postlisti=${ok ? (confirm ? 1 : 2) : 0}#postlisti`, 303)
      : jsonResponse(ok ? { ok: true, confirm } : { ok: false, message: MESSAGES[status] ?? FAILED }, status);

  if (trap) return respond(true, 200);
  if (email.length > 200 || !EMAIL.test(email)) return respond(false, 400);
  const visitor = visitorKey(ctx);
  if (!requests.take(visitor)) return respond(false, 429);

  try {
    const res = await fetch(`${WP_INTERNAL_URL}/wp-json/mos/v1/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(22000),   // WordPress gives Mailchimp 10 s, twice for a returning address
    });
    // 400 and 429 are the visitor's; anything else (a missing route, a firewall, an outage) is ours to see
    if (!res.ok && res.status !== 400 && res.status !== 429) log.warn(`[newsletter] WordPress answered ${res.status}`);
    if (res.status >= 500) requests.refund(visitor); // not the visitor's fault
    const data = (await res.json().catch(() => ({}))) as { confirm?: unknown };
    return respond(res.ok, res.ok ? 200 : res.status, data.confirm !== false);
  } catch (err) {
    log.warn('[newsletter] upstream failure', { err });
    requests.refund(visitor);
    return respond(false, 502);
  }
};
