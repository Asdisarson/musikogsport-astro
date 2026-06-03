import type { APIRoute } from 'astro';
import { getOrder } from '../../lib/woo';

export const prerender = false;

// Order-status lookup for the thank-you page (and its client-side poll). Gated by
// order_key inside getOrder() — a wrong/missing key is indistinguishable from a
// missing order (both 404) so order IDs can't be enumerated. Never caches.
export const GET: APIRoute = async (ctx) => {
  const id = Number(ctx.url.searchParams.get('id'));
  const key = ctx.url.searchParams.get('key') ?? '';
  if (!Number.isInteger(id) || id <= 0 || !key) {
    return json({ message: 'Ógild pöntun.' }, 400);
  }
  const order = await getOrder(id, key);
  if (!order) {
    return json({ message: 'Pöntun fannst ekki.' }, 404);
  }
  return json(order, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
