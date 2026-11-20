// Live-site URL shapes (musikogsport.is, WooCommerce permalinks): products at
// /verslun/<category path>/<slug>/, categories at /voruflokkur/<path>/, WP-style
// /page/N/ pagination, trailing slashes everywhere. Pure helpers — no server imports.

const PRODUCT_BASE = '/verslun/';
const CATEGORY_BASE = '/voruflokkur/';

/** Storefront path for a product: the pathname of its Woo permalink (any host), or
 *  /verslun/<slug>/ when the permalink is missing or isn't a /verslun/ URL — the product
 *  route resolves that by slug and redirects to the canonical path. */
export function productPath(permalink: string | null | undefined, slug: string): string {
  if (permalink) {
    try {
      const { pathname } = new URL(permalink);
      if (pathname.startsWith(PRODUCT_BASE) && pathname.length > PRODUCT_BASE.length) {
        return pathname.endsWith('/') ? pathname : `${pathname}/`;
      }
    } catch {
      // not a URL — fall through
    }
  }
  return `${PRODUCT_BASE}${slug}/`;
}

/** /voruflokkur/<a>/<b>/ from a category slug chain (root first). */
export function categoryPath(chain: string[]): string {
  return `${CATEGORY_BASE}${chain.join('/')}/`;
}

/** Split a trailing `page/N` off rest-route segments. Returns null for a malformed or
 *  explicit page/1 segment, so the route can 404 or redirect to the base URL. */
export function splitPagination(segments: string[]): { segments: string[]; page: number } | null {
  const i = segments.length - 2;
  if (i < 0 || segments[i] !== 'page') return { segments, page: 1 };
  const raw = segments[i + 1];
  if (!/^[1-9]\d*$/.test(raw) || raw === '1') return null;
  return { segments: segments.slice(0, i), page: Number(raw) };
}

