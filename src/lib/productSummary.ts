// A product as the small cards outside the catalog pages show it (the wishlist, the search suggestions): the same
// rules as ProductCard. SERVER-ONLY (reads the photo-fill cache).
import { productImage } from './img';
import { cardFillOf } from './photoBgServer';
import { decodeEntities } from './decode';
import { cardPriceText, salePercent } from './price';
import { formatISK } from './format';
import { cardCategories } from './categoryTree';
import { productPath } from './paths';
import type { CategoryTerm } from './liveFilters';
import type { ProductSummary, WooProduct } from './types';

export function productSummary(p: WooProduct, categories: CategoryTerm[]): ProductSummary {
  // Match ProductCard's rules (only 'outofstock' is sold out; backorder isn't; no discount on a sold-out card).
  const outOfStock = p.stock_status === 'outofstock';
  const percent = !outOfStock && p.on_sale ? salePercent(p.price_html) : null;
  const { src: image, srcset } = productImage(p);
  const subtitle = cardCategories((p.categories ?? []).map((c) => ({ id: c.id, name: decodeEntities(c.name) })), categories, 1)[0]?.name;
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
}
