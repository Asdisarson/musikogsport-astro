import type { APIRoute } from 'astro';
import { readJson } from '../../../lib/cartProxy';
import { recoverCheckoutAttempt, settleAttempt } from '../../../lib/checkoutRecovery';
import { ATTEMPT_ID } from '../../../lib/attemptId';
import { jsonResponse, sameOrigin, tooManyRequests } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// The checkout page asks this after placing an order whose answer was lost (LM-01): did the order with this attempt
// id go through? Read-only on WooCommerce: it never places, retries or changes an order. The attempt id is the bearer
// secret (128 random bits the browser made for its own order), so a found order gets the receipt cookie, as a normal
// checkout does. A page polls about six times after one lost answer; 30 a minute per visitor is ample.
const WINDOW_MS = 60 * 1000;
const asks = createLimiter(30, WINDOW_MS);

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx.request, ctx.url)) return new Response('Forbidden', { status: 403 });
  const body = await readJson<{ attempt?: unknown }>(ctx);
  const attempt = typeof body?.attempt === 'string' && ATTEMPT_ID.test(body.attempt) ? body.attempt : null;
  if (!attempt) return jsonResponse({ message: 'Ógild beiðni.' }, 400);
  if (!asks.take(visitorKey(ctx))) return tooManyRequests(WINDOW_MS / 1000);
  return jsonResponse(await settleAttempt(ctx, await recoverCheckoutAttempt(attempt)), 200);
};
