import type { APIRoute } from 'astro';
import { requestToken, setAuth } from '../../../lib/auth';
import { safeNext, sameOrigin } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// /min-sida/ and the header popup post here. One generic failure message (no account enumeration);
// failed attempts are limited per visitor IP because WordPress only sees this server. A slot is taken
// before asking WordPress (so a parallel burst can't all pass) and given back when the password was
// right or WordPress couldn't answer.
const failures = createLimiter(10, 15 * 60 * 1000);

export const POST: APIRoute = async (ctx) => {
  const { request, cookies, url, redirect } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get('redirect'), '/min-sida/');
  const username = String(form?.get('username') ?? '').trim();
  const password = String(form?.get('password') ?? '');
  if (!username || !password || username.length > 200 || password.length > 4096) return redirect('/min-sida/?login=failed', 303);
  const visitor = visitorKey(ctx);
  if (!failures.take(visitor)) return redirect('/min-sida/?login=limited', 303);
  const result = await requestToken(username, password);
  if ('error' in result) {
    if (result.error === 'rejected') return redirect('/min-sida/?login=failed', 303);
    failures.refund(visitor);
    return redirect('/min-sida/?login=unavailable', 303);
  }
  failures.refund(visitor);
  setAuth(cookies, result.token, form?.get('rememberme') === 'forever');
  return redirect(next, 303);
};
