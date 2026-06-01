// Server-side helpers for the /api/cart* proxy routes.
// The WooCommerce Store API guest session is a `Cart-Token` (JWT). We keep it in
// an httpOnly cookie, prime it via GET /cart when missing (the first mutation
// otherwise 401s for a missing nonce), and rotate it from every response.
import type { APIContext } from 'astro';
import { getCart, type StoreResult } from './storeApi';

const COOKIE = 'wc_cart_token';

function cookieOpts() {
  return {
    httpOnly: true,
    secure: import.meta.env.PROD, // must be false over http in dev or the cookie is dropped
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 2, // 48h — matches the Cart-Token JWT lifetime
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
  return new Response(JSON.stringify({ message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function readJson<T = Record<string, unknown>>(ctx: APIContext): Promise<T | null> {
  try {
    return (await ctx.request.json()) as T;
  } catch {
    return null;
  }
}

export function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const MAX_QTY = 99;
export function clampQty(v: unknown): number {
  return isPosInt(v) ? Math.min(v, MAX_QTY) : 1;
}
