import type { APIRoute } from 'astro';
import { getProductsByIds } from '../../lib/woo';
import { productImage } from '../../lib/img';
import { decodeEntities } from '../../lib/decode';
import { cardPriceText } from '../../lib/price';
import { WISHLIST_MAX_IDS } from '../../lib/wishlist';
import { jsonResponse } from '../../lib/http';
import { isPosInt } from '../../lib/validate';
import type { ProductSummary } from '../../lib/types';

export const prerender = false;

// Fresh catalog data for a set of product IDs — backs the wishlist page so saved items
// show CURRENT price/stock rather than a stale localStorage snapshot. Public catalog
// fields only (no PII); never cached.
export const GET: APIRoute = async (ctx) => {
  const raw = ctx.url.searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .slice(0, WISHLIST_MAX_IDS) // cap the work before coercing every token (client caps to match)
    .map((s) => Number(s.trim()))
    .filter(isPosInt);
  if (ids.length === 0) return jsonResponse([], 200);

  // Do NOT collapse a backend outage into an empty result: a 200+[] would make WishlistView
  // (which only trusts res.ok) mark EVERY saved item "Ekki í boði". Surface the failure as a
  // non-2xx so the client keeps fetchOk=false and falls back to its stored {name,image} snapshot.
  let products;
  try {
    products = await getProductsByIds(ids, ids.length);
  } catch {
    return jsonResponse({ message: 'Vörulistinn er ekki í boði í augnablikinu.' }, 502);
  }
  const items: ProductSummary[] = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: decodeEntities(p.name),
    image: productImage(p).src,
    priceText: cardPriceText(p),
    onSale: Boolean(p.on_sale),
    // Match ProductCard's badge rule (only 'outofstock' is sold out; backorder isn't).
    outOfStock: p.stock_status === 'outofstock',
  }));
  return jsonResponse(items, 200);
};
