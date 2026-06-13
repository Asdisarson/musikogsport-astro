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
import { scaleMinor } from './format';
import { FACET_GROUPS } from './facets';
import type { AttributeFilter, Paged, WooProduct } from './types';

const BASE = `${WP_INTERNAL_URL}/wp-json/wc/store/v1`;

interface StorePrices {
  price: string;
  regular_price: string;
  sale_price: string;
  currency_minor_unit: number;
  price_range?: { min_amount: string; max_amount: string } | null;
}
interface StoreProductRaw {
  id: number;
  name: string;
  slug: string;
  type: WooProduct['type'];
  prices: StorePrices;
  price_html?: string;
  on_sale: boolean;
  is_in_stock: boolean;
  images?: { src: string; thumbnail?: string; alt?: string }[];
}

export interface StoreQuery {
  page?: number;
  per_page?: number;
  category?: number;
  brandIds?: number[];
  attributes?: AttributeFilter[];
  on_sale?: boolean;
  instock?: boolean;
  orderby?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

/** Map a Store API product onto the WooProduct fields the catalog cards consume. */
function mapStoreProduct(p: StoreProductRaw): WooProduct {
  const mu = p.prices?.currency_minor_unit ?? 0;
  const toMajor = (v: string | undefined) => (v == null || v === '' ? '' : String(scaleMinor(v, mu)));
  // Variable parents: show "frá {min}" exactly like the REST v3 path (search/home/related),
  // which returns the min `price` but blank regular/sale. Keep the min price, but BLANK
  // regular/sale so PriceTag can't draw a strikethrough from a min-sale and min-regular
  // pulled from *different* variations (the incoherent "frá X / was Y" bug). Net: every
  // surface renders a variable product identically as "frá {min}".
  const isVariable = p.type === 'variable';
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    price: toMajor(p.prices?.price),
    regular_price: isVariable ? '' : toMajor(p.prices?.regular_price),
    sale_price: isVariable ? '' : toMajor(p.prices?.sale_price),
    on_sale: Boolean(p.on_sale),
    price_html: p.price_html,
    stock_status: p.is_in_stock ? 'instock' : 'outofstock',
    // Keep src raw — productImage()/mediaUrl() rewrites local hosts at render time.
    images: (p.images ?? []).map((im) => ({ src: im.src, alt: im.alt ?? '' })),
    categories: [],
  };
}

/** Append the shared catalog FILTER params (category / brand / attributes / sale / stock /
 *  search) that both the product grid and the facet-count request must mirror, so the badge
 *  counts always match the grid. `omitBrand` drops the brand filter — used for OR-within brand
 *  counts, since the count endpoint self-applies an active brand. */
function appendFilters(usp: URLSearchParams, q: StoreQuery, opts: { omitBrand?: boolean } = {}): void {
  if (q.category) usp.set('category', String(q.category));
  if (!opts.omitBrand && q.brandIds?.length) usp.set('brand', q.brandIds.join(','));
  if (q.on_sale) usp.set('on_sale', 'true');
  if (q.instock) usp.set('stock_status', 'instock');
  if (q.search) usp.set('search', q.search);

  const attrs = (q.attributes ?? []).filter((a) => a.taxonomy && a.termIds.length);
  attrs.forEach((a, i) => {
    usp.set(`attributes[${i}][attribute]`, a.taxonomy);
    for (const id of a.termIds) usp.append(`attributes[${i}][term_id][]`, String(id));
  });
  if (attrs.length) usp.set('attribute_relation', 'and');
}

