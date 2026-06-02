// Client-side cart state. The server-side Woo Store API cart (via /api/cart*) is
// the source of truth; this nanostore mirrors it so all React islands stay in sync.
import { atom, computed } from 'nanostores';
import type { Cart } from './types';

export const cart = atom<Cart | null>(null);
export const cartLoading = atom(false);
export const isCartOpen = atom(false);
export const cartError = atom<string | null>(null);

export const cartCount = computed(cart, (c) => c?.items_count ?? 0);

async function call(path: string, body?: unknown): Promise<Cart> {
  cartLoading.set(true);
  cartError.set(null);
  try {
    const res = await fetch(path, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && 'message' in data && (data as { message?: string }).message) || 'Villa kom upp. Reyndu aftur.';
      throw new Error(String(msg));
    }
    cart.set(data as Cart);
    return data as Cart;
  } catch (e) {
    cartError.set(e instanceof Error ? e.message : 'Villa kom upp.');
    throw e;
  } finally {
    cartLoading.set(false);
  }
}

// Fetch the cart once across all islands (CartButton + CartDrawer both mount).
let primed = false;
export function ensureLoaded(): void {
  if (primed) return;
  primed = true;
  refreshCart().catch(() => {
    primed = false;
  });
}

export const refreshCart = () => call('/api/cart');
export const addToCart = (id: number, quantity = 1, variation?: { attribute: string; value: string }[]) =>
  call('/api/cart', { id, quantity, ...(variation && variation.length ? { variation } : {}) });
export const updateQty = (key: string, quantity: number) => call('/api/cart/update', { key, quantity });
export const removeLine = (key: string) => call('/api/cart/remove', { key });
export const setCustomer = (body: {
  billing_address?: Record<string, unknown>;
  shipping_address?: Record<string, unknown>;
}) => call('/api/cart/customer', body);
export const selectShipping = (rate_id: string) => call('/api/cart/select-shipping', { rate_id });

export const openCart = () => isCartOpen.set(true);
export const closeCart = () => isCartOpen.set(false);
export const resetCart = () => {
  cart.set(null);
  primed = false;
};
