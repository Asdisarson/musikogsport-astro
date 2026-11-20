// The product page's related row (components/RelatedProducts): the products the shop linked by hand in
// WooCommerce's "Tengdar vörur" lead it, ahead of the category's best sellers and WooCommerce's own suggestions.
// Pure.
import type { CachedWooProduct, WooProduct } from './types';
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
  /** The hand-picked products, in the shop's order, sold out or not. */
  picked: CachedWooProduct[];
  /** The category's best sellers, sold out or not. */
  scoped: CachedWooProduct[];
  /** WooCommerce's own suggestions. */
  topUp: CachedWooProduct[];
  limit: number;
}

/** The candidates for the row: hand-picked, then best sellers, then the top-up; each product once, at most `limit`.
 *  Stock plays no part here: the server's HTML is cached, so which products it names must not depend on stock. The
 *  browser decides what is shown (relatedVisible). */
export function relatedOrder({ productId, picked, scoped, topUp, limit }: RelatedParts): CachedWooProduct[] {
  const seen = new Set([productId]);
  const row: CachedWooProduct[] = [];
  for (const product of [...picked, ...scoped, ...topUp]) {
    if (row.length >= limit) break;
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    row.push(product);
  }
  return row;
}

/** The ids the row shows, in row order: the first `limit` candidates not known to be sold out. A candidate with no
 *  live answer counts as available, so before the answer, and when the answer fails, the row shows its first `limit`
 *  as it was rendered. Pure; the browser runs it on every live answer, so a restock brings a product back. */
export function relatedVisible(ids: readonly number[], soldOut: ReadonlySet<number>, limit: number): number[] {
  const shown: number[] = [];
  for (const id of ids) {
    if (shown.length >= limit) break;
    if (!soldOut.has(id)) shown.push(id);
  }
  return shown;
}

/** Whether the candidate at `index` is a spare the row renders hidden: from `shown` on (the row's length), so that
 *  without JavaScript, or before the live answer, the row shows its first `shown` and nothing more. */
export function isRowSpare(index: number, shown: number | undefined): boolean {
  return shown !== undefined && index >= shown;
}
