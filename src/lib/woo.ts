// WooCommerce REST v3 catalog client. SERVER-ONLY (uses consumer keys).
// Key contract facts baked in here:
//  - `category` filter takes the numeric ID, not the slug -> resolveCategoryId().
//  - always send status=publish; trim list payloads with _fields.
//  - pagination via X-WP-Total / X-WP-TotalPages headers.
import { WP_INTERNAL_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET } from 'astro:env/server';
import type { Paged, ProductQuery, WooCategory, WooProduct, WooVariation } from './types';

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
  const res = await fetch(`${BASE}${path}?${usp.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`WooCommerce GET ${path} -> ${res.status} ${res.statusText}`);
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
