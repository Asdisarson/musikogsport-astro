import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { jsonResponse } from '../../lib/http';
import { log } from '../../lib/logger';
import { createLimiter } from '../../lib/rateLimit';
import { isPlainObject } from '../../lib/validate';
import { visitorKey } from '../../lib/visitor';

export const prerender = false;

// Contact form proxy → WP mos/v1/contact. Accepts JSON (fetch) or a plain form post (no-JS:
// 303 back to /hafa-samband/). Rate-limited per visitor IP here, because WordPress only ever
// sees the storefront server's address.
const requests = createLimiter(5, 15 * 60 * 1000);

export const POST: APIRoute = async (ctx) => {
  const { request, redirect } = ctx;
  const contentType = request.headers.get('content-type') ?? '';
  const isForm = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
  let parsed: unknown = null;
  try {
    parsed = isForm ? Object.fromEntries(await request.formData()) : await request.json();
  } catch {
    // Unparseable body: carry on with no fields.
  }
  const body = isPlainObject(parsed) ? parsed : {};
  const fields = {
    name: String(body.name ?? '').slice(0, 200),
    email: String(body.email ?? '').slice(0, 200),
    topic: String(body.topic ?? '').slice(0, 60),
    message: String(body.message ?? '').slice(0, 5000),
  };

  const respond = (ok: boolean, status: number, message?: string) =>
    isForm
      ? redirect(`/hafa-samband/?${ok ? 'sent=1' : 'error=1'}`, 303)
      : jsonResponse(ok ? { ok: true } : { ok: false, message: message ?? 'Ekki tókst að senda fyrirspurnina.' }, status);

  // WordPress validates the fields itself; an obviously incomplete form just shouldn't cost a slot.
  if (Object.values(fields).some((v) => !v.trim())) return respond(false, 400, 'Vinsamlegast fylltu út alla reiti.');
  const visitor = visitorKey(ctx);
  if (!requests.take(visitor)) return respond(false, 429, 'Of margar fyrirspurnir. Reyndu aftur síðar.');

  try {
    const res = await fetch(`${WP_INTERNAL_URL}/wp-json/mos/v1/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status >= 500) {
      log.warn(`[contact] WordPress answered ${res.status}`);
      requests.refund(visitor); // not the visitor's fault
    }
    return respond(res.ok, res.ok ? 200 : res.status, data.message);
  } catch (err) {
    log.warn('[contact] upstream failure', { err });
    requests.refund(visitor);
    return respond(false, 502);
  }
};
