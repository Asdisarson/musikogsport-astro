// Which rendered pages the shell store keeps, for how long, and under which key. Pure; SERVER-ONLY by use
// (src/lib/shellStore.ts, src/middleware.ts).
//
// A stored page is the same HTML a fresh render would give, so the only things that decide whether it may be kept
// are the URL (is it per-visitor, an endpoint, or a page whose output depends on a query?) and the response (see
// src/middleware.ts). Freshness is a plain age: inside `freshMs` a stored page is served as it is; past it, it is
// still served at once and rendered again in the background (stale-while-revalidate).
import { isPersonalPath } from './cachePolicy';
import { FILTER_KEYS, MAX_PICKED_TOTAL, excessiveFilterQuery, parseLiveFilters } from './liveFilters';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
export const FRESH_MS = { product: 24 * HOUR, content: 24 * HOUR, listing: 5 * MIN, filtered: 2 * MIN } as const;
/** Past this age a stored page is dropped rather than served. */
export const HARD_MAX_AGE_MS = 7 * 24 * HOUR;
/** Filtered URLs are memory only and no more than this many are kept (an open-ended set of combinations). */
export const FILTERED_LIMIT = 500;

export type ShellTier = 'product' | 'content' | 'listing' | 'filtered';
export interface ShellPolicy {
  tier: ShellTier;
  freshMs: number;
  /** Kept in memory only (never written to disk). */
  memoryOnly: boolean;
}

/** The archive's filter and sort parameters (lib/liveFilters) and nothing else: ?sent, ?error, ?postlisti and ?s
 *  change the page's content in ways not worth a stored copy, so such URLs are not stored at all. */
const SAFE_QUERY: ReadonlySet<string> = new Set<string>([...FILTER_KEYS, 'orderby']);

const NEVER = [/^\/api(\/|$)/, /^\/_server-islands(\/|$)/, /^\/_image(\/|$)/, /^\/_astro(\/|$)/];
const LISTING = [/^\/$/, /^\/page(\/|$)/, /^\/verslun\/?$/, /^\/verslun\/page(\/|$)/, /^\/(voruflokkur|brand|merkimidar)(\/|$)/];
/** A product page by its URL: /vara/<slug>/. A catalogue URL (/verslun/…) cannot tell a product from a category (a
 *  category can sit three levels down too), so those are listings unless the product page says it is one: see
 *  setShellTier in lib/shellIncomplete. */
const PRODUCT = [/^\/vara\/[^/]+\/?$/];

/** One form for every path the store, the poke and the page keys compare: percent-decoded (when the bytes are valid
 *  UTF-8) and NFC-normalised, so an Icelandic slug is one string however it was encoded. */
export function normalPath(p: string): string {
  let out = p;
  try {
    out = decodeURI(p);
  } catch {
    out = p; // not valid percent-encoding: compare as it is
  }
  return out.normalize('NFC');
}

const SLUG_VALUE = /^[\p{Ll}\p{N}_-]{1,100}$/u;
const FLAG_KEYS = new Set(['utsala', 'lager']);

/** Whether a filtered URL's values are ones the archive can really produce: a known sort, a known price preset, a
 *  flag as 1, and slug-shaped terms within the picking limits. Any other value would give a new key per value. */
export function storableFilterQuery(search: URLSearchParams): boolean {
  if (excessiveFilterQuery(search)) return false;
  let picked = 0;
  // A sort or price value is known when the archive's own parser keeps it as it is.
  for (const [k, v] of search.entries()) {
    if (k === 'orderby' || k === 'verd') {
      const parsed = parseLiveFilters(new URLSearchParams([[k, v]]));
      if ((k === 'orderby' ? parsed.orderby : parsed.verd) !== v) return false;
    } else if (FLAG_KEYS.has(k)) {
      if (v !== '1') return false;
    } else {
      for (const part of v.split(',')) {
        if (!SLUG_VALUE.test(part.toLowerCase())) return false;
        picked += 1;
      }
    }
  }
  return picked <= MAX_PICKED_TOTAL * 2; // the picking limit with some room for sizes
}

interface KnownTerms {
  categories: { slug: string }[];
  brands: { slug: string }[];
  teams: { slug: string }[];
  sports: { slug: string }[];
  colours: { slug: string }[];
  tags?: { slug: string }[];
  sizes?: { slug: string }[];
}

/** Whether every filter value in the query is a term the catalogue has (the terms the listing pages already load), so
 *  that a filtered page kept in memory is one a shopper can reach, not one a crawler made up. Pure. */
