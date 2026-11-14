// Where the checkout may send the shopper after placing an order. Client-safe.

// The card gateway (Straumur) hands back a hosted-checkout URL under straumur.is (prod
// greidslugatt.straumur.is, staging checkout-api.staging.straumur.is — verified against the plugin
// source), so the whole straumur.is space is allowed rather than one pinned subdomain.
const STRAUMUR_HOSTS = ['straumur.is'];
const ORDER_RECEIVED = /^\/gera-upp\/order-received\/\d+\/$/;
// WooCommerce's "pay for order" page. Valitor's plugin answers with it: WordPress renders a form there that posts
// the shopper on to Valitor (read from the plugin source, 1.9.41).
const ORDER_PAY = /^\/gera-upp\/order-pay\/\d+\/$/;

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** The URL to follow, or null to show the failure notice instead. Same-origin URLs and https
 *  Straumur URLs are followed as given. WooCommerce's own order-received URL can name another host
 *  when the storefront runs elsewhere (e.g. the local dev shim's port), so for that one path only the
 *  path and query are kept — a same-origin navigation. The pay-for-order page is followed on WordPress's own
 *  public host (`wpOrigin`) over https, and nowhere else. Everything else is refused. */
export function paymentRedirectTarget(url: string, origin: string, wpOrigin?: string): string | null {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return null;
  }
  if (u.origin === origin) return u.href;
  if (u.protocol === 'https:' && STRAUMUR_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return u.href;
  if (u.protocol === 'https:' && u.origin === originOf(wpOrigin) && ORDER_PAY.test(u.pathname)) return u.href;
  if ((u.protocol === 'http:' || u.protocol === 'https:') && ORDER_RECEIVED.test(u.pathname)) return u.pathname + u.search;
  return null;
}
