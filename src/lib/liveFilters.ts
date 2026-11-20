// Live musikogsport.is filter URLs ("Product Filters for WooCommerce" config on the Goya site)
// mapped onto Store API query parameters. Pure — no server imports.
//
//   kyn=konur,born           children of the "Kyn" product category  -> extra AND'ed category clause
//   product-category=a,b     product categories (OR)                 -> main category clause
//   brand=casall,move-active product_brand (OR)                      -> brand
//   team=liverpool           pa_felag-lid attribute (OR)             -> attributes[]
//   ithrott=sund,golf        pa_ithrott attribute (OR)               -> attributes[]
//   litur=svartur,blar       pa_litur attribute (OR)                 -> attributes[]
//   staerd=42,42-5,m         mos_size index slugs (OR)               -> mos_size (wp-mu-plugins/mos-size-index.php)
//   verd=5000-10000          one price preset (single-valued)        -> min_price / max_price
//   utsala=1                 on sale only                            -> on_sale=true
//   lager=1                  in stock only                           -> stock_status[]=instock
//   orderby=…                WooCommerce catalog ordering values
//   s=…                      search
//
// The extra clause is the `mos_and_cat` Store API extension in wp-mu-plugins/mos-headless-api.php:
// one request can't otherwise express "category X AND (konur OR born)".
import type { AttributeFilter } from './types';

export interface TermRef {
  id: number;
  slug: string;
  name: string;
}
export interface CategoryTerm extends TermRef {
  parent: number;
}
/** A size in the mos_size index (group: shoe | letter | kids | other, sort: the size's order within it). */
export interface SizeRef {
  slug: string;
  label: string;
  group: string;
  sort: number;
}
export interface CatalogTerms {
  categories: CategoryTerm[];
  brands: TermRef[];
  teams: TermRef[];
  /** pa_ithrott (Íþrótt) terms. */
  sports: TermRef[];
  /** pa_litur (Litur) terms. */
  colours: TermRef[];
  /** Every indexed size; undefined when the size index isn't available (staerd is then ignored). */
  sizes?: SizeRef[];
}

