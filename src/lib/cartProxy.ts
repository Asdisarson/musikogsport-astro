// Server-side helpers for the /api/cart* proxy routes.
// The WooCommerce Store API guest session is a `Cart-Token` (JWT). We keep it in
// an httpOnly cookie, prime it via GET /cart when missing (the first mutation
// otherwise 401s for a missing nonce), and rotate it from every response.
import type { APIContext } from 'astro';
import { getCart, type StoreResult } from './storeApi';
import { jsonResponse } from './http';

const COOKIE = 'wc_cart_token';

function cookieOpts(maxAge = 60 * 60 * 24 * 2) {
  return {
    httpOnly: true,
    secure: import.meta.env.PROD, // must be false over http in dev or the cookie is dropped
    sameSite: 'lax' as const,
    path: '/',
    maxAge, // default 48h — matches the Cart-Token JWT lifetime
  };
}

export function readToken(ctx: APIContext): string | null {
  return ctx.cookies.get(COOKIE)?.value ?? null;
}

export function writeToken(ctx: APIContext, token: string | null | undefined): void {
  if (token) ctx.cookies.set(COOKIE, token, cookieOpts());
}

export function clearToken(ctx: APIContext): void {
  ctx.cookies.delete(COOKIE, { path: '/' });
}

// ---------- order-identity cookie ----------
// A short-lived httpOnly fallback so the thank-you page can recover the order on a
// refresh/bookmark. The post-payment redirect already carries order_id+order_key in
// the URL (the headless-bridge mu-plugin), so this is resilience, not the primary source.
const ORDER_COOKIE = 'mos_order';
const ORDER_COOKIE_TTL = 60 * 60 * 2; // 2h — long enough to view the receipt after returning from the gateway

export function writeOrderCookie(ctx: APIContext, order: { order_id: number; order_key: string }): void {
  if (!order?.order_id || !order?.order_key) return;
  ctx.cookies.set(ORDER_COOKIE, JSON.stringify({ id: order.order_id, key: order.order_key }), cookieOpts(ORDER_COOKIE_TTL));
}

// Accepts both APIContext (routes) and AstroGlobal (pages) — both expose `cookies`.
export function readOrderCookie(ctx: { cookies: APIContext['cookies'] }): { id: number; key: string } | null {
  const raw = ctx.cookies.get(ORDER_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; key?: unknown };
    if (typeof parsed.id === 'number' && typeof parsed.key === 'string' && parsed.key) {
      return { id: parsed.id, key: parsed.key };
    }
  } catch {
    /* ignore malformed cookie */
  }
  return null;
}

// One-shot consumption: clear the fallback cookie once the thank-you page has used it,
// so a later bare visit (no URL params) doesn't resurface a stale order.
export function clearOrderCookie(ctx: { cookies: APIContext['cookies'] }): void {
  ctx.cookies.delete(ORDER_COOKIE, { path: '/' });
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

// The input guards now live in the domain-neutral ./validate module; re-exported here so the
// cart routes that import them from cartProxy keep working unchanged.
export { isPosInt, isNonEmptyString, clampQty } from './validate';
