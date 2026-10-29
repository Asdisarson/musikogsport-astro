// WooCommerce REST v3 client. SERVER-ONLY (uses consumer keys).
// Key contract facts baked in here:
//  - always send status=publish; trim list payloads with _fields.
//  - pagination via X-WP-Total / X-WP-TotalPages headers.
// The key pair is read when a request is made (getSecret), not at import, so `astro build` needs neither secret: the
// prerendered pages share chunks with this module. It travels as query params, so nothing here logs or rethrows a
// URL unredacted (lib/logger redactSecrets).
import { WP_INTERNAL_URL, getSecret } from 'astro:env/server';
import { log, redactSecrets } from './logger';
import type { WooProduct, WooVariation } from './types';
import { isPosInt } from './validate';
import { orderAmounts } from './orderAmounts';
import { WOO_REST_TIMEOUT_MS } from './timeouts';
import { ATTEMPT_ID } from './attemptId';

const BASE = `${WP_INTERNAL_URL}/wp-json/wc/v3`;

// Fields needed by product cards/grids (keeps the 3,812-product payloads small).
const LIST_FIELDS = 'id,name,slug,permalink,type,price,regular_price,sale_price,on_sale,price_html,stock_status,images,categories';

type Params = Record<string, string | number | boolean | number[] | undefined | null>;

let lastMissingLog = -Infinity;

/** The REST key pair as query params. Throws (no request is made) when either secret is unset, and says so in the
 *  log (at most once a minute): callers degrade quietly to the 503 outage page, which would otherwise look exactly
 *  like a WordPress outage. */
function authParams(): URLSearchParams {
  const key = getSecret('WOOCOMMERCE_CONSUMER_KEY');
  const secret = getSecret('WOOCOMMERCE_CONSUMER_SECRET');
  if (!key || !secret) {
    const msg = 'WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET is not set';
    if (Date.now() - lastMissingLog >= 60_000) {
      lastMissingLog = Date.now();
      log.error(`[woo] ${msg}: every WooCommerce REST call fails until both are set`);
    }
    throw new Error(msg);
  }
  return new URLSearchParams({ consumer_key: key, consumer_secret: secret });
}

/** `err` with any credential in its message blanked (a fetch TypeError can quote the whole URL), for rethrowing. */
function scrubbed(err: unknown): unknown {
  if (err instanceof Error) {
    const clean = redactSecrets(err.message);
    if (clean !== err.message) {
      try {
        err.message = clean;
      } catch {
        return new Error(clean);
      }
    }
  }
  return err;
}

/** A WooCommerce REST answer that wasn't 2xx, with its status: callers tell "not there" (404, 400) from an outage
 *  (a transport failure is a plain Error, a 5xx this with status >= 500). */
export class WooHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WooHttpError';
    this.status = status;
  }
}

