// Shared helpers for the cart islands (side cart, /karfa/, checkout review). Client-safe.
import { productPath } from './paths';
import { isSizeAttribute } from './variations';
import type { Cart, CartItem } from './types';

/** Cart subtotal in whole krónur as live shows it (items incl. tax, before shipping/discounts). The free-shipping
 *  bar counts it without the tax when WordPress says so (Goya's "subtotal incl. taxes" switch: ShippingBar.includeTaxes). */
export function cartSubtotal(cart: Cart | null, includeTaxes = true): number {
  if (!cart) return 0;
  const t = cart.totals;
  const minor = 10 ** (t.currency_minor_unit ?? 0);
  return (Number(t.total_items) + (includeTaxes ? Number(t.total_items_tax ?? 0) : 0)) / minor;
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

/** A line's chosen options as text ("Litur: Rauður, Stærð: 42.5"); any size attribute (Stærðir, Skóstærð …) reads
 *  "Stærð", as the product page asks "Veldu stærð". */
export function variationText(variation: { attribute: string; value: string }[]): string {
  return variation.map((v) => `${isSizeAttribute(v.attribute) ? 'Stærð' : v.attribute}: ${v.value}`).join(', ');
}
