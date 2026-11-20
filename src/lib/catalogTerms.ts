// Product categories, brands, Félag/Lið (team) and Íþrótt (sport) terms and tags from the Store API — SERVER-ONLY.
// Cached in-process for 10 minutes; concurrent cold callers share one sweep. On failure the last
// good value is served (stale beats an empty mega-filter). With nothing to serve, the result is an
// empty set flagged `degraded`, so routes answer 503 rather than 404 every category.
import { WP_INTERNAL_URL } from 'astro:env/server';
import { createCachedLoader } from './cache';
import { log } from './logger';
import { upstreamGet } from './upstream';
import { decodeEntities } from './decode';
import { COLOUR_TAXONOMY, SPORT_TAXONOMY, TEAM_TAXONOMY, type CatalogTerms, type CategoryTerm, type SizeIndexStatus, type SizeRef, type TermRef } from './liveFilters';

const STORE = `${WP_INTERNAL_URL}/wp-json/wc/store/v1`;
const TTL_MS = 10 * 60 * 1000;
/** Attribute ids on the site as of 2026-10-26, used only if the attribute list can't be read. */
const FALLBACK_ATTRIBUTE_IDS: Record<string, number> = { [TEAM_TAXONOMY]: 5, [SPORT_TAXONOMY]: 6, [COLOUR_TAXONOMY]: 2 };

/** The id of the global attribute with this taxonomy name (e.g. pa_felag-lid), from /products/attributes (null when
 *  that list couldn't be read: then `fallback`). When the list was read and doesn't have it: `fallback` again, or
 *  undefined for an `optional` attribute (its terms are then simply not loaded). */
export function attributeIdFor(
  attributes: { id: number; taxonomy: string }[] | null,
  taxonomy: string,
  fallback: number,
  optional = false,
): number | undefined {
  if (attributes === null) return fallback;
  return attributes.find((a) => a.taxonomy === taxonomy)?.id ?? (optional ? undefined : fallback);
}

interface RawTerm {
  id: number;
  name: string;
  slug: string;
  parent?: number;
  count?: number;
  description?: string;
}

export interface CatalogData extends CatalogTerms {
  tags: TermRef[];
  /** term id -> product count (categories/brands), as reported by the Store API. */
  counts: Map<number, number>;
  /** term id -> the term's own description (HTML) for categories/brands that have one. */
  descriptions?: Map<number, string>;
  /** True when the terms couldn't be loaded at all (WordPress down on a cold start). */
  degraded: boolean;
}

const fetchJson = (url: string): Promise<Response> => upstreamGet(url, 6000);
/** getAll reads at most this many pages of 100 terms. */
const MAX_TERM_PAGES = 20;

