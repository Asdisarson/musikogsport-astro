// WooCommerce REST v3 catalog client. SERVER-ONLY (uses consumer keys).
// Key contract facts baked in here:
//  - `category` filter takes the numeric ID, not the slug -> resolveCategoryId().
//  - always send status=publish; trim list payloads with _fields.
//  - pagination via X-WP-Total / X-WP-TotalPages headers.
import { WP_INTERNAL_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET } from 'astro:env/server';
import type { Paged, ProductQuery, WooCategory, WooProduct, WooVariation } from './types';
import { isPosInt } from './validate';

const BASE = `${WP_INTERNAL_URL}/wp-json/wc/v3`;

// Fields needed by product cards/grids (keeps the 3,812-product payloads small).
const LIST_FIELDS = 'id,name,slug,type,price,regular_price,sale_price,on_sale,price_html,stock_status,images';

type Params = Record<string, string | number | boolean | number[] | undefined | null>;

async function wooGet<T>(path: string, params: Params = {}): Promise<{ data: T; total: number; totalPages: number }> {
  const usp = new URLSearchParams();
  usp.set('consumer_key', WOOCOMMERCE_CONSUMER_KEY);
  usp.set('consumer_secret', WOOCOMMERCE_CONSUMER_SECRET);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  // Hard timeout so a hung Woo backend can't pin the SSR worker (callers .catch() it).
  // We keep the throwing contract (callers degrade gracefully via .catch) but log the cause
  // ONCE here at the boundary — otherwise a full Woo outage degrades every SSR page silently.
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${usp.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    console.warn(
      `[woo] GET ${path} ${timedOut ? 'timed out (5s)' : 'failed'}: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  if (!res.ok) {
    // Log only server-side failures. A 4xx is expected here — getOrder() relies on the /orders
    // 404 for missing/enumerated orders (anti-enumeration), and the thank-you page polls it, so
    // logging 4xx would bury real outages in noise.
    if (res.status >= 500) console.warn(`[woo] GET ${path} -> ${res.status} ${res.statusText}`);
    throw new Error(`WooCommerce GET ${path} -> ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as T;
  return {
    data,
    total: Number(res.headers.get('X-WP-Total') ?? 0),
    totalPages: Number(res.headers.get('X-WP-TotalPages') ?? 0),
  };
}

export async function listProducts(q: ProductQuery = {}): Promise<Paged<WooProduct>> {
  const page = q.page && q.page > 0 ? q.page : 1;
  const per_page = q.per_page ?? 24;
  const { data, total, totalPages } = await wooGet<WooProduct[]>('/products', {
    status: 'publish',
    _fields: LIST_FIELDS,
    page,
    per_page,
    category: q.category,
    search: q.search,
    orderby: q.orderby ?? 'date',
    order: q.order ?? 'desc',
    on_sale: q.on_sale,
    stock_status: q.stock_status,
    featured: q.featured,
    include: q.include,
  });
  return { items: data, total, totalPages, page };
}

/** Full product object (no _fields) by slug, for the detail page. */
export async function getProductBySlug(slug: string): Promise<WooProduct | null> {
  const { data } = await wooGet<WooProduct[]>('/products', { slug, status: 'publish' });
  return data[0] ?? null;
}

export async function getVariations(productId: number): Promise<WooVariation[]> {
  const { data } = await wooGet<WooVariation[]>(`/products/${productId}/variations`, { per_page: 100 });
  return data;
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
}

interface WooOrder {
  id: number;
  number?: string | number;
  status?: string;
  order_key?: string;
  currency?: string;
  total?: string;
  payment_method?: string;
}

const PAID_STATUSES = new Set(['processing', 'completed']);

// Length-checked constant-ish compare so we don't leak order_key validity via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Fetch a single order, GATED BY its order_key (IDOR guard). WC REST returns the
 * order regardless of key because we authenticate with admin consumer creds, so we
 * MUST compare the order_key ourselves and refuse on mismatch. Returns only non-PII
 * summary fields, or null on not-found / key mismatch (callers should 404 either way
 * so order IDs can't be enumerated).
 */
export async function getOrder(id: number, key: string): Promise<OrderSummary | null> {
  if (!isPosInt(id) || !key) return null;
  let order: WooOrder;
  try {
    const { data } = await wooGet<WooOrder>(`/orders/${id}`, {
      _fields: 'id,number,status,order_key,currency,total,payment_method',
    });
    order = data;
  } catch {
    return null; // 404 / network — don't distinguish from a key mismatch
  }
  if (!order || typeof order.order_key !== 'string' || !safeEqual(order.order_key, key)) {
    return null;
  }
  const status = String(order.status ?? '');
  return {
    order_number: String(order.number ?? order.id ?? id),
    status,
    paid: PAID_STATUSES.has(status),
    total: String(order.total ?? ''),
    currency: String(order.currency ?? ''),
    payment_method: String(order.payment_method ?? ''),
  };
}

// ---------- categories + nav (cached per server process) ----------

const NAV_EXCLUDE = new Set(['uncategorized', 'oflokkad']);
const CACHE_TTL = 5 * 60 * 1000;
let navCache: { at: number; cats: WooCategory[] } | null = null;
const slugIdCache = new Map<string, number | null>();

/** Top-level categories for nav (parent=0, count>0, housekeeping buckets removed). */
export async function listTopCategories(): Promise<WooCategory[]> {
  if (navCache && Date.now() - navCache.at < CACHE_TTL) return navCache.cats;
  const { data } = await wooGet<WooCategory[]>('/products/categories', {
    parent: 0,
    per_page: 100,
    orderby: 'count',
    order: 'desc',
  });
  const cats = data.filter((c) => c.count > 0 && !NAV_EXCLUDE.has(c.slug));
  navCache = { at: Date.now(), cats };
  for (const c of cats) slugIdCache.set(c.slug, c.id);
  return cats;
}

export async function getCategoryBySlug(slug: string): Promise<WooCategory | null> {
  const { data } = await wooGet<WooCategory[]>('/products/categories', { slug });
  return data[0] ?? null;
}

/** Resolve a category slug to its numeric ID (required by the products `category` filter). */
export async function resolveCategoryId(slug: string): Promise<number | null> {
  if (slugIdCache.has(slug)) return slugIdCache.get(slug) ?? null;
  const cat = await getCategoryBySlug(slug);
  const id = cat?.id ?? null;
  slugIdCache.set(slug, id);
  return id;
}

export async function searchProducts(query: string, page = 1): Promise<Paged<WooProduct>> {
  return listProducts({ search: query, page, orderby: 'date' });
}

// ---------- facet term sources (brand + attributes, cached per process) ----------

export interface FacetTerm {
  id: number;
  name: string;
  slug: string;
  count: number;
}

const FACET_TTL = 10 * 60 * 1000;
const brandTermsCache: { at: number; terms: FacetTerm[] } = { at: 0, terms: [] };
const attrTermsCache = new Map<number, { at: number; terms: FacetTerm[] }>();

/** All non-empty product-brand terms (native Woo Brands taxonomy), by count desc. */
export async function listBrandTerms(): Promise<FacetTerm[]> {
  if (brandTermsCache.terms.length && Date.now() - brandTermsCache.at < FACET_TTL) return brandTermsCache.terms;
  const { data } = await wooGet<FacetTerm[]>('/products/brands', {
    per_page: 100,
    orderby: 'count',
    order: 'desc',
    hide_empty: true,
    _fields: 'id,name,slug,count',
  });
  brandTermsCache.at = Date.now();
  brandTermsCache.terms = data;
  return data;
}

/** All non-empty terms for a global attribute (by its numeric attribute ID), by count desc. */
export async function listAttributeTerms(attrId: number): Promise<FacetTerm[]> {
  const hit = attrTermsCache.get(attrId);
  if (hit && Date.now() - hit.at < FACET_TTL) return hit.terms;
  const { data } = await wooGet<FacetTerm[]>(`/products/attributes/${attrId}/terms`, {
    per_page: 100,
    orderby: 'count',
    order: 'desc',
    hide_empty: true,
    _fields: 'id,name,slug,count',
  });
  attrTermsCache.set(attrId, { at: Date.now(), terms: data });
  return data;
}

// ---------- sitemap helpers (cached per server process) ----------

// 6h: a full sitemap sweep is ~3k URLs / ~7s, far longer than a crawler's re-fetch interval, so a
// short TTL made nearly every crawl pay the cold cost. The in-flight guards below also collapse a
// burst of concurrent cold requests into a single sweep instead of N parallel ones.
const SITEMAP_TTL = 6 * 60 * 60 * 1000;
const MAX_PAGES = 200; // safety cap (~20k products at per_page=100)

interface ProductSlug {
  slug: string;
  modified?: string;
}

/** Mutable holder for a 6h-cached sitemap sweep with concurrent-request dedup + serve-stale-on-error. */
interface SweepCache<T> {
  at: number;
  val: T | null;
  inflight: Promise<T> | null;
}

/** Run a cached sweep: return fresh cache; else share an in-flight sweep across concurrent cold
 *  callers; on sweep failure, serve the stale value if we ever had one (so a transient Woo blip
 *  can't blank the sitemap) and only propagate the error on a truly cold start. */
function runSweep<T>(c: SweepCache<T>, sweep: () => Promise<T>): Promise<T> {
  if (c.val !== null && Date.now() - c.at < SITEMAP_TTL) return Promise.resolve(c.val);
  if (c.inflight) return c.inflight;
  const inflight = sweep()
    .then((val) => {
      c.at = Date.now();
      c.val = val;
      return val;
    })
    .catch((e) => {
      if (c.val !== null) return c.val; // serve stale rather than fail/blank
      throw e;
    })
    .finally(() => {
      c.inflight = null;
    });
  c.inflight = inflight;
  return inflight;
}

const productSlugSweep: SweepCache<ProductSlug[]> = { at: 0, val: null, inflight: null };
const allCatSweep: SweepCache<string[]> = { at: 0, val: null, inflight: null };

/** All published product slugs (+ lastmod) for the sitemap. Cached 6h; concurrent cold calls share one sweep. */
export function listAllProductSlugs(): Promise<ProductSlug[]> {
  return runSweep(productSlugSweep, async () => {
    const entries: ProductSlug[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, totalPages } = await wooGet<ProductSlug[]>('/products', {
        status: 'publish',
        _fields: 'slug,modified',
        per_page: 100,
        page,
        orderby: 'id',
        order: 'asc',
      });
      for (const p of data) if (p.slug) entries.push({ slug: p.slug, modified: p.modified });
      if (page >= totalPages || data.length === 0) break;
    }
    return entries;
  });
}

/** All product-category slugs that have products, for the sitemap. Cached 6h; concurrent cold calls share one sweep. */
export function listAllCategorySlugs(): Promise<string[]> {
  return runSweep(allCatSweep, async () => {
    const slugs: string[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, totalPages } = await wooGet<{ slug: string; count: number }[]>('/products/categories', {
        _fields: 'slug,count',
        per_page: 100,
        page,
      });
      for (const c of data) if (c.count > 0 && !NAV_EXCLUDE.has(c.slug)) slugs.push(c.slug);
      if (page >= totalPages || data.length === 0) break;
    }
    return slugs;
  });
}
