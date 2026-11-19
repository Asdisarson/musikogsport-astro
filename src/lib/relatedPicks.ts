// The product page's related row (components/RelatedProducts): the products the shop linked by hand in
// WooCommerce's "Tengdar vörur" lead it, ahead of the category's best sellers and WooCommerce's own suggestions.
// Pure.
import type { WooProduct } from './types';
import { isPosInt } from './validate';

/** The hand-picked product ids in the shop's order: upsells, then cross-sells; each once, never the product itself. */
export function pickedIds(product: Pick<WooProduct, 'id' | 'upsell_ids' | 'cross_sell_ids'> | null | undefined): number[] {
  if (!product) return [];
  const ids = [...(product.upsell_ids ?? []), ...(product.cross_sell_ids ?? [])].filter(isPosInt);
  return [...new Set(ids)].filter((id) => id !== product.id);
}

export interface RelatedParts {
  /** The product the page shows, never in its own row. */
  productId: number;
  /** The hand-picked products, in the shop's order. A sold-out one is left out of the whole row (the best sellers
   *  are in stock too); one on backorder can still be bought, so it stays. */
  picked: WooProduct[];
  /** The category's best sellers in stock. */
  scoped: WooProduct[];
  /** WooCommerce's own suggestions. */
  topUp: WooProduct[];
  limit: number;
}

/** The row: hand-picked, then best sellers, then the top-up; each product once, at most `limit`. */
export function relatedOrder({ productId, picked, scoped, topUp, limit }: RelatedParts): WooProduct[] {
  const soldOut = picked.filter((p) => p.stock_status === 'outofstock').map((p) => p.id);
  const seen = new Set([productId, ...soldOut]);
  const row: WooProduct[] = [];
  for (const product of [...picked, ...scoped, ...topUp]) {
    if (row.length >= limit) break;
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    row.push(product);
  }
  return row;
}
