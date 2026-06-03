import type { APIRoute } from 'astro';
import { getProductsByIds } from '../../lib/woo';
import { productImage } from '../../lib/img';
import { decodeEntities } from '../../lib/decode';
import { cardPriceText } from '../../lib/price';

export const prerender = false;

const MAX_IDS = 100;

// Fresh catalog data for a set of product IDs — backs the wishlist page so saved items
// show CURRENT price/stock rather than a stale localStorage snapshot. Public catalog
// fields only (no PII); never cached.
export const GET: APIRoute = async (ctx) => {
  const raw = ctx.url.searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .slice(0, MAX_IDS) // cap the work before coercing every token
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return json([], 200);

  const products = await getProductsByIds(ids, ids.length).catch(() => []);
  const items = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: decodeEntities(p.name),
    image: productImage(p).src,
    priceText: cardPriceText(p),
    onSale: Boolean(p.on_sale),
    // Match ProductCard's badge rule (only 'outofstock' is sold out; backorder isn't).
    outOfStock: p.stock_status === 'outofstock',
  }));
  return json(items, 200);
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
