// WooCommerce REST v3 client. SERVER-ONLY (uses consumer keys).
// Key contract facts baked in here:
//  - always send status=publish; trim list payloads with _fields.
//  - pagination via X-WP-Total / X-WP-TotalPages headers.
// The key pair is read when a request is made (getSecret), not at import, so `astro build` needs neither secret: the
// prerendered pages share chunks with this module. It travels in the Authorization header, which stays out of the
// web server's access log. Only a server that drops that header gets it as query params (see wooFetch), so nothing
// here logs or rethrows a URL unredacted (lib/logger redactSecrets).
import { WP_INTERNAL_URL, getSecret } from 'astro:env/server';
import { createKeyedLoader } from './cache';
import { log, redactSecrets } from './logger';
import { withoutStock, type CachedWooProduct, type CachedWooVariation, type WooProduct, type WooVariation } from './types';
import { isPosInt } from './validate';
import { orderAmounts } from './orderAmounts';
import { WOO_REST_TIMEOUT_MS } from './timeouts';
import { ATTEMPT_ID } from './attemptId';
import { readSnapshot, writeSnapshot } from './sweepSnapshot';

const BASE = `${WP_INTERNAL_URL}/wp-json/wc/v3`;

// Fields needed by product cards/grids (keeps the 3,812-product payloads small).
const LIST_FIELDS = 'id,name,slug,permalink,type,price,regular_price,sale_price,on_sale,price_html,stock_status,images,categories';
/** The stock fields the live answer needs for the purchasable maximum (livePrices.purchasableMax), on top of the card's. */
export const LIVE_STOCK_FIELDS = 'manage_stock,stock_quantity,backorders,backorders_allowed,sold_individually';
/** A live product lookup's fields: the card's plus LIVE_STOCK_FIELDS. Only the uncached live lookups use it. */
export const LIVE_PRODUCT_FIELDS = `${LIST_FIELDS},${LIVE_STOCK_FIELDS}`;

type Params = Record<string, string | number | boolean | number[] | undefined | null>;

let lastMissingLog = -Infinity;

type Credentials = { key: string; secret: string };

/** The REST key pair. Throws (no request is made) when either secret is unset, and says so in the log (at most once
 *  a minute): callers degrade quietly to the 503 outage page, which would otherwise look exactly like a WordPress
 *  outage. */
function credentials(): Credentials {
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
  return { key, secret };
}

/** How long the key pair keeps travelling in the URL after the header was refused and the URL accepted. Then the
 *  header is tried again: a refusal that was not about the header (a firewall's 403) does not last. */
const QUERY_AUTH_MS = 15 * 60 * 1000;
/** Until when the key pair travels in the URL (0: in the header). */
let queryAuthUntil = 0;

/**
 * One WooCommerce REST request with the key pair attached. The pair goes in the Authorization header. A web server
 * that drops that header before PHP makes WooCommerce answer 401 (never 403: that is a firewall, or a key without
 * the permission) to everything, so a 401 is asked once more with the pair in the URL. If that one succeeds, the
 * process keeps to the URL (one request per call) for QUERY_AUTH_MS and says so. Keys refused both ways are simply
 * refused: the answer is returned and the header is tried next time. Both attempts share the one time budget.
 */
