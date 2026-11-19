// Store API (/wc/store/v1/products) catalog reader — SERVER-ONLY.
//
// Why a second catalog client (woo.ts uses WC REST v3): the REST v3 /products
// endpoint can only filter ONE attribute taxonomy per request, so true faceted
// filtering (brand AND colour AND sport simultaneously) isn't expressible there.
// The Store API supports an `attributes[]` array with `attribute_relation=and`
// (OR within a facet, AND across facets), which is exactly the faceted-search
// semantic. It needs no consumer keys. We map its product shape back onto the
// WooProduct card subset so ProductGrid/ProductCard/PriceTag render unchanged.
import { WP_INTERNAL_URL } from 'astro:env/server';
import { createKeyedLoader, createTtlMap } from './cache';
import { upstreamGet } from './upstream';
import { log } from './logger';
import { createLimiter } from './rateLimit';
import { matchCountFromStock } from './facets';
import { COLOUR_TAXONOMY, SPORT_TAXONOMY, TEAM_TAXONOMY, type SizeRef } from './liveFilters';
import { mapStoreProduct, type StoreProductRaw } from './storeMap';
import type { AttributeFilter, Paged, WooProduct } from './types';

const BASE = `${WP_INTERNAL_URL}/wp-json/wc/store/v1`;

/** The store currency's minor unit as the last product response gave it (`prices.currency_minor_unit`); 0 (ISK)
 *  until one has. Price filters are sent in this unit (liveFilters.presetBounds). */
let minorUnit = 0;
export const currencyMinorUnit = (): number => minorUnit;
/** Live's catalog grid: woocommerce_catalog_columns (3) × woocommerce_catalog_rows (9). */
export const CATALOG_PER_PAGE = 27;