export async function wooGet<T>(path: string, params: Params = {}): Promise<{ data: T; total: number; totalPages: number }> {
  const usp = authParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  // Hard timeout so a hung Woo backend can't pin the SSR worker. Errors still throw (callers degrade
  // via .catch), but the cause is logged ONCE here at the boundary — otherwise a full Woo outage
  // degrades every SSR page silently.
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${usp.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(WOO_REST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    log.warn(`[woo] GET ${path} ${timedOut ? `timed out (${WOO_REST_TIMEOUT_MS / 1000}s)` : 'failed'}`, { err });
    throw scrubbed(err);
  }
  if (!res.ok) {
    // Log only server-side failures. A 4xx is expected here — getOrder() relies on the /orders
    // 404 for missing/enumerated orders (anti-enumeration), and the thank-you page polls it, so
    // logging 4xx would bury real outages in noise.
    if (res.status >= 500) log.warn(`[woo] GET ${path} -> ${res.status} ${res.statusText}`);
    throw new WooHttpError(`WooCommerce GET ${path} -> ${res.status} ${res.statusText}`, res.status);
  }
  const data = (await res.json()) as T;
  return {
    data,
    total: Number(res.headers.get('X-WP-Total') ?? 0),
    totalPages: Number(res.headers.get('X-WP-TotalPages') ?? 0),
  };
}

/** Write to WC REST v3 (PUT/POST) with the server-side keys. Throws with Woo's message on failure.
 *  `fields` trims the response (`_fields`), which also spares WooCommerce serialising a whole order. */
export async function wooSend<T>(method: 'POST' | 'PUT', path: string, body: unknown, fields?: string): Promise<T> {
  const usp = authParams();
  if (fields) usp.set('_fields', fields);
  const res = await fetch(`${BASE}${path}?${usp.toString()}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  }).catch((err: unknown) => {
    log.warn(`[woo] ${method} ${path} failed`, { err });
    throw scrubbed(err);
  });
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) {
    // Server failures and refused credentials (401/403: the consumer keys) are ours to fix; other 4xx are
    // the request's own (e.g. an invalid email), answered with WooCommerce's message.
    if (res.status >= 500 || res.status === 401 || res.status === 403) log.warn(`[woo] ${method} ${path} -> ${res.status} ${res.statusText}`);
    throw new Error(typeof data?.message === 'string' ? data.message : `WooCommerce ${method} ${path} -> ${res.status}`);
  }
  return data as T;
}

/** Full product object (no _fields) by slug, for the detail page. */
export async function getProductBySlug(slug: string): Promise<WooProduct | null> {
  const { data } = await wooGet<WooProduct[]>('/products', { slug, status: 'publish' });
  return data[0] ?? null;
}

export async function getVariations(productId: number): Promise<WooVariation[]> {
  // The set and order WooCommerce matches in (lib/variations): published only, menu_order then id
  // (find_matching_product_variation). REST has no id tie-break, so sort here as well.
  const { data } = await wooGet<WooVariation[]>(`/products/${productId}/variations`, { per_page: 100, status: 'publish', orderby: 'menu_order', order: 'asc' });
  return [...data].sort((a, b) => (a.menu_order ?? 0) - (b.menu_order ?? 0) || a.id - b.id);
}

/**
 * Fetch specific products by ID (card fields only), preserving the requested order.
 * Used for the related-products strip on the PDP and the wishlist page. Caps the count
 * and silently drops anything not published. Chunks into batches of 100 because Woo REST
 * hard-caps `per_page` at 100 and silently drops ids past that — so a wishlist of >100
 * items would otherwise lose its oldest saves.
 */
export async function getProductsByIds(ids: number[], limit = 8): Promise<WooProduct[]> {
  // De-dupe first: WC `include` collapsed duplicates, so a dirty related_ids list like [5,5,7]
  // must not re-emit product 5 twice now that we re-key the result ourselves.
  const wanted = [...new Set(ids.filter(isPosInt))].slice(0, limit);
  if (wanted.length === 0) return [];
  const BATCH = 100;
  const batches: number[][] = [];
  for (let i = 0; i < wanted.length; i += BATCH) batches.push(wanted.slice(i, i + BATCH));
  const pages = await Promise.all(
    batches.map((batch) =>
      wooGet<WooProduct[]>('/products', {
        status: 'publish',
        _fields: LIST_FIELDS,
        include: batch,
        per_page: batch.length,
        orderby: 'include',
      }).then((r) => r.data),
    ),
  );
  // orderby=include only orders WITHIN a batch; re-key by id and re-emit in the requested order.
  const byId = new Map(pages.flat().map((p) => [p.id, p]));
  return wanted.map((id) => byId.get(id)).filter((p): p is WooProduct => p != null);
}

// ---------- single order lookup (order-status / thank-you page) ----------

/** Non-PII order summary returned to the storefront. */
export interface OrderSummary {
  order_number: string;
  status: string;
  paid: boolean;
  total: string;
  currency: string;
  payment_method: string;
  /** Thank-you page details — no email or address (the key may travel in a shared URL). */
  payment_method_title: string;
  date_created: string;
  items: { name: string; quantity: number; total: string }[];
  shipping: { title: string; total: string }[];
  discount_total: string;
}

interface WooOrder {
  id: number;
  number?: string | number;
  status?: string;
  order_key?: string;
  currency?: string;
  total?: string;
  payment_method?: string;
  payment_method_title?: string;
  date_created?: string;
  discount_total?: string;
  discount_tax?: string;
  line_items?: { name?: string; quantity?: number; subtotal?: string; subtotal_tax?: string }[];
  shipping_lines?: { method_title?: string; total?: string; total_tax?: string }[];
}

const PAID_STATUSES = new Set(['processing', 'completed']);

// Length-checked constant-ish compare so we don't leak order_key validity via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The receipt lookup's answer (LC-13): a miss (no such order, or the key doesn't match: indistinguishable on
 *  purpose, so order ids can't be enumerated) is told apart from an outage, which callers answer with 503 and never
 *  count against the visitor. */
export type OrderLookup = { state: 'found'; order: OrderSummary } | { state: 'not-found' } | { state: 'unavailable' };

/** A WooCommerce answer that means "no such order" (404, or a 400 for an id it can't take). Anything else that
 *  fails (no answer, a 5xx, refused or unset keys, a 429) is an outage. */
function isOrderMiss(err: unknown): boolean {
  return err instanceof WooHttpError && (err.status === 404 || err.status === 400 || err.status === 410);
}

/**
 * Fetch a single order, GATED BY its order_key (IDOR guard). WC REST returns the
 * order regardless of key because we authenticate with admin consumer creds, so we
 * MUST compare the order_key ourselves and refuse on mismatch. The summary has only
 * non-PII fields. A key mismatch reads exactly like a missing order (callers 404
 * either way so order IDs can't be enumerated); an outage is 'unavailable'.
 */
export async function lookupOrder(id: number, key: string): Promise<OrderLookup> {
  if (!isPosInt(id) || !key) return { state: 'not-found' };
  let order: WooOrder;
  try {
    const { data } = await wooGet<WooOrder>(`/orders/${id}`, {
      _fields: 'id,number,status,order_key,currency,total,payment_method,payment_method_title,date_created,discount_total,discount_tax,line_items,shipping_lines',
    });
    order = data;
  } catch (err) {
    return isOrderMiss(err) ? { state: 'not-found' } : { state: 'unavailable' };
  }
  if (!order || typeof order.order_key !== 'string' || !safeEqual(order.order_key, key)) {
    return { state: 'not-found' };
  }
  const status = String(order.status ?? '');
  const amounts = orderAmounts(order);
  return {
    state: 'found',
    order: {
      order_number: String(order.number ?? order.id ?? id),
      status,
      paid: PAID_STATUSES.has(status),
      total: String(order.total ?? ''),
      currency: String(order.currency ?? ''),
      payment_method: String(order.payment_method ?? ''),
      payment_method_title: String(order.payment_method_title ?? ''),
      date_created: String(order.date_created ?? ''),
      // Pre-coupon line amounts plus one discount row, incl. tax (see orderAmounts).
      items: amounts.items,
      shipping: amounts.shipping,
      discount_total: String(amounts.discount),
    },
  };
}

// ---------- checkout recovery (LM-01) ----------

/** The order meta key wp-mu-plugins/mos-checkout-fields.php stores the attempt id under. */
const ATTEMPT_META = '_mos_checkout_attempt';

/** What the recovery needs of an order: never shown to the shopper as is. */
export interface AttemptOrder {
  id: number;
  status: string;
  order_key: string;
  payment_method: string;
}

interface WooAttemptRow {
  id?: unknown;
  status?: unknown;
  order_key?: unknown;
  payment_method?: unknown;
  meta_data?: { key?: unknown; value?: unknown }[];
}

/**
 * The order a checkout attempt created, or null when there is none (yet). Asks the WC REST orders collection
 * filtered by the attempt meta (the `mos_attempt` query filter in mos-checkout-fields.php), and takes only a row that
 * really carries this attempt: a WordPress without that filter would answer the store's newest orders. Read-only.
 * Throws on an outage, so the caller can say the outcome is unknown.
 */
export async function findAttemptOrder(attempt: string): Promise<AttemptOrder | null> {
  if (!ATTEMPT_ID.test(attempt)) return null;
  const { data } = await wooGet<WooAttemptRow[]>('/orders', {
    mos_attempt: attempt,
    include_meta: ATTEMPT_META,
    per_page: 5,
    orderby: 'id',
    order: 'desc',
    _fields: 'id,status,order_key,payment_method,meta_data',
  });
  const row = (Array.isArray(data) ? data : []).find(
    (o) => Array.isArray(o?.meta_data) && o.meta_data.some((m) => m?.key === ATTEMPT_META && m?.value === attempt),
  );
  if (!row || !isPosInt(row.id) || typeof row.order_key !== 'string' || !row.order_key) return null;
  return { id: row.id, status: String(row.status ?? ''), order_key: row.order_key, payment_method: String(row.payment_method ?? '') };
}

// ---------- sitemap helpers (cached per server process) ----------

// 6h: a full sitemap sweep is ~3k URLs / ~7s, far longer than a crawler's re-fetch interval, so a
// short TTL made nearly every crawl pay the cold cost. The in-flight guards below also collapse a
// burst of concurrent cold requests into a single sweep instead of N parallel ones.
const SITEMAP_TTL = 6 * 60 * 60 * 1000;
const MAX_PAGES = 200; // safety cap (~20k products at per_page=100)
/** After a failed sweep with a stale copy in hand, the stale copy is served this long before sweeping again. */
const SWEEP_RETRY_MS = 60 * 1000;

interface ProductSlug {
  slug: string;
  permalink?: string;
  modified?: string;
}

/** Mutable holder for a 6h-cached sitemap sweep with concurrent-request dedup + serve-stale-on-error. */
interface SweepCache<T> {
  at: number;
  val: T | null;
  inflight: Promise<T> | null;
  /** When the last sweep failed (null after a success). */
  failedAt: number | null;
}

/** Run a cached sweep: return fresh cache; else share an in-flight sweep across concurrent cold
 *  callers; on sweep failure, serve the stale value if we ever had one (so a transient Woo blip
 *  can't blank the sitemap) and only propagate the error on a truly cold start. */
function runSweep<T>(c: SweepCache<T>, sweep: () => Promise<T>): Promise<T> {
  if (c.val !== null && Date.now() - c.at < SITEMAP_TTL) return Promise.resolve(c.val);
  if (c.val !== null && c.failedAt !== null && Date.now() - c.failedAt < SWEEP_RETRY_MS) return Promise.resolve(c.val);
  if (c.inflight) return c.inflight;
  const inflight = sweep()
    .then((val) => {
      c.at = Date.now();
      c.val = val;
      c.failedAt = null;
      return val;
    })
    .catch((e) => {
      c.failedAt = Date.now();
      if (c.val !== null) return c.val; // serve stale rather than fail/blank
      throw e;
    })
    .finally(() => {
      c.inflight = null;
    });
  c.inflight = inflight;
  return inflight;
}

const productSlugSweep: SweepCache<ProductSlug[]> = { at: 0, val: null, inflight: null, failedAt: null };

/** All published product slugs (+ lastmod) for the sitemap. Cached 6h; concurrent cold calls share one sweep. */
export function listAllProductSlugs(): Promise<ProductSlug[]> {
  return runSweep(productSlugSweep, async () => {
    const entries: ProductSlug[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, totalPages } = await wooGet<ProductSlug[]>('/products', {
        status: 'publish',
        _fields: 'slug,permalink,modified',
        per_page: 100,
        page,
        orderby: 'id',
        order: 'asc',
      });
      for (const p of data) if (p.slug) entries.push({ slug: p.slug, permalink: p.permalink, modified: p.modified });
      if (page >= totalPages || data.length === 0) break;
    }
    return entries;
  });
}