async function wooFetch({ key, secret }: Credentials, path: string, params: URLSearchParams, init: RequestInit, timeoutMs: number): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  const send = (mode: 'header' | 'query'): Promise<Response> => {
    const usp = new URLSearchParams(params);
    const headers = new Headers(init.headers);
    if (mode === 'query') {
      usp.set('consumer_key', key);
      usp.set('consumer_secret', secret);
    } else {
      headers.set('Authorization', `Basic ${btoa(`${key}:${secret}`)}`);
    }
    const query = usp.toString();
    return fetch(`${BASE}${path}${query ? `?${query}` : ''}`, { ...init, headers, signal });
  };
  if (Date.now() < queryAuthUntil) return send('query');
  const res = await send('header');
  if (res.status !== 401) return res;
  void res.body?.cancel().catch(() => {}); // the refused answer is not read; a failed cancel changes nothing
  const retry = await send('query');
  if (retry.ok && Date.now() >= queryAuthUntil) {
    queryAuthUntil = Date.now() + QUERY_AUTH_MS;
    log.error(`[woo] ${init.method ?? 'GET'} ${path}: 401 with the keys in the Authorization header, ${retry.status} with the same keys in the URL: sending them in the URL for ${QUERY_AUTH_MS / 60_000} min (is the web server dropping the header?)`);
  }
  return retry;
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
  const keys = credentials();
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  // Hard timeout so a hung Woo backend can't pin the SSR worker. Errors still throw (callers degrade
  // via .catch), but the cause is logged ONCE here at the boundary — otherwise a full Woo outage
  // degrades every SSR page silently.
  let res: Response;
  try {
    res = await wooFetch(keys, path, usp, { headers: { Accept: 'application/json' } }, WOO_REST_TIMEOUT_MS);
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
  const keys = credentials();
  const usp = new URLSearchParams();
  if (fields) usp.set('_fields', fields);
  const init = { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await wooFetch(keys, path, usp, init, 10000).catch((err: unknown) => {
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

// The product page's two lookups are held for a minute each (stale-while-revalidate, lib/cache createKeyedLoader), so
// a product page that has been seen never waits on WordPress, and a price or stock change shows within about a
// minute. A slug with no product is held the same way (null). Cart and checkout don't read these: WooCommerce
// validates every add-to-cart itself. A failed lookup is remembered for a few seconds and thrown, as before.
const PRODUCT_TTL_MS = 60 * 1000;
const PRODUCT_MAX_STALE_MS = 5 * 60 * 1000; // a product nobody asked for in that long is loaded afresh, not shown
const PRODUCT_FAIL_MEMO_MS = 10 * 1000;

// Forgetting a product (forgetProduct, after a poke says it changed) is a new cache key: each key carries a
// generation, and the old entry ages out of the loader on its own. A process-wide base generation is used for the
// keys nobody forgot, and it moves when the maps below are cleared, so a cleared map can never bring back an old key.
// One counter numbers every generation, so a generation is never handed out twice (a cleared map can't bring back an
// old key that a later forget would collide with).
let generationSeq = 0;
let baseGeneration = 0;
const MAX_FORGOTTEN = 5000;
const productGen = new Map<string, number>(); // slug -> generation
const variationGen = new Map<number, number>(); // product id -> generation
const idBySlug = new Map<string, number>(); // slug -> product id, as last loaded
const generation = <K>(m: Map<K, number>, k: K): number => m.get(k) ?? baseGeneration;

// What a cache holds is stripped of stock before it is kept (types.withoutStock): the stock a page shows is read live.
const productBySlug = createKeyedLoader<CachedWooProduct | null>({
  load: async (key) => {
    const slug = key.slice(0, key.lastIndexOf('#'));
    const product = (await wooGet<WooProduct[]>('/products', { slug, status: 'publish' })).data[0] ?? null;
    if (product) idBySlug.set(slug, product.id);
    return product ? withoutStock(product) : null;
  },
  ttlMs: PRODUCT_TTL_MS,
  maxStaleMs: PRODUCT_MAX_STALE_MS,
  failMemoMs: PRODUCT_FAIL_MEMO_MS,
  maxEntries: 1000,
});

// A variable product's variations, every page of them. WooCommerce answers 100 a page. The pages are taken in id order,
// which is unique, so a tie in menu_order cannot move a variation across a page edge; the callers sort in menu order
// (the set and order WooCommerce matches in, lib/variations). More than MAX_VARIATION_PAGES pages is refused, never cut
// short: a partial list would show a size as unavailable with nothing saying so. The header is read on the first page,
// so a product over the limit costs one request, not five.
const VARIATION_PAGE = 100;
const MAX_VARIATION_PAGES = 5;
async function allVariations(productId: number, fields?: string, beforePage?: () => void): Promise<WooVariation[]> {
  const rows: WooVariation[] = [];
  for (let page = 1; page <= MAX_VARIATION_PAGES; page++) {
    if (page > 1) beforePage?.();
    const { data, totalPages } = await wooGet<WooVariation[]>(`/products/${productId}/variations`, {
      per_page: VARIATION_PAGE,
      page,
      status: 'publish',
      orderby: 'id',
      order: 'asc',
      _fields: fields,
    });
    if (page === 1 && totalPages > MAX_VARIATION_PAGES) break;
    rows.push(...data);
    // the short page is the last; the page count says so too, when WooCommerce sent it (0: header missing)
    if (data.length < VARIATION_PAGE || (totalPages > 0 && page >= totalPages)) return rows;
  }
  throw new Error(`product ${productId} has more than ${MAX_VARIATION_PAGES * VARIATION_PAGE} variations`);
}

const variationsByProduct = createKeyedLoader<CachedWooVariation[]>({
  load: async (key) => {
    const productId = key.slice(0, key.lastIndexOf('#'));
    const rows = await allVariations(Number(productId));
    return rows.map((v) => withoutStock(v)).sort((a, b) => (a.menu_order ?? 0) - (b.menu_order ?? 0) || a.id - b.id);
  },
  ttlMs: PRODUCT_TTL_MS,
  maxStaleMs: PRODUCT_MAX_STALE_MS,
  failMemoMs: PRODUCT_FAIL_MEMO_MS,
  maxEntries: 1000,
});

/** Full product object (no _fields, no stock) by slug, for the detail page. Shared between callers: read-only. */
export function getProductBySlug(slug: string): Promise<CachedWooProduct | null> {
  const s = slug.normalize('NFC');
  return productBySlug(`${s}#${generation(productGen, s)}`);
}

/** Whether the product loader holds a product (or a cached not-found answer) for this slug right now. Read-only: it does
 *  not load, so it costs no WooCommerce call. The shell poke uses it to forget a cached product for a path the store does
 *  not hold: a product read before a save would otherwise be kept on a page for a day. */
export function productCached(slug: string): boolean {
  const s = slug.normalize('NFC');
  return productBySlug.holds(`${s}#${generation(productGen, s)}`);
}

/** After a bulk change: every product and variation read goes to WooCommerce next (one step, no list). */
export function forgetAllProducts(): void {
  productGen.clear();
  variationGen.clear();
  baseGeneration = ++generationSeq;
}

/** After a poke: the next read of this product (and its variations) goes to WooCommerce, not to the cache. Never
 *  throws. */
export function forgetProduct(slug: string): void {
  const s = slug.normalize('NFC');
  if (productGen.size >= MAX_FORGOTTEN || variationGen.size >= MAX_FORGOTTEN) {
    productGen.clear();
    variationGen.clear();
    baseGeneration = ++generationSeq;
  }
  productGen.set(s, ++generationSeq);
  const id = idBySlug.get(s);
  if (id !== undefined) variationGen.set(id, ++generationSeq);
}

/** A variable product's published variations, in WooCommerce's matching order, without stock (see withoutStock).
 *  Shared between callers: read-only. */
export function getVariations(productId: number): Promise<CachedWooVariation[]> {
  return variationsByProduct(`${productId}#${generation(variationGen, productId)}`);
}

/**
 * A variable product's variations for STOCK, read from WooCommerce on every call and never held (no loader): stock
 * must always be the live figure. Sorted in matching order like getVariations. Only the fields the live answer needs.
 */
export async function getVariationStock(productId: number, beforePage?: () => void): Promise<WooVariation[]> {
  // beforePage runs before each WooCommerce page after the first: the live budget takes a token for each (lib/liveBudget).
  const rows = await allVariations(productId, `id,menu_order,price,regular_price,sale_price,on_sale,stock_status,${LIVE_STOCK_FIELDS}`, beforePage);
  return [...rows].sort((a, b) => (a.menu_order ?? 0) - (b.menu_order ?? 0) || a.id - b.id);
}

/**
 * Fetch specific products by ID (card fields only), preserving the requested order.
 * Used for the related-products strip on the PDP and the wishlist page. Caps the count
 * and silently drops anything not published. Chunks into batches of 100 because Woo REST
 * hard-caps `per_page` at 100 and silently drops ids past that — so a wishlist of >100
 * items would otherwise lose its oldest saves.
 */
export async function getProductsByIds(ids: number[], limit = 8, fields: string = LIST_FIELDS): Promise<WooProduct[]> {
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
        _fields: fields,
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

// ---------- sitemap helpers (cached per server process, with a copy on disk) ----------

// 6h: a full sweep is one request per 100 products (about 40 for this catalog), far longer than a crawler waits,
// so nobody waits for one unless there is nothing at all to serve:
//  - a stale list is served at once while one refresh runs in the background;
//  - a new server process starts from the last sweep's copy on disk (sweepSnapshot.ts);
//  - concurrent cold callers share one sweep.
const SITEMAP_TTL = 6 * 60 * 60 * 1000;
const MAX_PAGES = 200; // safety cap (~20k products at per_page=100)
/** After a failed sweep with a stale copy in hand, the stale copy is served this long before sweeping again. */
const SWEEP_RETRY_MS = 60 * 1000;
/** Pages of a sweep requested at the same time: a few, so a sweep does not crowd shoppers out of WordPress. */
const SWEEP_CONCURRENCY = 4;

interface ProductSlug {
  slug: string;
  permalink?: string;
  modified?: string;
}

/** Mutable holder for a 6h-cached sitemap sweep. */
interface SweepCache<T> {
  /** Names the copy on disk. */
  name: string;
  /** Whether a value read from disk has the shape this sweep produces. */
  valid: (val: unknown) => val is T;
  at: number;
  val: T | null;
  inflight: Promise<T> | null;
  /** When the last sweep failed (null after a success). */
  failedAt: number | null;
  /** The read of the copy on disk, started once per process. */
  restored: Promise<void> | null;
}

/** Take the copy on disk as this process's first value (once). */
function restoreSweep<T>(c: SweepCache<T>): Promise<void> {
  return (c.restored ??= readSnapshot(c.name).then((snap) => {
    if (c.val !== null || !snap) return;
    if (!c.valid(snap.val)) {
      log.warn(`[sitemap] the ${c.name} copy on disk has an unexpected shape; sweeping instead`);
      return;
    }
    c.val = snap.val;
    c.at = Math.min(snap.at, Date.now()); // a date ahead of this clock would keep the copy fresh too long
  }));
}

/** Run a cached sweep. Fresh: the cached value. Stale: the cached value at once, with one sweep started in the
 *  background (after a failed one, not again for SWEEP_RETRY_MS). Nothing cached: wait for the sweep, shared by
 *  concurrent callers, and throw if it fails. */
async function runSweep<T>(c: SweepCache<T>, sweep: () => Promise<T>): Promise<T> {
  if (c.val === null) await restoreSweep(c);
  const fresh = c.val !== null && Date.now() - c.at < SITEMAP_TTL;
  const backingOff = c.failedAt !== null && Date.now() - c.failedAt < SWEEP_RETRY_MS;
  if (c.val !== null && (fresh || backingOff)) return c.val;
  c.inflight ??= sweep()
    .then((val) => {
      c.at = Date.now();
      c.val = val;
      c.failedAt = null;
      void writeSnapshot(c.name, val);
      return val;
    })
    .catch((e) => {
      c.failedAt = Date.now();
      const hours = c.val === null ? null : Math.round((Date.now() - c.at) / 3_600_000);
      log.warn(`[sitemap] ${c.name} sweep failed; ${hours === null ? 'nothing to serve' : `serving the copy from ${hours} h ago`}`, { err: e });
      if (c.val !== null) return c.val; // serve stale rather than fail/blank
      throw e;
    })
    .finally(() => {
      c.inflight = null;
    });
  return c.val ?? c.inflight;
}

const productSlugSweep: SweepCache<ProductSlug[]> = {
  name: 'products',
  valid: (val): val is ProductSlug[] =>
    Array.isArray(val) && val.every((p) => typeof p?.slug === 'string' && isOptionalString(p.permalink) && isOptionalString(p.modified)),
  at: 0,
  val: null,
  inflight: null,
  failedAt: null,
  restored: null,
};

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

type SlugRow = { slug: string; permalink: string; date_modified_gmt?: string | null };

function productSlugPage(page: number): Promise<{ data: SlugRow[]; totalPages: number }> {
  return wooGet<SlugRow[]>('/products', {
    status: 'publish',
    _fields: 'slug,permalink,date_modified_gmt', // wc/v3 has no `modified`
    per_page: 100,
    page,
    orderby: 'id',
    order: 'asc',
  });
}

/** All published product slugs (+ lastmod) for the sitemap, in id order. See runSweep for how it is cached. */
export function listAllProductSlugs(): Promise<ProductSlug[]> {
  return runSweep(productSlugSweep, async () => {
    const first = await productSlugPage(1);
    const pages: SlugRow[][] = [first.data];
    const last = Math.min(first.totalPages, MAX_PAGES);
    // The first page says how many there are; the rest are fetched SWEEP_CONCURRENCY at a time.
    // One failed page fails the sweep, so the pages not yet asked for are skipped.
    let next = 2;
    let failed = false;
    const worker = async (): Promise<void> => {
      while (next <= last && !failed) {
        const page = next++;
        try {
          pages[page - 1] = (await productSlugPage(page)).data;
        } catch (err) {
          failed = true;
          throw err;
        }
      }
    };
    await Promise.all(Array.from({ length: SWEEP_CONCURRENCY }, worker));
    return pages.flatMap((rows) => rows.filter((p) => p.slug).map((p) => ({ slug: p.slug, permalink: p.permalink, modified: p.date_modified_gmt ?? undefined })));
  });
}

