import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { sameOrigin } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// WooCommerce's "Týnt lykilorð?" request. Every request WordPress takes gets the same answer (no account
// enumeration); the reset email itself is WooCommerce's, sent by wp-mu-plugins/mos-account-api.php. A request
// WordPress refused (its store-wide limit) or never got is an error to retry, not "sent": that answer depends
// only on WordPress being reachable, so it says nothing about the account either.
const requests = createLimiter(5, 60 * 60 * 1000);

export const POST: APIRoute = async (ctx) => {
  const { request, url, redirect } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const form = await request.formData().catch(() => null);
  const login = String(form?.get('user_login') ?? '').trim();
  if (!login) return redirect('/min-sida/lost-password/?error=empty', 303);
  if (!requests.take(visitorKey(ctx))) return redirect('/min-sida/lost-password/?error=limited', 303);
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
  if (!res?.ok) return redirect('/min-sida/lost-password/?error=notsent', 303);
  return redirect('/min-sida/lost-password/?sent=1', 303);
};
