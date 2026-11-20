// Cart quantity rules, client-safe: the most a cart line's counter may reach (the Store API's quantity_limits) and what
// the product page may still add once the cart already holds some of that product.
import type { CartItem } from './types';

/** The most one cart line may hold: the Store API's quantity_limits.maximum, or null when the field is absent (the
 *  counter then behaves as before). Never below 0. */
export function lineMax(item: Pick<CartItem, 'quantity_limits'>): number | null {
  const max = item.quantity_limits?.maximum;
  return typeof max === 'number' && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : null;
}

/** A line's counter target held under its maximum; never below 1 (a maximum of 0 still shows 1). */
export function clampLineQty(qty: number, max: number | null): number {
  return max === null ? qty : Math.min(qty, Math.max(1, max));
}

/** How many of this product, or of this variation, the cart already holds. The Store API's line id is the variation's
 *  own id for a variation and the product's id for a simple product, so the page passes the id it would add. */
export function inCartQty(items: CartItem[], id: number): number {
  return items.filter((i) => i.id === id).reduce((n, i) => n + i.quantity, 0);
}

/** What the product page may still add: the live cap less what the cart holds; null with no cap, never below 0. */
export function stillAddable(cap: number | null, inCart: number): number | null {
  return cap === null ? null : Math.max(0, cap - inCart);
}

/** How many of these ids the cart already holds, all their lines together: the lines that draw on one stock. */
export function inCartAmong(items: CartItem[], ids: number[]): number {
  const want = new Set(ids);
  return items.filter((i) => want.has(i.id)).reduce((n, i) => n + i.quantity, 0);
}

/** The cart ids whose lines count against a selection's stock. A variation managed by its parent draws on the parent's
 *  stock, which every variation managed that way shares (WooCommerce sums their lines by the managed id), so all of
 *  `parentShared` count; any other selection counts its own id alone. */
export function cappedIds(selectedId: number, parentShared: number[]): number[] {
  return parentShared.includes(selectedId) ? parentShared : [selectedId];
}

/** What one more of a selection may add: the stock left (its cap less the lines drawing on the same stock), and, when sold
 *  individually, one per cart line (its own lines only, as WooCommerce refuses a line of more than one). Null: no cap. */
export function remainingFor(stockCap: number | null, stockInCart: number, soldOne: boolean, ownInCart: number): number | null {
  const fromStock = stockCap === null ? null : Math.max(0, stockCap - stockInCart);
  const fromOne = soldOne ? Math.max(0, 1 - ownInCart) : null;
  if (fromStock === null) return fromOne;
  if (fromOne === null) return fromStock;
  return Math.min(fromStock, fromOne);
}
