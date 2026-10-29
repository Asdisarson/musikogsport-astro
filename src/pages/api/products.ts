import type { APIRoute } from 'astro';
import { getProductsByIds } from '../../lib/woo';
import { productImage } from '../../lib/img';
import { cardFillOf } from '../../lib/photoBgServer';
import { decodeEntities } from '../../lib/decode';
import { cardPriceText, salePercent } from '../../lib/price';
import { formatISK } from '../../lib/format';
import { loadCatalogTerms } from '../../lib/catalogTerms';
import { cardCategories } from '../../lib/categoryTree';
import { WISHLIST_MAX_IDS } from '../../lib/wishlist';
import { jsonResponse, tooManyRequests } from '../../lib/http';
import { createLimiter } from '../../lib/rateLimit';
import { visitorKey } from '../../lib/visitor';
import { isPosInt } from '../../lib/validate';
import { productPath } from '../../lib/paths';
import type { ProductSummary } from '../../lib/types';

export const prerender = false;

// Fresh catalog data for a set of product IDs — backs the wishlist page so saved items
// show CURRENT price/stock rather than a stale localStorage snapshot. Public catalog
// fields only (no PII); never cached. Limited per visitor: the wishlist page asks once per visit, so 60 a minute
// only stops a script walking ids through it (each call fans out to WooCommerce).
const WINDOW_MS = 60 * 1000;
const requests = createLimiter(60, WINDOW_MS);

export const GET: APIRoute = async (ctx) => {
  const raw = ctx.url.searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .slice(0, WISHLIST_MAX_IDS) // cap the work before coercing every token (client caps to match)
    .map((s) => Number(s.trim()))
    .filter(isPosInt);
  if (ids.length === 0) return jsonResponse([], 200);
  if (!requests.take(visitorKey(ctx))) return tooManyRequests(WINDOW_MS / 1000);

  // Do NOT collapse a backend outage into an empty result: a 200+[] would make WishlistView
  // (which only trusts res.ok) mark EVERY saved item "Ekki í boði". Surface the failure as a
  // non-2xx so the client keeps fetchOk=false and falls back to its stored {name,image} snapshot.
  // The card subtitle needs the category tree, fetched alongside; it is cached, never rejects, and degraded terms
  // only drop the subtitle — so a rejection here is always the products call.
  let products;
  let terms;
  try {
    [products, terms] = await Promise.all([getProductsByIds(ids, ids.length), loadCatalogTerms()]);
  } catch {
    return jsonResponse({ message: 'Vörulistinn er ekki í boði í augnablikinu.' }, 502);
  }
  const items: ProductSummary[] = products.map((p) => {
    // Match ProductCard's rules (only 'outofstock' is sold out; backorder isn't; no discount on a sold-out card).
    const outOfStock = p.stock_status === 'outofstock';
    const percent = !outOfStock && p.on_sale ? salePercent(p.price_html) : null;
    const { src: image, srcset } = productImage(p);
    const subtitle = cardCategories((p.categories ?? []).map((c) => ({ id: c.id, name: decodeEntities(c.name) })), terms.categories, 1)[0]?.name;
    return {
      id: p.id,
      slug: p.slug,
      path: productPath(p.permalink, p.slug),
      name: decodeEntities(p.name),
      image,
      srcset: srcset || undefined,
      photoFill: cardFillOf(image, srcset) ?? undefined,
      priceText: cardPriceText(p),
      onSale: Boolean(p.on_sale),
      outOfStock,
      subtitle,
      wasText: percent !== null && p.regular_price && p.sale_price ? formatISK(p.regular_price) : undefined,
      percent: percent ?? undefined,
    };
  });
  return jsonResponse(items, 200);
};