async function getAll(path: string): Promise<RawTerm[]> {
  const out: RawTerm[] = [];
  for (let page = 1; page <= MAX_TERM_PAGES; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetchJson(`${STORE}${path}${sep}per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`Store API ${path} -> ${res.status}`);
    const batch = (await res.json()) as RawTerm[];
    out.push(...batch);
    const totalPages = Number(res.headers.get('X-WP-TotalPages') ?? 1);
    if (page >= totalPages || batch.length < 100) break;
    if (page === MAX_TERM_PAGES) log.warn('[catalog-terms] term list cut at the page cap', { path, pages: MAX_TERM_PAGES, totalPages });
  }
  return out;
}

const toRef = (t: RawTerm): TermRef => ({ id: t.id, slug: t.slug, name: decodeEntities(t.name) });

type AttributeList = { id: number; taxonomy: string }[] | null;

/** Félag/Lið terms: a failure fails the sweep (the last good copy is served, so a team filter never silently stops
 *  filtering), by the looked-up id, or the known one when the list couldn't be read. A site whose attribute list lacks
 *  pa_felag-lid simply has no Félag/Lið group: asking for the known id there would 404 and degrade every listing. */
async function teamTerms(attributes: Promise<AttributeList>): Promise<RawTerm[]> {
  const id = attributeIdFor(await attributes, TEAM_TAXONOMY, FALLBACK_ATTRIBUTE_IDS[TEAM_TAXONOMY], true);
  if (id === undefined) {
    log.warn('[catalog-terms] no pa_felag-lid attribute on this site: the Félag/Lið filter is off');
    return [];
  }
  return getAll(`/products/attributes/${id}/terms`);
}

/** Íþrótt and Litur terms: optional. The known id is used only when the attribute list couldn't be read (a site whose
 *  list lacks the attribute gets none), and a failure leaves the group out instead of failing the whole sweep. */
async function optionalAttributeTerms(attributes: Promise<AttributeList>, taxonomy: string): Promise<RawTerm[]> {
  const id = attributeIdFor(await attributes, taxonomy, FALLBACK_ATTRIBUTE_IDS[taxonomy], true);
  if (id === undefined) return [];
  return getAll(`/products/attributes/${id}/terms`).catch((err: unknown) => {
    log.warn(`[catalog-terms] ${taxonomy} terms failed`, { err });
    return [];
  });
}

async function sweep(): Promise<CatalogData> {
  const attributes = fetchJson(`${STORE}/products/attributes`)
    .then((res) => (res.ok ? (res.json() as Promise<{ id: number; taxonomy: string }[]>) : null))
    .then((list): AttributeList => (Array.isArray(list) ? list : null))
    .catch((): AttributeList => null);
  const [cats, brands, teams, sports, colours, tags] = await Promise.all([
    // hide_empty=false: an existing but empty category still has a page (WooCommerce shows "no products").
    getAll('/products/categories?hide_empty=false'),
    getAll('/products/brands'),
    teamTerms(attributes),
    optionalAttributeTerms(attributes, SPORT_TAXONOMY),
    optionalAttributeTerms(attributes, COLOUR_TAXONOMY),
    getAll('/products/tags'),
  ]);
  const categories: CategoryTerm[] = cats.map((c) => ({ ...toRef(c), parent: c.parent ?? 0 }));
  const counts = new Map<number, number>();
  const descriptions = new Map<number, string>();
  for (const t of [...cats, ...brands]) {
    counts.set(t.id, t.count ?? 0);
    if (t.description) descriptions.set(t.id, t.description);
  }
  return {
    categories,
    brands: brands.map(toRef),
    teams: teams.map(toRef),
    sports: sports.map(toRef),
    colours: colours.map(toRef),
    tags: tags.map(toRef),
    counts,
    descriptions,
    degraded: false,
  };
}

const DEGRADED: CatalogData = { categories: [], brands: [], teams: [], sports: [], colours: [], tags: [], counts: new Map(), degraded: true };
// A cold failure is remembered for 15s so an outage doesn't make every request wait on the sweep.
const load = createCachedLoader({ load: sweep, ttlMs: TTL_MS, failMemoMs: 15 * 1000 });

export async function loadCatalogTerms(): Promise<CatalogData> {
  return (await load()).value ?? DEGRADED;
}

/** The term lists as held right now (null: none loaded yet), without waiting on WordPress or starting a load: for the
 *  middleware, which must not hold a stored page back for a term sweep. */
export function peekCatalogTerms(): CatalogData | null {
  return load.peek();
}

/** What the filter and the category rail offer from the term lists, as one comparable string: every term, and for
 *  categories and brands whether they have products (an empty one is not listed). A product count that merely grows
 *  changes nothing a shopper is offered, so it is not part of it. */
function offeredTerms(terms: CatalogData): string {
  // By id: WordPress lists terms by name, and two with the same name come back in either order.
  const byId = <T extends TermRef>(list: T[]) => [...list].sort((a, b) => a.id - b.id);
  const refs = (list: TermRef[]) => byId(list).map((t) => [t.id, t.slug, t.name]);
  const stocked = (list: TermRef[]) => byId(list).map((t) => (terms.counts.get(t.id) ?? 0) > 0);
  return JSON.stringify([byId(terms.categories).map((c) => [c.id, c.slug, c.name, c.parent]), stocked(terms.categories), refs(terms.brands),
    stocked(terms.brands), refs(terms.teams), refs(terms.sports), refs(terms.colours), refs(terms.tags)]);
}

/** Reloads the term lists and the size list now (the previous ones keep answering meanwhile) and resolves to whether
 *  what the filter offers changed. WordPress asks for this, through the shell poke, after a product save: the product
 *  can bring a team, brand, size or colour the filter has no option for yet, which would otherwise wait out the
 *  10-minute TTL. True tells the caller that pages rendered from the previous lists now show the wrong options. A list
 *  that was not held before had nothing rendered from it, so loading it is not a change; a failed reload keeps what
 *  was held and is no change either. */
export async function refreshCatalogTerms(): Promise<boolean> {
  const terms = load.peek();
  const sizes = loadSizes.peek();
  const [termsOk, sizesOk] = await Promise.all([load.refresh(), loadSizes.refresh()]);
  // The new option then waits for the next reload (a later save, or the lists' own ten minutes).
  if (!termsOk || !sizesOk) log.warn('[catalog-terms] reload after a product change failed', { terms: termsOk, sizes: sizesOk });
  const now = load.peek();
  const termsChanged = terms !== null && now !== null && offeredTerms(now) !== offeredTerms(terms);
  const sizesChanged = sizes !== null && JSON.stringify(loadSizes.peek()?.sizes ?? null) !== JSON.stringify(sizes.sizes);
  return termsChanged || sizesChanged;
}

// The size index (wp-mu-plugins/mos-size-index.php, GET mos/v1/sizes): every size with products. Loaded apart from
// the terms so a site without the plugin (production until it's uploaded) still has its filters: there the route is
// a 404, `staerd` is ignored and the Stærð group isn't shown. Any other failure is "down": a URL with `staerd` then
// answers 503 rather than silently dropping the filter (liveFilters.sizeIndexDecision).
async function sizeSweep(): Promise<{ sizes: SizeRef[] | null }> {
  const res = await fetchJson(`${WP_INTERNAL_URL}/wp-json/mos/v1/sizes`);
  if (res.status === 404) return { sizes: null }; // the plugin isn't installed
  if (!res.ok) throw new Error(`mos/v1/sizes -> ${res.status}`);
  const data = (await res.json()) as { sizes?: SizeRef[] };
  if (!Array.isArray(data.sizes)) throw new Error('mos/v1/sizes: no sizes');
  return { sizes: data.sizes.map(({ slug, label, group, sort }) => ({ slug, label: decodeEntities(label), group, sort })) };
}
const loadSizes = createCachedLoader({ load: sizeSweep, ttlMs: TTL_MS, failMemoMs: 60 * 1000 });

/** Every indexed size (status ok), or none: the size plugin isn't installed (absent) or the list can't be read
 *  (down; a stale list is still served as ok). */
export async function loadSizeTerms(): Promise<{ sizes: SizeRef[] | undefined; status: SizeIndexStatus }> {
  const loaded = await loadSizes();
  if (loaded.value === null) return { sizes: undefined, status: 'down' };
  return loaded.value.sizes ? { sizes: loaded.value.sizes, status: 'ok' } : { sizes: undefined, status: 'absent' };
}
