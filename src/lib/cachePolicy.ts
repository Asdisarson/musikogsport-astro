// Cache-Control for every on-demand response (applied by src/middleware.ts). Pure; SERVER-ONLY by use.
//
// Cloudflare is in front of the app. It ignores `Vary: Cookie`, so per-shopper responses can't rely on Vary: they are
// `private, no-store`, by path and whenever cookies are being set. Public HTML is the same for every visitor (no
// public page reads a cookie or a request header; cart count, wishlist and consent are drawn in the browser), so it
// may be held at the CDN for five minutes (PUBLIC_HTML): browsers still revalidate every time (max-age=0), the CDN
// answers from its copy (s-maxage) and refreshes it in the background (stale-while-revalidate). The HTML no longer
// carries stock or a live price: those are corrected in the browser from /api/live (the price after load, the stock
// at add-to-cart), so a five-minute-old page is at most a five-minute-old listing order or sale badge. Cart and
// checkout read WooCommerce live. A page sent with content missing marks itself no-store (lib/http markDegraded),
// which wins here. Cloudflare only stores HTML once a Cache Rule makes it eligible (DEPLOY.md "Caching"); without the
// rule this header changes nothing. While the shop is closed for maintenance nothing public is held: what the owner
// previews must not reach the CDN. /_astro/* is served by the node adapter's static handler with
// `public, max-age=31536000, immutable` and never reaches this.

export const PUBLIC_HTML = 'public, max-age=0, s-maxage=300, stale-while-revalidate=60';

// Per-shopper pages and APIs: the cart, checkout and thank-you page, the account area, the wishlist, sign-out, and
// the cart / checkout / order / account APIs.
const PERSONAL = [/^\/karfa\//, /^\/gera-upp(\/|$)/, /^\/min-sida(\/|$)/, /^\/oskalisti(\/|$)/, /^\/utskra(\/|$)/, /^\/api\/(cart|checkout|order)(\/|$)/, /^\/api\/account\//];

export function isPersonalPath(pathname: string): boolean {
  return PERSONAL.some((re) => re.test(pathname));
}

export interface CacheInput {
  path: string;
  method: string;
  status: number;
  /** The Cache-Control the route set, if any. */
  current: string | null;
  /** Cookies are being set on this response (Astro adds Set-Cookie after middleware, so callers check ctx.cookies). */
  setsCookie: boolean;
  isHtml: boolean;
  /** False while public pages must not be held at the CDN (the shop is closed for maintenance). */
  cdn: boolean;
}

/** The Cache-Control to send, or null to leave the response's own (a public redirect). */
export function cacheControlFor({ path, method, status, current, setsCookie, isHtml, cdn }: CacheInput): string | null {
  if (setsCookie || isPersonalPath(path)) return 'private, no-store';
  if (status >= 300 && status < 400) return current;
  if (status >= 400) return 'no-store';
  if (method !== 'GET' && method !== 'HEAD') return 'no-store';
  if (current) return current;
  if (!isHtml) return 'no-store';
  return cdn && status === 200 ? PUBLIC_HTML : 'no-cache';
}