export async function storeProducts(q: StoreQuery = {}): Promise<Paged<WooProduct>> {
  const page = q.page && q.page > 0 ? q.page : 1;
  const per_page = q.per_page ?? 24;
  const usp = new URLSearchParams();
  usp.set('page', String(page));
  usp.set('per_page', String(per_page));
  usp.set('orderby', q.orderby ?? 'date');
  usp.set('order', q.order ?? 'desc');
  appendFilters(usp, q);

  const res = await fetch(`${BASE}/products?${usp.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Store API products -> ${res.status} ${res.statusText}`);
  const data = (await res.json()) as StoreProductRaw[];
  // Mirror wooGet's 0/0 fallback: if the pagination headers are ever absent, surface a
  // visible "0 vörur" rather than silently capping the catalog to one page of results.
  return {
    items: data.map(mapStoreProduct),
    total: Number(res.headers.get('X-WP-Total') ?? 0),
    totalPages: Number(res.headers.get('X-WP-TotalPages') ?? 0),
    page,
  };
}

// The attribute facets shown in the shop UI, derived from the single source of truth in facets.ts
// (so adding a facet there automatically counts it here). Counted with query_type=or so each count
// EXCLUDES its own facet selection (OR within) while APPLYING the others (AND across) — the
// standard layered-nav semantic.
const FACET_ATTR_TAXONOMIES = FACET_GROUPS.map((g) => g.taxonomy);
// Brand is a taxonomy, not a pa_* attribute, so it's counted via calculate_taxonomy_counts.
const BRAND_TAXONOMY = 'product_brand';

interface CollectionData {
  attribute_counts: { term: number; count: number }[] | null;
  taxonomy_counts: { term: number; count: number }[] | null;
}

async function fetchCollectionData(usp: URLSearchParams): Promise<CollectionData> {
  const res = await fetch(`${BASE}/products/collection-data?${usp.toString()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Store API collection-data -> ${res.status} ${res.statusText}`);
  return (await res.json()) as CollectionData;
}

/** Context-aware facet counts (WP term_id -> count) that MATCH the product grid, via the Store
 *  API collection-data endpoint, mirroring the same filters as `q`. Attribute facets use
 *  query_type=or (count excludes its own facet, applies the others). Brand self-applies an active
 *  brand filter, so when a brand is selected a 2nd brand-omitted request supplies OR-within brand
 *  counts. Returns an EMPTY map on any failure — the caller then renders no badge rather than the
 *  stale GLOBAL REST counts this replaces (those over-count by ~40%, up to 28x on category pages). */
export async function loadFacetCounts(q: StoreQuery = {}): Promise<Map<number, number>> {
  const brandActive = (q.brandIds?.length ?? 0) > 0;

  const p1 = new URLSearchParams();
  appendFilters(p1, q);
  FACET_ATTR_TAXONOMIES.forEach((tax, i) => {
    p1.set(`calculate_attribute_counts[${i}][taxonomy]`, tax);
    p1.set(`calculate_attribute_counts[${i}][query_type]`, 'or');
  });
  // When a brand is active, p1's brand counts would collapse to just that brand; defer brand
  // counting to p2 (brand omitted). Otherwise p1 can carry them.
  if (!brandActive) p1.set('calculate_taxonomy_counts[0]', BRAND_TAXONOMY);

  let p2: URLSearchParams | null = null;
  if (brandActive) {
    p2 = new URLSearchParams();
    appendFilters(p2, q, { omitBrand: true });
    p2.set('calculate_taxonomy_counts[0]', BRAND_TAXONOMY);
  }

  // allSettled (not all): a transient failure of one request must not blank EVERY badge. If only
  // p2 (brand) fails we still show the attribute counts from p1, and vice-versa; only a term whose
  // count genuinely wasn't fetched loses its badge.
  const counts = new Map<number, number>();
  const [r1s, r2s] = await Promise.allSettled([
    fetchCollectionData(p1),
    p2 ? fetchCollectionData(p2) : Promise.resolve(null),
  ]);
  if (r1s.status === 'fulfilled') {
    for (const a of r1s.value.attribute_counts ?? []) counts.set(a.term, a.count);
    // When no brand is active, p1 also carried the brand counts.
    if (!p2) for (const b of r1s.value.taxonomy_counts ?? []) counts.set(b.term, b.count);
  }
  if (p2 && r2s.status === 'fulfilled' && r2s.value) {
    for (const b of r2s.value.taxonomy_counts ?? []) counts.set(b.term, b.count);
  }
  return counts;
}
