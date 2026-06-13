// WooCommerce Store API client. Used SERVER-SIDE by /api/* proxy routes.
// Auth/session is carried by the `Cart-Token` header (a JWT). The token is
// returned (and may rotate) on every response — callers must persist the latest.
// CORS blocks the browser from calling WP directly, so all traffic flows through us.
import { WP_INTERNAL_URL } from 'astro:env/server';
import type { Address, Cart, CheckoutPayload, OrderResult } from './types';

const STORE_BASE = `${WP_INTERNAL_URL}/wp-json/wc/store/v1`;

export interface StoreResult<T> {
  status: number;
  ok: boolean;
  data: T;
  /** Latest Cart-Token from the response header (persist & resend it). */
  cartToken: string | null;
}

async function storeFetch<T>(
  path: string,
  opts: { method?: string; body?: unknown; cartToken?: string | null } = {},
): Promise<StoreResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.cartToken) headers['Cart-Token'] = opts.cartToken;
  const method = opts.method ?? 'GET';

  let res: Response;
  try {
    res = await fetch(`${STORE_BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      // Generous backstop only — this path is request-scoped (/api/* routes, never page SSR),
      // and shipping calc + order placement call Pósturinn's external rate API which can take
      // several seconds (some postcodes ~4s warm). A tight timeout would abort valid checkouts.
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    // Transport failure, or the 25s timeout firing (AbortSignal.timeout → TimeoutError). Don't
    // throw: callers (checkout/cart routes) hand us straight to respondCart, which would otherwise
    // surface a raw 500 with no trace on the money path. Log once here and return a non-ok result
    // so respondCart emits a localized {message} and a real HTTP status. cartToken stays null —
    // writeToken's truthy-guard then preserves the shopper's existing Cart-Token cookie.
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    console.warn(
      `[store-api] ${method} ${path} ${timedOut ? 'timed out' : 'failed'}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      status: timedOut ? 504 : 502,
      ok: false,
      data: { message: 'Þjónustan svaraði ekki, reyndu aftur.' } as T,
      cartToken: null,
    };
  }

  const cartToken = res.headers.get('Cart-Token');
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, ok: res.ok, data: data as T, cartToken };
}

export const getCart = (token?: string | null) => storeFetch<Cart>('/cart', { cartToken: token });

export const addItem = (
  body: { id: number; quantity: number; variation?: { attribute: string; value: string }[] },
  token?: string | null,
) => storeFetch<Cart>('/cart/add-item', { method: 'POST', body, cartToken: token });

export const updateItem = (body: { key: string; quantity: number }, token?: string | null) =>
  storeFetch<Cart>('/cart/update-item', { method: 'POST', body, cartToken: token });

export const removeItem = (body: { key: string }, token?: string | null) =>
  storeFetch<Cart>('/cart/remove-item', { method: 'POST', body, cartToken: token });

export const selectShippingRate = (body: { rate_id: string; package_id?: number | string }, token?: string | null) =>
  storeFetch<Cart>('/cart/select-shipping-rate', { method: 'POST', body, cartToken: token });

export const updateCustomer = (
  body: { billing_address?: Partial<Address>; shipping_address?: Partial<Address> },
  token?: string | null,
) => storeFetch<Cart>('/cart/update-customer', { method: 'POST', body, cartToken: token });

export const applyCoupon = (body: { code: string }, token?: string | null) =>
  storeFetch<Cart>('/cart/apply-coupon', { method: 'POST', body, cartToken: token });

export const removeCoupon = (body: { code: string }, token?: string | null) =>
  storeFetch<Cart>('/cart/remove-coupon', { method: 'POST', body, cartToken: token });

export const checkout = (body: CheckoutPayload, token?: string | null) =>
  storeFetch<OrderResult>('/checkout', { method: 'POST', body, cartToken: token });
