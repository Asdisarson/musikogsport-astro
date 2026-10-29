// Shared helpers for the cart islands (side cart, /karfa/, checkout review). Client-safe.
import { productPath } from './paths';
import type { Cart, CartItem } from './types';

/** Cart subtotal in whole krónur as live shows it (items incl. tax, before shipping/discounts). */
export function cartSubtotal(cart: Cart | null): number {
  if (!cart) return 0;
  const t = cart.totals;
  const minor = 10 ** (t.currency_minor_unit ?? 0);
  return (Number(t.total_items) + Number(t.total_items_tax ?? 0)) / minor;
}

/** A line's subtotal incl. tax, in minor units (what live's cart rows show, before coupons). */
export function lineSubtotal(item: CartItem): string {
  return String(Number(item.totals.line_subtotal) + Number(item.totals.line_subtotal_tax ?? 0));
}

/** Storefront path for a cart line's product (Store API permalinks carry the WP host). */
export function lineHref(permalink?: string): string | null {
  const slug = permalink?.replace(/\/$/, '').split('/').pop();
  return permalink && slug ? productPath(permalink, slug) : null;
}

/** What a cart view shows (CO-01): the cart once loaded (a later failed write keeps it on screen), else the error of
 *  the failed first load with a retry, else "Sæki…". */
export function cartViewState(cart: Cart | null, error: string | null): 'loading' | 'error' | 'empty' | 'ready' {
  if (!cart) return error ? 'error' : 'loading';
  return cart.items.length === 0 ? 'empty' : 'ready';
}
