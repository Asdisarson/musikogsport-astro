import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { sameOrigin } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// WooCommerce's "Týnt lykilorð?" request. Always the same answer (no account enumeration); the reset
// email itself is WooCommerce's, sent by wp-mu-plugins/mos-account-api.php.
const requests = createLimiter(5, 60 * 60 * 1000);

export const POST: APIRoute = async (ctx) => {
  const { request, url, redirect } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const form = await request.formData().catch(() => null);
  const login = String(form?.get('user_login') ?? '').trim();
  if (!login) return redirect('/min-sida/lost-password/?error=empty', 303);
  if (!requests.take(visitorKey(ctx))) return redirect('/min-sida/lost-password/?error=limited', 303);
  // The visitor always gets the same answer; a request WordPress didn't take is only logged.
  const res = await fetch(`${WP_INTERNAL_URL}/wp-json/mos/v1/account/lost-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_login: login.slice(0, 200) }),
    signal: AbortSignal.timeout(10000),
  }).catch((err: unknown) => {
    console.warn(`[account] lost-password: WordPress unreachable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (res && !res.ok) console.warn(`[account] lost-password: WordPress answered ${res.status}`);
  return redirect('/min-sida/lost-password/?sent=1', 303);
};