export interface StoreQuery {
  page?: number;
  per_page?: number;
  /** Main product_cat clause (OR). */
  categoryIds?: number[];
  /** Extra AND'ed product_cat clause (OR within) — the mos_and_cat extension (live's `kyn`). */
  andCategoryIds?: number[];
  brandIds?: number[];
  tagIds?: number[];
  attributes?: AttributeFilter[];
  /** mos_size index slugs (OR) — the size filter of wp-mu-plugins/mos-size-index.php. */
  sizeSlugs?: string[];
  /** Inclusive price bounds in the currency's minor unit (the Store API's; ISK has none: whole krónur). */
  minPrice?: number;
  maxPrice?: number;
  stockStatus?: string[];
  on_sale?: boolean;
  orderby?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

/** Append the shared catalog FILTER params that both the product grid and the facet-count
 *  requests must mirror, so the badge counts always match the grid. */
function appendFilters(usp: URLSearchParams, q: StoreQuery): void {
  if (q.categoryIds?.length) usp.set('category', q.categoryIds.join(','));
  if (q.andCategoryIds?.length) usp.set('mos_and_cat', q.andCategoryIds.join(','));
  if (q.brandIds?.length) usp.set('brand', q.brandIds.join(','));
  if (q.tagIds?.length) usp.set('tag', q.tagIds.join(','));
  if (q.sizeSlugs?.length) usp.set('mos_size', q.sizeSlugs.join(','));
  if (q.minPrice !== undefined) usp.set('min_price', String(q.minPrice));
  if (q.maxPrice !== undefined) usp.set('max_price', String(q.maxPrice));
  for (const status of q.stockStatus ?? []) usp.append('stock_status[]', status);
  if (q.on_sale) usp.set('on_sale', 'true');
  if (q.search) usp.set('search', q.search);

  const attrs = (q.attributes ?? []).filter((a) => a.taxonomy && a.termIds.length);
  attrs.forEach((a, i) => {
    usp.set(`attributes[${i}][attribute]`, a.taxonomy);
    for (const id of a.termIds) usp.append(`attributes[${i}][term_id][]`, String(id));
  });
  if (attrs.length) usp.set('attribute_relation', 'and');
}

/** Boundary fetch for this client: log once (the `[tag]` convention storeApi/woo follow), then
 *  re-throw unchanged so callers keep degrading through their existing `.catch`. Without this an
 *  outage renders an empty shop with no server-side trace at all. */
async function catalogFetch(url: string, what: string): Promise<Response> {
  let res: Response;
  try {
    res = await upstreamGet(url, 6000);
  } catch (err) {
    log.warn(`[store-catalog] ${what} transport failure`, { err });
    throw err;
  }
  if (!res.ok) {
    log.warn(`[store-catalog] ${what} -> ${res.status} ${res.statusText}`);
    throw new Error(`Store API ${what} -> ${res.status} ${res.statusText}`);
  }
  return res;
}

// The grid is held for a minute per request URL (stale-while-revalidate, lib/cache createKeyedLoader): a render never
// waits on WordPress for a grid it has seen, and a price or stock change shows within about a minute. Cart and
// checkout don't read this. Concurrent identical requests share one call, and while WordPress fails a URL isn't asked
// (and waited on) by every render: the failure is remembered for a few seconds (the caller degrades as it does for
// any failure, or keeps the last good grid). Per process, like the other caches.
const PRODUCTS_TTL_MS = 60 * 1000;
const PRODUCTS_MAX_STALE_MS = 5 * 60 * 1000; // a grid nobody asked for in that long is loaded afresh, not shown
const PRODUCTS_FAIL_MEMO_MS = 10 * 1000;
// After a poke (forgetAllGrids), every grid is asked for again: the key carries a generation (see lib/woo forgetProduct).
let gridGeneration = 0;
const productsByUrl = createKeyedLoader<Paged<WooProduct>>({
  load: (key) => {
    const url = key.slice(key.indexOf('|') + 1);
    return fetchProducts(url, Number(new URL(url).searchParams.get('page')));
  },
  ttlMs: PRODUCTS_TTL_MS,
  maxStaleMs: PRODUCTS_MAX_STALE_MS,
  failMemoMs: PRODUCTS_FAIL_MEMO_MS,
  maxEntries: 500,
});

export function storeProducts(q: StoreQuery = {}): Promise<Paged<WooProduct>> {
  const page = q.page && q.page > 0 ? q.page : 1;
  const per_page = q.per_page ?? CATALOG_PER_PAGE;
  const usp = new URLSearchParams();
  usp.set('page', String(page));
  usp.set('per_page', String(per_page));
  usp.set('orderby', q.orderby ?? 'date');
  usp.set('order', q.order ?? 'desc');
  appendFilters(usp, q);
  return productsByUrl(`${gridGeneration}|${BASE}/products?${usp.toString()}`);
}

/** After a catalogue change (a poke): every product grid is read again, not shown from the minute's cache. */
export function forgetAllGrids(): void {
  gridGeneration += 1;
}

async function fetchProducts(url: string, page: number): Promise<Paged<WooProduct>> {
  const res = await catalogFetch(url, 'products');
  const data = (await res.json()) as StoreProductRaw[];
  const mu = data[0]?.prices?.currency_minor_unit;
  if (typeof mu === 'number' && Number.isInteger(mu) && mu >= 0 && mu <= 4) minorUnit = mu;
  // Mirror wooGet's 0/0 fallback: if the pagination headers are ever absent, surface a
  // visible "0 vörur" rather than silently capping the catalog to one page of results.
  return {
    items: data.map(mapStoreProduct),
    total: Number(res.headers.get('X-WP-Total') ?? 0),
    totalPages: Number(res.headers.get('X-WP-TotalPages') ?? 0),
    page,
  };
}

interface CollectionData {
  attribute_counts?: { term: number; count: number }[] | null;
  taxonomy_counts?: { term: number; count: number }[] | null;
  stock_status_counts?: { status: string; count: number | string }[] | null;
  /** Added by mos-size-index.php when `mos_size_counts=1`: sizes for the filters minus the size filter. */
  mos_size_counts?: (SizeRef & { count: number })[] | null;
  /** Added by mos-size-index.php when `mos_extra_counts=1`: products per requested price range (`mos_price_ranges`)
   *  and, with `mos_sale_count=1`, on sale — each within every other filter. */
  mos_extra_counts?: { price?: (number | null)[] | null; on_sale?: number | null } | null;
}

/** Inclusive Store API price bounds (minor units); undefined = open. */
export interface PriceRange {
  min: number | undefined;
  max: number | undefined;
}

export interface CountsRequest {
  /** Taxonomies to count (e.g. product_cat, product_brand). An active filter on the same taxonomy
   *  self-applies, so OR-within counts need a request with that filter omitted. */
  taxonomies?: string[];
  /** pa_* attributes to count with query_type=or (count excludes its own selection). */
  attributes?: string[];
  /** Per-size counts (`mos_size_counts=1`); they leave the size filter out already. */
  sizes?: boolean;
  /** Stock-status counts (instock / outofstock / onbackorder). */
  stock?: boolean;
  /** Match counts the size plugin adds in the same request (`mos_extra_counts=1`): one per price range, with that
   *  range in place of the query's own price filter, and (onSale) with on_sale added. */
  extra?: { priceRanges: PriceRange[]; onSale: boolean };
}

export interface CountsResult {
  taxonomy: Map<number, number>;
  attribute: Map<number, number>;
  stock: Map<string, number>;
  /** Sizes with products for the query, sorted shoe → letter → kids → other; null when not asked for or the size
   *  index isn't installed. */
  sizes: (SizeRef & { count: number })[] | null;
  /** The `extra` counts in request order (undefined where one couldn't be counted); null when not asked for or the
   *  size plugin didn't answer them (not deployed): the caller then counts each with its own request. */
  extra: { price: (number | undefined)[]; onSale: number | undefined } | null;
}

const toMap = (rows: { term: number; count: number }[] | null | undefined) => new Map((rows ?? []).map((r) => [r.term, r.count]));

// Facet counts change only when the catalog does, and every filter click asks for a handful of them: a short
// in-process cache (keyed by the request URL) keeps sorting, paging and back/forward from asking again.
// The product grid is held for a minute too (PRODUCTS_TTL_MS), so counts and grid can disagree for about that long.
const COUNTS_TTL_MS = 30 * 1000; // 30 s: a shorter window for a stale dead-end option after a stock change
const clock = () => Date.now();
const countsCache = createTtlMap<string, CountsResult>(500, clock);
/** Requests in flight by URL: concurrent renders of the same filter combination share one. */
const countsInflight = new Map<string, Promise<CountsResult | null>>();
/** A failed count request is remembered this long per URL, so an outage isn't re-sent by every render. */
const COUNTS_FAIL_MEMO_MS = 15 * 1000;
const countsFailed = createTtlMap<string, true>(500, clock);
const COLLECTION_DATA_PATH = '/wc/store/v1/products/collection-data';

/** Cold collection-data requests (no fresh cached answer, none in flight) this process may send per minute. Every
 *  filter combination is a new URL and a cold filtered render sends up to 9, so a crawler walking combinations would
 *  otherwise multiply load on WordPress's PHP workers. Past it a listing renders without counts — the same path as
 *  a failed count request (options listed, no badges; the grid itself is unaffected) — or with stale ones. 240 is
 *  about 27 fully cold filtered renders a minute; cached combinations cost nothing. Per process (one instance). */
export const COLD_COUNTS_PER_MINUTE = 240;
const coldBudget = createLimiter(COLD_COUNTS_PER_MINUTE, 60 * 1000, clock);
let lastCapWarn = -Infinity;
const countOrUndefined = (n: unknown): number | undefined => (n == null ? undefined : typeof n === 'number' && Number.isFinite(n) ? n : Number(n) || 0);
const rangeParam = (r: PriceRange) => `${r.min ?? ''}:${r.max ?? ''}`;

/** Term counts (term_id -> products) for the products matching `q`, via the Store API collection-data endpoint —
 *  the same filters as the grid, so badges match it. Null when the request failed (the rail then lists options
 *  without counts); an empty result is empty maps, never null, so the rail can hide options without products. */
export async function collectionCounts(q: StoreQuery, req: CountsRequest): Promise<CountsResult | null> {
  const usp = new URLSearchParams();
  appendFilters(usp, q);
  (req.attributes ?? []).forEach((tax, i) => {
    usp.set(`calculate_attribute_counts[${i}][taxonomy]`, tax);
    usp.set(`calculate_attribute_counts[${i}][query_type]`, 'or');
  });
  (req.taxonomies ?? []).forEach((tax, i) => usp.set(`calculate_taxonomy_counts[${i}]`, tax));
  if (req.stock) usp.set('calculate_stock_status_counts', 'true');
  if (req.sizes) usp.set('mos_size_counts', '1');
  if (req.extra) {
    usp.set('mos_extra_counts', '1');
    if (req.extra.priceRanges.length) usp.set('mos_price_ranges', req.extra.priceRanges.map(rangeParam).join(','));
    if (req.extra.onSale) usp.set('mos_sale_count', '1');
  }
  const url = `${BASE}/products/collection-data?${usp.toString()}`;
  const hit = countsCache.get(url);
  if (hit?.fresh) return hit.value;
  const pending = countsInflight.get(url);
  if (pending) return pending;
  if (countsFailed.get(url)?.fresh) return hit?.value ?? null;
  if (!coldBudget.take('collection-data')) {
    if (clock() - lastCapWarn >= 60 * 1000) {
      lastCapWarn = clock();
      log.warn('[store-catalog] cold count budget spent; rendering listings without counts', { limit: COLD_COUNTS_PER_MINUTE });
    }
    return hit?.value ?? null;
  }
  const load = fetchCounts(url, req)
    .then((counts) => {
      if (counts) countsCache.set(url, counts, COUNTS_TTL_MS);
      else countsFailed.set(url, true, COUNTS_FAIL_MEMO_MS);
      return counts ?? hit?.value ?? null; // a stale count beats none
    })
    .finally(() => countsInflight.delete(url));
  countsInflight.set(url, load);
  return load;
}

/** One collection-data request; null when it failed (catalogFetch logs transport and HTTP failures, this logs a
 *  body that isn't the expected JSON, by path only: the query holds nothing secret, but it is noise). */
async function fetchCounts(url: string, req: CountsRequest): Promise<CountsResult | null> {
  let res: Response;
  try {
    res = await catalogFetch(url, 'collection-data');
  } catch {
    return null;
  }
  try {
    const data = (await res.json()) as CollectionData;
    const extra = data.mos_extra_counts;
    return {
      taxonomy: toMap(data.taxonomy_counts),
      attribute: toMap(data.attribute_counts),
      stock: new Map((data.stock_status_counts ?? []).map((r) => [r.status, Number(r.count) || 0])),
      sizes: req.sizes && Array.isArray(data.mos_size_counts) ? data.mos_size_counts : null,
      extra:
        req.extra && extra && typeof extra === 'object' && Array.isArray(extra.price)
          ? { price: req.extra.priceRanges.map((_, i) => countOrUndefined(extra.price?.[i])), onSale: req.extra.onSale ? countOrUndefined(extra.on_sale) : undefined }
          : null,
    };
  } catch (err) {
    log.error(`[store-catalog] ${COLLECTION_DATA_PATH}: unexpected response`, { err });
    return null;
  }
}

/** How many products match `q` — collection-data's stock-status counts summed (cheaper than a per_page=1 product
 *  query: ~43 ms against ~78 ms locally). Undefined when the request failed. */
export async function matchCount(q: StoreQuery): Promise<number | undefined> {
  const counts = await collectionCounts(q, { stock: true });
  return matchCountFromStock(counts?.stock, q.stockStatus);
}

export const COUNT_TAXONOMIES = {
  category: 'product_cat',
  brand: 'product_brand',
  team: TEAM_TAXONOMY,
  sport: SPORT_TAXONOMY,
  colour: COLOUR_TAXONOMY,
} as const;
