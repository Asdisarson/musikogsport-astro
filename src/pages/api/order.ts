import type { APIRoute } from 'astro';
import { getOrder } from '../../lib/woo';
import { jsonResponse } from '../../lib/http';
import { isPosInt } from '../../lib/validate';

export const prerender = false;

// Order-status lookup for the thank-you page (and its client-side poll). Gated by
// order_key inside getOrder() — a wrong/missing key is indistinguishable from a
// missing order (both 404) so order IDs can't be enumerated. Never caches.
export const GET: APIRoute = async (ctx) => {
  const id = Number(ctx.url.searchParams.get('id'));
  const key = ctx.url.searchParams.get('key') ?? '';
  if (!isPosInt(id) || !key) {
    return jsonResponse({ message: 'Ógild pöntun.' }, 400);
  }
  const order = await getOrder(id, key);
  if (!order) {
    return jsonResponse({ message: 'Pöntun fannst ekki.' }, 404);
  }
  return jsonResponse(order, 200);
};