export function filterValuesKnown(search: URLSearchParams, terms: KnownTerms): boolean {
  const pool = (...lists: ({ slug: string }[] | undefined)[]) => new Set(lists.flatMap((l) => (l ?? []).map((t) => t.slug.toLowerCase())));
  const known: Record<string, Set<string>> = {
    'product-category': pool(terms.categories, terms.tags),
    kyn: pool(terms.categories, terms.tags),
    brand: pool(terms.brands),
    team: pool(terms.teams),
    ithrott: pool(terms.sports),
    litur: pool(terms.colours),
    staerd: pool(terms.sizes),
  };
  for (const [k, v] of search.entries()) {
    const set = known[k];
    if (!set) continue; // sort, price and flags are checked by storableFilterQuery
    for (const part of v.split(',')) {
      if (!set.has(part.toLowerCase())) return false;
    }
  }
  return true;
}

/** The store policy for a GET page request, or null when the page must not be stored. */
export function shellPolicy(pathname: string, search: URLSearchParams): ShellPolicy | null {
  if (NEVER.some((re) => re.test(pathname)) || isPersonalPath(pathname)) return null;
  const keys = [...new Set([...search.keys()])];
  if (keys.some((k) => !SAFE_QUERY.has(k))) return null;
  if (keys.length > 0) {
    // Only the archive pages take filters; a filter on anything else is a different page.
    if (!LISTING.some((re) => re.test(pathname)) && !pathname.startsWith('/verslun/')) return null;
    if (PRODUCT.some((re) => re.test(pathname))) return null;
    // Only filter combinations the archive can produce get a key: each junk value would be a page held in memory.
    if (!storableFilterQuery(search)) return null;
    return { tier: 'filtered', freshMs: FRESH_MS.filtered, memoryOnly: true };
  }
  if (LISTING.some((re) => re.test(pathname))) return { tier: 'listing', freshMs: FRESH_MS.listing, memoryOnly: false };
  if (PRODUCT.some((re) => re.test(pathname))) return { tier: 'product', freshMs: FRESH_MS.product, memoryOnly: false };
  // Any other /verslun/ path is a category: a listing.
  if (pathname.startsWith('/verslun/')) return { tier: 'listing', freshMs: FRESH_MS.listing, memoryOnly: false };
  return { tier: 'content', freshMs: FRESH_MS.content, memoryOnly: false };
}

/** The lifetime of a page of this tier, before any run-time override. */
export function freshFor(tier: ShellTier): number {
  return FRESH_MS[tier];
}

/** The query with its keys sorted and empty values dropped, so the same filters always give the same key. */
export function canonicalQuery(search: URLSearchParams): string {
  const pairs = [...search.entries()].filter(([, v]) => v !== '').sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  return new URLSearchParams(pairs).toString();
}

/** The store key: build, then path, then canonical query. */
export function shellKey(build: string, pathname: string, search: URLSearchParams): string {
  const q = canonicalQuery(search);
  return `${build}|${normalPath(pathname)}${q ? `?${q}` : ''}`;
}

export type Freshness = 'fresh' | 'stale' | 'expired';

/** Whether a stored page is served as it is, served while it is re-rendered, or dropped. */
export function freshness(entry: { at: number; freshMs: number; invalidatedAt?: number }, now: number): Freshness {
  const age = now - entry.at;
  if (age > HARD_MAX_AGE_MS) return 'expired';
  if (entry.invalidatedAt !== undefined && entry.invalidatedAt > entry.at) return 'stale';
  return age <= entry.freshMs ? 'fresh' : 'stale';
}

/** How long to wait before the next background refresh of a page whose refreshes keep failing (5xx or an incomplete
 *  render): 30 s after the first failure, doubling, at most 30 min. The stale copy is served meanwhile. */
export function refreshBackoffMs(failures: number): number {
  return Math.min(30 * 60 * 1000, 30 * 1000 * 2 ** Math.max(0, failures - 1));
}

export interface StoreInput {
  method: string;
  status: number;
  contentType: string | null;
  /** The Cache-Control the route set itself, before finishResponse (null when it set none). */
  cacheControl: string | null;
  setsCookie: boolean;
  /** A product photo or a facet count was missing when the page was rendered (set through lib/shellIncomplete). */
  incomplete: boolean;
  maintenance: boolean;
  /** The owner's preview key is in the address or the cookie. */
  preview: boolean;
  canonical: boolean;
  hasPolicy: boolean;
}

/** Whether a rendered response may be written to the store. Every test here is one the plan rules out. */
export function canStore(i: StoreInput): boolean {
  if (i.method !== 'GET' || i.status !== 200 || !i.hasPolicy || !i.canonical) return false;
  if (!(i.contentType ?? '').includes('text/html')) return false;
  if (i.setsCookie || i.incomplete || i.maintenance || i.preview) return false;
  // A route that asks for no-store or private (or any non-public policy) keeps its page out of the store.
  if (i.cacheControl !== null && !/^public\b/i.test(i.cacheControl)) return false;
  return true;
}

const NOT_REPLAYED = new Set(['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'date', 'x-mos-shell']);

/** The response header names kept with a stored page (the rest are rebuilt on replay). */
export function replayHeaderNames(names: string[]): string[] {
  return names.filter((n) => !NOT_REPLAYED.has(n.toLowerCase()));
}