/** Href for page N of an archive whose base path ends in '/', keeping the query string. */
export function archiveHref(base: string, page: number, params?: URLSearchParams): string {
  const path = page > 1 ? `${base}page/${page}/` : base;
  const qs = new URLSearchParams(params);
  qs.delete('page');
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** The archive's neighbouring pages for <link rel="prev"> / <link rel="next">, as Yoast emits on live. */
export function pageLinks(base: string, page: number, totalPages: number, params?: URLSearchParams): { prev: string | null; next: string | null } {
  return {
    prev: page > 1 ? archiveHref(base, page - 1, params) : null,
    next: page < totalPages ? archiveHref(base, page + 1, params) : null,
  };
}

// Legacy app-astro routes that 301 straight to their live URL — a slash hop first would chain redirects.
const LEGACY_PREFIXES = ['/leita', '/vara/', '/utskra'];

/** Where a slash-less page path should 301 to (WordPress-style), or null to leave it alone. */
export function slashRedirect(pathname: string): string | null {
  if (pathname === '/' || pathname.endsWith('/')) return null;
  // `//host` or `/\host` would come back as a protocol-relative Location: never build one, whatever reaches here.
  if (/^\/[/\\]/.test(pathname)) return null;
  if (pathname.startsWith('/api/') || pathname.startsWith('/_')) return null;
  if (LEGACY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`))) return null;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (last.includes('.')) return null;
  return `${pathname}/`;
}

// WooCommerce's English default pages (cart, checkout, my-account, shop). They exist as published WordPress pages on a
// stock install and Woo builds links to them while its page settings point there, so they 301 to the storefront's
// own routes rather than render as indexable content pages or 404 a link from an old email.
const WOO_DEFAULT_PAGES = new Map([
  ['cart', '/karfa/'],
  ['checkout', '/gera-upp/'],
  ['my-account', '/min-sida/'],
  ['shop', '/verslun/'],
]);

/** Categories the catalog tidy-up (mos_clean_category_ops in wp-mu-plugins/mos-catalog-clean.php — keep the two in
 *  step) removed, by their last slug: sports became the sport filter, clubs the club filter, Didriksons the brand. */
const MOVED_CATEGORIES = new Map([
  ['ithrott', '/verslun/'],
  ...[
    ['hjol', 'hjol'], ['pilates-barre', 'pilates'], ['blak', 'blak'], ['crossfit', 'crossfit'],
    ['fimleikar-ithrott', 'fimleikar'], ['fotbolti', 'fotbolti'], ['frjalsar', 'frjalsar'], ['golf', 'golf'],
    ['handbolti', 'handbolti'], ['hlaup-ithrott', 'hlaup'], ['joga', 'yoga'], ['korfubolti', 'korfubolti'],
    ['skidi', 'skidi'], ['snjobretti', 'snjobretti'], ['sund', 'sund'],
  ].map(([cat, sport]) => [cat, `/verslun/?ithrott=${sport}`]),
  ['stjarnan', '/verslun/?team=stjarnan'],
  ['fh', '/verslun/?team=fh'],
  ['fimleikafelagid-bjork', '/verslun/?team=bjork'],
  ['didriksons', '/brand/didriksons/'],
  ['boltar-2', '/voruflokkur/aefingarvorur/boltar-aefingarvorur/'],
  ['felag-lid', '/voruflokkur/fatnadur/lidafatnadur-fatnadur-2/'],
] as [string, string][]);

/** Teams the catalog tidy-up merges into another, whose old `team=` links are worth keeping: old slug → the team that
 *  replaces it. The merge itself is a `merge` row in mos_clean_term_ops (wp-mu-plugins/mos-catalog-clean.php — keep
 *  the two in step). A filter naming the old slug only moves once that slug is gone from WordPress (liveFilters
 *  movedTeamSearch), so the table can ship before the merge runs. The typo merges there (keflavik-2, totttenham …)
 *  never had links of their own and are not listed. */
export const MOVED_TEAMS: ReadonlyMap<string, string> = new Map([['hsi', 'island-iceland']]);

/** Where a removed category's URL now lives (its last slug decides), with the request's filters carried over —
 *  the target's own query wins. Null for a category that was never moved. */
export function movedCategoryTarget(segments: string[], search: string): string | null {
  const target = MOVED_CATEGORIES.get(segments[segments.length - 1] ?? '');
  if (!target) return null;
  const [path, query = ''] = target.split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of new URLSearchParams(search)) if (!params.has(key)) params.append(key, value);
  const merged = params.toString();
  return merged ? `${path}?${merged}` : path;
}

/** WordPress-style product search on the home URL (/?s=<q>&post_type=product): the search results (page 1) for a
 *  query, the shop for an empty or blank one (WordPress shows the shop then), nothing without `s`. */
export function homeSearch(search: string): { rewrite: string } | { redirect: string } | null {
  const params = new URLSearchParams(search);
  if (!params.has('s')) return null;
  return params.get('s')?.trim() ? { rewrite: `/page/1/${search}` } : { redirect: '/verslun/' };
}

/** The legacy app-astro search URL (/leita?q=) in live's shape: /?s=<q>&post_type=product, or the shop without a query. */
export function legacySearchTarget(q: string | null): string {
  const query = (q ?? '').trim();
  return query ? `/?${new URLSearchParams({ s: query, post_type: 'product' })}` : '/verslun/';
}

/** Where a WooCommerce default page slug lives on the storefront, or null for any other slug. */
export function wooDefaultPageTarget(slug: string): string | null {
  return WOO_DEFAULT_PAGES.get(slug) ?? null;
}

/** WordPress's current-menu-item rule: a custom link matches the exact URL (query included);
 *  a plain archive link also stays current while that archive is filtered, sorted or paged.
 *  Live's "Vörumerki" item links to "/" as a placeholder, so the root never matches. */
export function isCurrentMenuHref(href: string, url: URL): boolean {
  if (href === '/') return false;
  if (href === url.pathname + url.search) return true;
  if (href.includes('?')) return false;
  return href === url.pathname.replace(/page\/[1-9]\d*\/$/, '');
}

/** Where the old app-astro checkout URLs (/utskra, /utskra/takk, /utskra/villa) now live. */
export function legacyCheckoutTarget(pathname: string, params: URLSearchParams): string {
  const page = pathname.replace(/\/+$/, '');
  if (page === '/utskra/takk') {
    const id = params.get('order_id') ?? '';
    const key = params.get('order_key') ?? '';
    if (!/^[1-9]\d*$/.test(id)) return '/gera-upp/';
    return `/gera-upp/order-received/${id}/${key ? `?key=${encodeURIComponent(key)}` : ''}`;
  }
  if (page === '/utskra/villa') {
    const status = params.get('straumurStatus');
    return `/gera-upp/?straumurStatus=${status === 'canceled' || status === 'error' ? status : 'failed'}`;
  }
  return '/gera-upp/';
}
