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

/** The quiet line under the product counter. Reads the cart's own count when nothing more can be added (the stock may
 *  have fallen below what the cart holds), and says "stock" only when the cap is a stock cap, never for sold individually. */
export function purchaseNote(
  s: { cap: number | null; inCart: number; remaining: number | null; soldOne: boolean; atMax: boolean },
  lowStock: number,
): string | null {
  if (s.cap === null || s.cap < 1) return null;
  if (s.remaining === 0) return s.inCart > 0 ? `Þú ert þegar með öll ${s.inCart} stk. í körfunni` : null;
  if (s.soldOne) return null;
  if (s.atMax) return 'Ekki fleiri til á lager';
  if (s.cap <= lowStock) return `Aðeins ${s.cap} til á lager`;
  return null;
}
