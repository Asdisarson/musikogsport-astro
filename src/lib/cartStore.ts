// Client-side cart state. The server-side Woo Store API cart (via /api/cart*) is
// the source of truth; this nanostore mirrors it so all React islands stay in sync.
import { atom, computed } from 'nanostores';
import { decodeEntities } from './decode';
import type { Cart } from './types';
import { createSerial } from './serial';
import { CART_CLIENT_TIMEOUT_MS } from './timeouts';
import { onPageRestored, onTabVisible } from './pageLifecycle';

export const cart = atom<Cart | null>(null);
export const cartLoading = atom(false);
export const isCartOpen = atom(false);
export const cartError = atom<string | null>(null);

export const cartCount = computed(cart, (c) => c?.items_count ?? 0);

// Cart calls run one at a time: the Store API session has no lock, so a card add, the PDP add and a drawer
// quantity change in flight together could overwrite each other.
const serial = createSerial();

/** After a call our server gave up waiting on (502/504) or that got no answer, WordPress may still be finishing it;
 *  the next queued cart call waits this long before it goes out (LM-02). The shopper sees the error at once. */
export const CART_COOLDOWN_MS = 5_000;
let coolUntil = 0;

/** Tab return re-reads the cart at most this often (CO-05). */
export const CART_RESYNC_GAP_MS = 10_000;
let lastRead = -Infinity;

function call(path: string, body?: unknown): Promise<Cart> {
  // Cleared when the shopper acts, not when this call reaches the head of the queue: otherwise a queued
  // call would wipe the error of the one just before it before it was ever shown.
  cartError.set(null);
  return serial(() => send(path, body));
}

/** Run other work that changes the cart (placing the order) in the same queue. */
export function withCartLock<T>(work: () => Promise<T>): Promise<T> {
  return serial(work);
}

const isCart = (d: unknown): d is Cart => !!d && typeof d === 'object' && Array.isArray((d as Cart).items);
const NO_ANSWER = 'Þjónustan svaraði ekki, reyndu aftur.';

async function send(path: string, body?: unknown): Promise<Cart> {
  const wait = coolUntil - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  cartLoading.set(true);
  try {
    const res = await fetch(path, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Longer than the server's own wait on the Store API (lib/timeouts), so its answer, and the rotated Cart-Token
      // cookie in it, always arrives before the next queued call starts.
      signal: AbortSignal.timeout(CART_CLIENT_TIMEOUT_MS),
    }).catch(() => {
      // Offline, a timeout, a dropped connection: the browser's own text ("Failed to fetch") is English.
      coolUntil = Date.now() + CART_COOLDOWN_MS;
      throw new Error(NO_ANSWER);
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 502 || res.status === 504) coolUntil = Date.now() + CART_COOLDOWN_MS;
      const msg = (data && typeof data === 'object' && 'message' in data && (data as { message?: string }).message) || 'Villa kom upp. Reyndu aftur.';
      // Decode server entities (e.g. &quot;) so coupon/shipping errors read cleanly inline.
      throw new Error(decodeEntities(String(msg)));
    }
    // An OK answer that isn't a cart (a proxy page, an empty body) is an error, not an empty mirror (LM-12b).
    if (!isCart(data)) throw new Error('Villa kom upp. Reyndu aftur.');
    cart.set(data);
    lastRead = Date.now();
    return data;
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
  if (typeof window !== 'undefined') watchCartFreshness();
  refreshCart().catch(() => {
    primed = false;
  });
}

/** "Reyna aftur" after a failed first load (CO-01). */
export function retryCartLoad(): void {
  ensureLoaded();
}

/** Re-read the cart (CO-05). Only once it was loaded on this page; `force` skips the gap. */
function resync(force: boolean): void {
  if (!primed) return;
  if (!force && Date.now() - lastRead < CART_RESYNC_GAP_MS) return;
  lastRead = Date.now();
  void refreshCart().catch(() => {});
}

let watching = false;
/** Keep the mirror fresh when the shopper comes back (CO-05): a page restored from the back/forward cache (Back after
 *  an order: the server-side cart may have been emptied) is always re-read; a tab coming back into view at most once
 *  per CART_RESYNC_GAP_MS. Called once by ensureLoaded; the targets are parameters for tests. */
export function watchCartFreshness(target?: Parameters<typeof onPageRestored>[1], doc?: Parameters<typeof onTabVisible>[1]): void {
  if (watching && !target) return;
  watching = true;
  onPageRestored(() => resync(true), target);
  onTabVisible(() => resync(false), doc);
}

export const refreshCart = () => call('/api/cart');
export const addToCart = (id: number, quantity = 1, variation?: { attribute: string; value: string }[]) =>
  call('/api/cart', { id, quantity, ...(variation && variation.length ? { variation } : {}) });
export const updateQty = (key: string, quantity: number) => call('/api/cart/update', { key, quantity });
export const removeLine = (key: string) => call('/api/cart/remove', { key });

// The quantity each line's queued stepper calls will leave it at (CO-06). A click counts from the last queued target,
// not from the rendered quantity, which only changes when the first call returns: three quick "+" are +1, +2, +3.
const pendingQty = new Map<string, number>();
const QTY_MAX = 99; // the server clamps to 1-99 (validate.clampQty)

/** One stepper click: +1 or -1 on a cart line. Resolves without a call when the line is already at the bound. */
export async function stepQty(key: string, delta: 1 | -1): Promise<Cart | null> {
  const base = pendingQty.get(key) ?? cart.get()?.items.find((i) => i.key === key)?.quantity;
  if (base === undefined) return cart.get();
  const target = Math.min(QTY_MAX, Math.max(1, base + delta));
  if (target === base) return cart.get();
  pendingQty.set(key, target);
  try {
    return await updateQty(key, target);
  } finally {
    // Only the last queued click clears it (done or failed), so the next click starts from the cart again.
    if (pendingQty.get(key) === target) pendingQty.delete(key);
  }
}
export const setCustomer = (body: {
  billing_address?: Record<string, unknown>;
  shipping_address?: Record<string, unknown>;
}) => call('/api/cart/customer', body);
export const selectShipping = (rate_id: string) => call('/api/cart/select-shipping', { rate_id });
export const applyCoupon = (code: string) => call('/api/cart/coupon', { code });
export const removeCoupon = (code: string) => call('/api/cart/remove-coupon', { code });

export const openCart = () => isCartOpen.set(true);
export const closeCart = () => isCartOpen.set(false);
export const resetCart = () => {
  cart.set(null);
  primed = false;
};
