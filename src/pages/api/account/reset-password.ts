import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { invalidateUser } from '../../../lib/auth';
import { passwordProblem } from '../../../lib/validate';
import { sameOrigin } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// The new-password step behind WooCommerce's reset link (/min-sida/lost-password/?key=…&id=…).
const requests = createLimiter(10, 60 * 60 * 1000);

export const POST: APIRoute = async (ctx) => {
  const { request, url, redirect } = ctx;
  if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
  const form = await request.formData().catch(() => null);
  const id = Number(form?.get('id'));
  const key = String(form?.get('key') ?? '');
  const password = String(form?.get('password_1') ?? '');
  const back = (error: string) =>
    redirect(`/min-sida/lost-password/?${new URLSearchParams({ key, id: String(id || ''), error }).toString()}`, 303);
  if (!Number.isInteger(id) || id <= 0 || !key || key.length > 200) return redirect('/min-sida/lost-password/?error=invalid', 303);
  const problem = passwordProblem(password);
  if (problem) return back(problem);
  if (password !== String(form?.get('password_2') ?? '')) return back('mismatch');
  const visitor = visitorKey(ctx);
  if (!requests.take(visitor)) return back('limited');
  const res = await fetch(`${WP_INTERNAL_URL}/wp-json/mos/v1/account/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, key, password }),
    signal: AbortSignal.timeout(10000),
  }).catch((err: unknown) => {
    console.warn(`[account] reset-password: WordPress unreachable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (res?.status === 400) {
    const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
    if (code === 'mos_reset_weak') return back('short');
    if (code === 'mos_reset_long') return back('long');
    return redirect('/min-sida/lost-password/?error=invalid', 303);
  }
  if (res?.status === 429) return back('limited');
  if (!res?.ok) {
    if (res) console.warn(`[account] reset-password: WordPress answered ${res.status}`);
    // Not the visitor's fault, so it doesn't count against them. No answer, a 500 or a gateway timeout may
    // come after the reset applied (hedged copy); maintenance (503), a missing route or a firewall refusal
    // means it never ran.
    requests.refund(visitor);
    const mayHaveApplied = !res || res.status === 500 || res.status === 504;
    if (!mayHaveApplied) return back('notsaved');
    invalidateUser(id); // in case it did: don't serve this customer's older tokens from memory
    return back('unavailable');
  }
  invalidateUser(id); // WordPress now refuses this customer's older tokens; don't serve them from memory
  return redirect('/min-sida/?reset=1', 303);
};