export const KYN_PARENT_SLUG = 'kyn';
export const TEAM_TAXONOMY = 'pa_felag-lid';
export const SPORT_TAXONOMY = 'pa_ithrott';
export const COLOUR_TAXONOMY = 'pa_litur';
export const FILTER_KEYS = ['product-category', 'kyn', 'brand', 'team', 'staerd', 'verd', 'utsala', 'lager', 'ithrott', 'litur'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
/** The keys holding a comma list of values (all but the price preset and the flags). */
type ListKey = Exclude<FilterKey, 'verd' | 'utsala' | 'lager'>;
/** Keys that hold one value (a price preset) or a flag ("1"), not a comma list. */
const SINGLE_KEYS: ReadonlySet<FilterKey> = new Set(['verd', 'utsala', 'lager']);

/** Price presets (no slider: one variation is priced at 111,299,090 kr.). Bounds are whole krónur (ISK has no
 *  minor unit) and the Store API's min_price/max_price are inclusive, so each upper bound is one króna below the
 *  next preset's lower bound: a 5.000 kr. product is in "5.000–10.000", not also in "Undir 5.000". Single-valued:
 *  choosing a preset replaces the current one, choosing the current one clears it (a checkbox that unticks itself,
 *  so the options keep role="checkbox" like every other filter link). */
export const PRICE_PRESETS = [
  { key: '0-5000', label: 'Undir 5.000 kr.', min: undefined, max: 4999 },
  { key: '5000-10000', label: '5.000–10.000 kr.', min: 5000, max: 9999 },
  { key: '10000-20000', label: '10.000–20.000 kr.', min: 10000, max: 19999 },
  { key: '20000-', label: 'Yfir 20.000 kr.', min: 20000, max: undefined },
] as const satisfies readonly { key: string; label: string; min: number | undefined; max: number | undefined }[];
export type PriceKey = (typeof PRICE_PRESETS)[number]['key'];
export type PricePreset = (typeof PRICE_PRESETS)[number];
export const pricePreset = (key: string | null): PricePreset | undefined => PRICE_PRESETS.find((p) => p.key === key);

/** A preset's Store API bounds (min_price / max_price are in the currency's minor unit, both inclusive). The upper
 *  bound is one minor unit below the next preset's lower bound, so with decimals 4.999,99 kr. still counts as
 *  "Undir 5.000". `minorUnit` is the Store API's `currency_minor_unit` (ISK: 0, where this is the whole krónur). */
export function presetBounds(p: PricePreset, minorUnit = 0): { min: number | undefined; max: number | undefined } {
  const scale = 10 ** Math.max(0, Math.trunc(minorUnit));
  return {
    min: p.min === undefined ? undefined : p.min * scale,
    max: p.max === undefined ? undefined : (p.max + 1) * scale - 1,
  };
}

const ORDERINGS = {
  menu_order: { orderby: 'menu_order', order: 'asc' },
  popularity: { orderby: 'popularity', order: 'desc' },
  rating: { orderby: 'rating', order: 'desc' },
  date: { orderby: 'date', order: 'desc' },
  price: { orderby: 'price', order: 'asc' },
  'price-desc': { orderby: 'price', order: 'desc' },
} as const;
export type OrderKey = keyof typeof ORDERINGS;
const DEFAULT_ORDER: OrderKey = 'date'; // woocommerce_default_catalog_orderby

/** The sort dropdown exactly as live offers it (menu_order/rating still parse from URLs). */
export const SORT_OPTIONS: { key: OrderKey; label: string }[] = [
  { key: 'popularity', label: 'Raða eftir vinsældum' },
  { key: 'date', label: 'Raða eftir nýjast' },
  { key: 'price', label: 'Raða eftir verði: lægst fyrst' },
  { key: 'price-desc', label: 'Raða eftir verði: hæst fyrst' },
];

/** The size index as the storefront found it: loaded, not installed (mos/v1/sizes is a 404), or failing. */
export type SizeIndexStatus = 'ok' | 'absent' | 'down';

/** What to do with `staerd`: filter by it; ignore it (no size plugin, or nothing asked while the list is down; the
 *  Stærð group is then left out); or answer 503 (sizes asked for while the list is down: dropping the filter would
 *  show unfiltered products as if they matched). */
export function sizeIndexDecision(requested: boolean, status: SizeIndexStatus): 'apply' | 'ignore' | 'unavailable' {
  if (status === 'ok') return 'apply';
  return requested && status === 'down' ? 'unavailable' : 'ignore';
}

export interface LiveFilterState {
  kyn: string[];
  brand: string[];
  team: string[];
  productCategory: string[];
  staerd: string[];
  ithrott: string[];
  litur: string[];
  verd: PriceKey | null;
  utsala: boolean;
  lager: boolean;
  orderby: OrderKey;
  search: string | null;
}

export interface StoreFilter {
  categoryIds?: number[];
  andCategoryIds?: number[];
  brandIds?: number[];
  attributes?: AttributeFilter[];
  sizeSlugs?: string[];
  minPrice?: number;
  maxPrice?: number;
  onSale?: boolean;
  stockStatus?: string[];
  orderby: string;
  order: 'asc' | 'desc';
  search?: string;
}

/** The most values one comma list (brand, kyn, team, product-category, ithrott, litur) keeps: far above any real filter,
 *  and unknown slugs are dropped later anyway, but a hand-built URL can't make the server walk thousands. */
export const MAX_LIST_PARAM = 50;
/** The search text is cut to this many characters: it goes to WooCommerce search and into the page title. */
export const MAX_SEARCH_LENGTH = 100;

function csv(value: string | null, max = MAX_LIST_PARAM): string[] {
  return [...new Set((value ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, max);
}

const SIZE_SLUG = /^[a-z0-9-]{1,40}$/;
/** The most sizes one URL filters by: the size plugin's MOS_SIZE_MAX_PARAM (wp-mu-plugins/mos-size-index.php). */
export const MAX_SIZE_PARAM = 60;

/** The most values a shopper plausibly picks in one list filter, and across all of them together. */
export const MAX_PICKED_PER_FILTER = 6;
export const MAX_PICKED_TOTAL = 12;
const LIST_PARAMS = ['kyn', 'brand', 'team', 'product-category', 'ithrott', 'litur'] as const;

/** Whether a listing URL picks more filter values than a shopper does (2026-11-19: a scraper walked URLs with 8–14
 *  teams each, every one a fresh WooCommerce query). The middleware sends these to the unfiltered listing without
 *  asking WordPress. Sizes keep their own limit (MAX_SIZE_PARAM): a shopper does tick many. */
export function excessiveFilterQuery(params: URLSearchParams): boolean {
  let total = 0;
  for (const key of LIST_PARAMS) {
    const picked = csv(params.get(key), Infinity).length;
    if (picked > MAX_PICKED_PER_FILTER) return true;
    total += picked;
  }
  return total > MAX_PICKED_TOTAL;
}

/** Where an over-filtered page URL is sent: the same path without its filters (the search text `s=` is kept by the
 *  middleware, which appends it), or null to serve the request as it is. Never for API routes or assets (`/_astro/`),
 *  and never a path a browser would read as another host (`//host`, `/\\host`). */
export function unfilteredTarget(pathname: string, params: URLSearchParams): string | null {
  if (pathname.startsWith('/api/') || pathname.startsWith('/_') || /^\/[/\\]/.test(pathname)) return null;
  return excessiveFilterQuery(params) ? pathname : null;
}

/** Whether a listing is filtered by stock (Á lager, `lager=1`). Its membership and counts change with stock, so it is
 *  never kept in the page store and its counts and grid are read from WordPress on each request (lib/shellPolicy,
 *  lib/storeCatalog, components/ArchiveView). Pure. */
export function isStockFiltered(params: URLSearchParams): boolean {
  return params.get('lager') === '1';
}

export function parseLiveFilters(params: URLSearchParams): LiveFilterState {
  const orderby = params.get('orderby') ?? '';
  const search = Array.from(params.get('s')?.trim() ?? '').slice(0, MAX_SEARCH_LENGTH).join('').trim();
  return {
    kyn: csv(params.get('kyn')),
    brand: csv(params.get('brand')),
    team: csv(params.get('team')),
    productCategory: csv(params.get('product-category')),
    staerd: [...new Set(csv(params.get('staerd'), Infinity).map((s) => s.toLowerCase()))].filter((s) => SIZE_SLUG.test(s)).slice(0, MAX_SIZE_PARAM),
    ithrott: csv(params.get('ithrott')),
    litur: csv(params.get('litur')),
    verd: pricePreset(params.get('verd'))?.key ?? null,
    utsala: params.get('utsala') === '1',
    lager: params.get('lager') === '1',
    orderby: Object.hasOwn(ORDERINGS, orderby) ? (orderby as OrderKey) : DEFAULT_ORDER,
    search: search ? search : null,
  };
}

/** Resolve slugs against terms, keeping request order; returns matched ids + slugs. */
function resolve(slugs: string[], pool: TermRef[]): { ids: number[]; slugs: string[] } {
  const bySlug = new Map(pool.map((t) => [t.slug, t.id]));
  const out = { ids: [] as number[], slugs: [] as string[] };
  for (const s of slugs) {
    const id = bySlug.get(s);
    if (id != null) {
      out.ids.push(id);
      out.slugs.push(s);
    }
  }
  return out;
}

/** Colour terms that are another colour under a different name (the owner, 2026-10-30: "Mahagony Red is just red"):
 *  choosing the colour also matches them, and the Litur filter doesn't list them (facets isPlainColour). */
export const MERGED_COLOURS: Readonly<Record<string, readonly string[]>> = { raudur: ['mahagony-red'] };

/** The pa_litur term ids a colour filter matches: the chosen ones (`ids`, in `slugs` order) and the terms merged into
 *  them (MERGED_COLOURS) that the term list has, each once. */
export function colourTermIds(slugs: string[], ids: number[], colours: TermRef[]): number[] {
  const merged = slugs.flatMap((s) => (Object.hasOwn(MERGED_COLOURS, s) ? MERGED_COLOURS[s] : [])).flatMap((m) => colours.filter((c) => c.slug === m).map((c) => c.id));
  return [...new Set([...ids, ...merged])];
}

/** `minorUnit`: the Store API's currency_minor_unit, which the price bounds are given in (see presetBounds). */
export function toStoreFilter(
  state: LiveFilterState,
  terms: CatalogTerms,
  baseCategoryId?: number,
  minorUnit = 0,
): { filter: StoreFilter; active: Partial<Record<FilterKey, string[]>>; activeCount: number } {
  const kynParent = terms.categories.find((c) => c.slug === KYN_PARENT_SLUG);
  const kynPool = kynParent ? terms.categories.filter((c) => c.parent === kynParent.id) : [];

  const pc = resolve(state.productCategory, terms.categories);
  const kyn = resolve(state.kyn, kynPool);
  const brand = resolve(state.brand, terms.brands);
  const team = resolve(state.team, terms.teams);
  const sport = resolve(state.ithrott, terms.sports);
  const colour = resolve(state.litur, terms.colours);
  // With the size index installed, any well-formed slug is passed on (parseLiveFilters checked the shape): the
  // cached size list can be up to 10 minutes behind, and the plugin answers an unknown size with no products.
  const sizes = terms.sizes ? state.staerd : [];
  const price = pricePreset(state.verd);
  const bounds = price ? presetBounds(price, minorUnit) : undefined;

  const filter: StoreFilter = { ...ORDERINGS[state.orderby] };
  const categoryIds = pc.ids.length ? pc.ids : baseCategoryId ? [baseCategoryId] : [];
  if (categoryIds.length) filter.categoryIds = categoryIds;
  if (kyn.ids.length) filter.andCategoryIds = kyn.ids;
  if (brand.ids.length) filter.brandIds = brand.ids;
  const attributes: AttributeFilter[] = [];
  if (team.ids.length) attributes.push({ taxonomy: TEAM_TAXONOMY, termIds: team.ids });
  if (sport.ids.length) attributes.push({ taxonomy: SPORT_TAXONOMY, termIds: sport.ids });
  if (colour.ids.length) attributes.push({ taxonomy: COLOUR_TAXONOMY, termIds: colourTermIds(colour.slugs, colour.ids, terms.colours) });
  if (attributes.length) filter.attributes = attributes;
  if (sizes.length) filter.sizeSlugs = sizes;
  if (bounds?.min !== undefined) filter.minPrice = bounds.min;
  if (bounds?.max !== undefined) filter.maxPrice = bounds.max;
  if (state.utsala) filter.onSale = true;
  if (state.lager) filter.stockStatus = ['instock'];
  if (state.search) filter.search = state.search;

  const active: Partial<Record<FilterKey, string[]>> = {};
  if (pc.slugs.length) active['product-category'] = pc.slugs;
  if (kyn.slugs.length) active.kyn = kyn.slugs;
  if (brand.slugs.length) active.brand = brand.slugs;
  if (team.slugs.length) active.team = team.slugs;
  if (sport.slugs.length) active.ithrott = sport.slugs;
  if (colour.slugs.length) active.litur = colour.slugs;
  if (sizes.length) active.staerd = sizes;
  if (price) active.verd = [price.key];
  if (state.utsala) active.utsala = ['1'];
  if (state.lager) active.lager = ['1'];
  const activeCount = Object.values(active).reduce((n, v) => n + (v?.length ?? 0), 0);
  return { filter, active, activeCount };
}

/** `base` + the query, always without `page` (any filter change lands on page 1). */
export function withQuery(base: string, params: URLSearchParams): string {
  params.delete('page');
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** A list key's values as parseLiveFilters reads them (trimmed, deduplicated; sizes lower-cased and checked). */
function listValues(params: URLSearchParams, key: ListKey): string[] {
  if (key !== 'staerd') return csv(params.get(key));
  return parseLiveFilters(params).staerd;
}

/** Href toggling one filter value on/off; always lands on page 1 (the base path). A single-valued key (the price
 *  preset, the utsala/lager flags) is replaced, or removed when it already holds `slug`. A list key is rewritten
 *  from its parsed values, so a value spelled differently in the URL (`staerd=M`) is still removed by its chip
 *  (`m`), and duplicates and malformed sizes are dropped on the way. */
export function toggleFilterHref(base: string, params: URLSearchParams, key: FilterKey, slug: string): string {
  const p = new URLSearchParams(params);
  if (SINGLE_KEYS.has(key)) {
    if (p.get(key) === slug) p.delete(key);
    else p.set(key, slug);
    return withQuery(base, p);
  }
  const current = listValues(p, key as ListKey);
  const value = key === 'staerd' ? slug.trim().toLowerCase() : slug.trim();
  const next = current.includes(value) ? current.filter((s) => s !== value) : [...current, value];
  if (next.length) p.set(key, next.join(','));
  else p.delete(key);
  return withQuery(base, p);
}

/** Href clearing one filter group (its key), keeping the other filters, the sort order and search. */
export function clearFilterHref(base: string, params: URLSearchParams, key: FilterKey): string {
  const p = new URLSearchParams(params);
  p.delete(key);
  return withQuery(base, p);
}

/** Href clearing every filter but keeping the sort order and search. */
export function clearFiltersHref(base: string, params: URLSearchParams): string {
  const p = new URLSearchParams(params);
  for (const k of FILTER_KEYS) p.delete(k);
  return withQuery(base, p);
}
