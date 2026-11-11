import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { sameOrigin } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// WooCommerce's "Týnt lykilorð?" request. The reset email itself is WooCommerce's, sent by
// wp-mu-plugins/mos-account-api.php. The answer never tells whether the account exists: "not sent" is said only for
// a failure that happens before WordPress looks the account up (NOT_TAKEN, or a connection that failed outright).
// A 500 or a time-out can come from the mail step, which runs for an existing account alone, so those keep the one
// "sent" answer and are only logged.
const requests = createLimiter(5, 60 * 60 * 1000);
// WordPress's store-wide limit (checked before the lookup), and a proxy that could not reach PHP at all.
const NOT_TAKEN = new Set([429, 502, 503]);

export const POST: APIRoute = async (ctx) => {
  const { request, url, redirect } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const form = await request.formData().catch(() => null);
  const login = String(form?.get('user_login') ?? '').trim();
  if (!login) return redirect('/min-sida/lost-password/?error=empty', 303);
  if (!requests.take(visitorKey(ctx))) return redirect('/min-sida/lost-password/?error=limited', 303);
  let refused = false;
  try {
    const res = await fetch(`${WP_INTERNAL_URL}/wp-json/mos/v1/account/lost-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_login: login.slice(0, 200) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.warn(`[account] lost-password: WordPress answered ${res.status}`);
    refused = NOT_TAKEN.has(res.status);
  } catch (err: unknown) {
    console.warn(`[account] lost-password: WordPress unreachable: ${err instanceof Error ? err.message : String(err)}`);
    refused = !(err instanceof Error && err.name === 'TimeoutError');
  }
  if (refused) return redirect('/min-sida/lost-password/?error=notsent', 303);
  return redirect('/min-sida/lost-password/?sent=1', 303);
};
