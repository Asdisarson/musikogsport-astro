// Server-side helpers for the /api/cart* proxy routes.
// The WooCommerce Store API guest session is a `Cart-Token` (JWT). We keep it in
// an httpOnly cookie, prime it via GET /cart when missing (the first mutation
// otherwise 401s for a missing nonce), and rotate it from every response.
import type { APIContext } from 'astro';
import { getCart, type StoreResult } from './storeApi';
import type { Cart } from './types';
import { jsonResponse, tooManyRequests } from './http';
import { createLimiter } from './rateLimit';
import { visitorKey } from './visitor';

const COOKIE = 'wc_cart_token';

/** The attributes both storefront cookies here are set with (and deleted with: LM-04). */
function cookieAttrs() {
  return {
    httpOnly: true,
    secure: import.meta.env.PROD, // must be false over http in dev or the cookie is dropped
    sameSite: 'lax' as const,
    path: '/',
  };
}

function cookieOpts(maxAge = 60 * 60 * 24 * 2) {
  return { ...cookieAttrs(), maxAge }; // default 48h — matches the Cart-Token JWT lifetime
}

export function readToken(ctx: APIContext): string | null {
  return ctx.cookies.get(COOKIE)?.value ?? null;
}

export function writeToken(ctx: APIContext, token: string | null | undefined): void {
  if (token) ctx.cookies.set(COOKIE, token, cookieOpts());
}

export function clearToken(ctx: { cookies: APIContext['cookies'] }): void {
  ctx.cookies.delete(COOKIE, cookieAttrs());
}

// ---------- order-identity cookie ----------
// A short-lived httpOnly record of the order this browser placed. For a card payment it is the only
// source of the order key: the bridge strips the key from Straumur returns (a forged return could name
// any order). It also marks the order as placed here, so the thank-you page resets the cart once.
const ORDER_COOKIE = 'mos_order';
const ORDER_COOKIE_TTL = 60 * 60 * 2; // 2h — long enough to view the receipt after returning from the gateway

/** `seen`: the thank-you page has shown this order once (and started a fresh cart then). */
export function writeOrderCookie(ctx: { cookies: APIContext['cookies'] }, order: { order_id: number; order_key: string }, seen = false): void {
  if (!order?.order_id || !order?.order_key) return;
  ctx.cookies.set(ORDER_COOKIE, JSON.stringify({ id: order.order_id, key: order.order_key, seen }), cookieOpts(ORDER_COOKIE_TTL));
}

/** Forget the last order here (sign-out, LM-04: the cookie holds the order key). */
export function clearOrderCookie(ctx: { cookies: APIContext['cookies'] }): void {
  ctx.cookies.delete(ORDER_COOKIE, cookieAttrs());
}

// Accepts both APIContext (routes) and AstroGlobal (pages) — both expose `cookies`.
export function readOrderCookie(ctx: { cookies: APIContext['cookies'] }): { id: number; key: string; seen: boolean } | null {
  const raw = ctx.cookies.get(ORDER_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; key?: unknown; seen?: unknown };
    if (typeof parsed.id === 'number' && typeof parsed.key === 'string' && parsed.key) {
      return { id: parsed.id, key: parsed.key, seen: parsed.seen === true };
    }
  } catch {
    /* ignore malformed cookie */
  }
  return null;
}

/** Ensure a Cart-Token exists; prime via GET /cart if missing (mutations need one). */
export async function ensureToken(ctx: APIContext): Promise<string | null> {
  const existing = readToken(ctx);
  if (existing) return existing;
  const primed = await getCart(null);
  if (!primed.ok) {
    console.warn(`[store-api] cart prime failed: ${primed.status}`);
  }
  writeToken(ctx, primed.cartToken);
  return primed.cartToken;
}

// The Store API's answer for a cart that was never started (ISK, as the store is), served without asking it (CO-02).
const ISK = {
  currency_code: 'ISK', currency_symbol: 'kr.', currency_minor_unit: 0, currency_decimal_separator: '.',
  currency_thousand_separator: '.', currency_prefix: '', currency_suffix: ' kr.',
};
const NO_ADDRESS = { first_name: '', last_name: '', company: '', address_1: '', address_2: '', city: '', state: '', postcode: '', country: 'IS', phone: '' };
export const EMPTY_CART: Cart = {
  items: [], items_count: 0, coupons: [], needs_payment: false, needs_shipping: false, has_calculated_shipping: false,
  shipping_rates: [], shipping_address: NO_ADDRESS, billing_address: { ...NO_ADDRESS, email: '' },
  totals: { ...ISK, total_items: '0', total_items_tax: '0', total_price: '0', total_shipping: '0', total_tax: '0', total_discount: '0' },
  payment_methods: [], errors: [],
};

/** GET /api/cart: every page view asks (the header badge). Without a cart token there is no cart, so the answer is
 *  the empty cart, from here: no WordPress round trip and no cookie for visitors who never touch the cart (CO-02).
 *  The first add primes a token (ensureToken). */
export async function readCart(ctx: APIContext): Promise<Response> {
  const token = readToken(ctx);
  if (!token) return new Response(JSON.stringify(EMPTY_CART), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return respondCart(ctx, await getCart(token));
}

/** Persist any rotated token and return the Store API result as a JSON Response. */
export function respondCart(ctx: APIContext, result: StoreResult<unknown>): Response {
  if (!result.ok) {
    const detail = typeof result.data === 'object' ? JSON.stringify(result.data).slice(0, 300) : String(result.data);
    console.warn(`[store-api] ${result.status}: ${detail}`);
  }
  writeToken(ctx, result.cartToken);
  return new Response(JSON.stringify(result.data), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------- per-visitor limit on cart line changes ----------
// Adding, changing and removing lines share one budget per visitor (WordPress only ever sees this server). 120 a
// minute is far beyond a shopper's clicking, and generous for a carrier-grade-NAT address shared by many phones.
// Reading the cart (every page view) is never limited, nor are the calls the checkout page makes (address, shipping
// rate, coupon): those sit in the payment flow and wait on the owner's sign-off (ticket 02).
const CART_WRITE_WINDOW_MS = 60 * 1000;
const cartWrites = createLimiter(120, CART_WRITE_WINDOW_MS);

/** A 429 when this visitor has used up the cart-change budget, else null (one slot used). */
export function limitCartWrite(ctx: APIContext): Response | null {
  return cartWrites.take(visitorKey(ctx)) ? null : tooManyRequests(CART_WRITE_WINDOW_MS / 1000);
}

// ---------- request validation helpers ----------

export function badRequest(message: string): Response {
  return jsonResponse({ message }, 400);
}

export async function readJson<T = Record<string, unknown>>(ctx: APIContext): Promise<T | null> {
  try {
    return (await ctx.request.json()) as T;
  } catch {
    return null;
  }
}

// The input guards live in the domain-neutral ./validate module; re-exported here so the
// cart routes that import them from cartProxy keep working unchanged.
export { isPosInt, isNonEmptyString, clampQty } from './validate';
