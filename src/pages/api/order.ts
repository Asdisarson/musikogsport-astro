import type { APIRoute } from 'astro';
import { lookupOrder } from '../../lib/woo';
import { jsonResponse, tooManyRequests } from '../../lib/http';
import { createLimiter } from '../../lib/rateLimit';
import { visitorKey } from '../../lib/visitor';
import { isPosInt } from '../../lib/validate';

export const prerender = false;

// Order-status lookup for the thank-you page (and its client-side poll). Gated by
// order_key inside lookupOrder() — a wrong/missing key is indistinguishable from a
// missing order (both 404) so order IDs can't be enumerated. Never caches.
// Misses are limited per visitor (id + key guessing): a slot is taken before asking WooCommerce and given back when
// the order was found, or when WordPress didn't answer (LC-13: an outage answers 503 and is never counted as a guess,
// so a WordPress blip can't lock a shopper out of their own receipt poll).
const WINDOW_MS = 15 * 60 * 1000;
const misses = createLimiter(20, WINDOW_MS);

export const GET: APIRoute = async (ctx) => {
  const id = Number(ctx.url.searchParams.get('id'));
  const key = ctx.url.searchParams.get('key') ?? '';
  if (!isPosInt(id) || !key) {
    return jsonResponse({ message: 'Ógild pöntun.' }, 400);
  }
  const visitor = visitorKey(ctx);
  if (!misses.take(visitor)) return tooManyRequests(WINDOW_MS / 1000);
  const found = await lookupOrder(id, key);
  if (found.state === 'not-found') return jsonResponse({ message: 'Pöntun fannst ekki.' }, 404);
  misses.refund(visitor);
  if (found.state === 'unavailable') {
    const res = jsonResponse({ message: 'Ekki tókst að sækja stöðu pöntunarinnar. Reyndu aftur eftir smástund.' }, 503);
    res.headers.set('Retry-After', '30');
    return res;
  }
  return jsonResponse(found.order, 200);
};
