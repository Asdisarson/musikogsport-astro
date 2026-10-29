// Cache-Control for every on-demand response (applied by src/middleware.ts). Pure; SERVER-ONLY by use.
//
// App Platform puts a Cloudflare CDN in front of the service. It caches a service response only when the response's
// Cache-Control allows it, and holds it until the next deployment
// (https://docs.digitalocean.com/products/app-platform/how-to/cache-content/), and Cloudflare ignores `Vary: Cookie`.
// So per-shopper responses can't rely on Vary: they are `private, no-store`, by path and whenever cookies are being
// set. Public HTML is `no-cache` (revalidate each time) rather than a short s-maxage: a cached listing or product
// page would freeze prices, stock and partial-outage renders at the edge, and the CDN's honouring of s-maxage and
// purge timing on App Platform is unverified. /_astro/* is served by the node adapter's static handler with
// `public, max-age=31536000, immutable` and never reaches this.

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
}

/** The Cache-Control to send, or null to leave the response's own (a public redirect). */
export function cacheControlFor({ path, method, status, current, setsCookie, isHtml }: CacheInput): string | null {
  if (setsCookie || isPersonalPath(path)) return 'private, no-store';
  if (status >= 300 && status < 400) return current;
  if (status >= 400) return 'no-store';
  if (method !== 'GET' && method !== 'HEAD') return 'no-store';
  if (current) return current;
  return isHtml ? 'no-cache' : 'no-store';
}
