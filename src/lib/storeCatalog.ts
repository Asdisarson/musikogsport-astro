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
import type { Paged, WooProduct } from './types';

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

/** One attribute facet: a taxonomy + the term IDs selected within it (OR'd together). */
export interface AttributeFilter {
  taxonomy: string; // e.g. "pa_litur"
  termIds: number[];
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
  // Variable parents have no single price. The Store API collapses them to a min value
  // (and min sale/regular drawn from *different* variations), which would make PriceTag
  // draw a misleading "frá X / strikethrough Y". The REST v3 path (search, home, related)
  // returns EMPTY price fields for variable parents so PriceTag renders price_html — the
  // genuine WooCommerce range/"was" display. Mirror that contract so every surface agrees.
  const isVariable = p.type === 'variable';
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    price: isVariable ? '' : toMajor(p.prices?.price),
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

export async function storeProducts(q: StoreQuery = {}): Promise<Paged<WooProduct>> {
  const page = q.page && q.page > 0 ? q.page : 1;
  const per_page = q.per_page ?? 24;
  const usp = new URLSearchParams();
  usp.set('page', String(page));
  usp.set('per_page', String(per_page));
  usp.set('orderby', q.orderby ?? 'date');
  usp.set('order', q.order ?? 'desc');
  if (q.category) usp.set('category', String(q.category));
  if (q.brandIds?.length) usp.set('brand', q.brandIds.join(','));
  if (q.on_sale) usp.set('on_sale', 'true');
  if (q.instock) usp.set('stock_status', 'instock');
  if (q.search) usp.set('search', q.search);

  const attrs = (q.attributes ?? []).filter((a) => a.taxonomy && a.termIds.length);
  attrs.forEach((a, i) => {
    usp.set(`attributes[${i}][attribute]`, a.taxonomy);
    for (const id of a.termIds) usp.append(`attributes[${i}][term_id][]`, String(id));
  });
  if (attrs.length) usp.set('attribute_relation', 'and');

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
