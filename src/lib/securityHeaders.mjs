// @ts-check
// Security response headers — shared by the Astro middleware (src/middleware.ts: every on-demand response) and the
// production server wrapper (server.mjs: static files and the prerendered pages, which never reach middleware).
// Plain .mjs so server.mjs can import it without a build step.
//
// The CSP ships as Content-Security-Policy-Report-Only: browsers log what it would block and block nothing. It is
// built here rather than with Astro's `security.csp`, because that one always enforces (a <meta> tag on prerendered
// pages, an enforced header on the rest). Known reports under this policy, by design until the owner decides to
// enforce (DEPLOY.md "Security headers"): every inline <script> without a type of data (Astro's island bootstrap
// and hoisted modules, the theme script in Base.astro, the thank-you poll's define:vars script). The product-photo
// placeholder fallback is the external /img-fallback.js, so it doesn't report. JSON-LD blocks are data, not script,
// and never report. No report-uri: reports
// show in the browser console only.

/** @param {string | undefined} value MOS_HSTS — HSTS only after DNS and TLS on the apex are settled. */
export function hstsEnabled(value) {
  return /^(1|true|on|yes)$/i.test((value ?? '').trim());
}

/**
 * The origin of the media host (MOS_MEDIA_BASE_URL), or null when it isn't an http(s) URL.
 * @param {string | undefined} base
 * @returns {string | null}
 */
export function mediaOrigin(base) {
  try {
    const u = new URL(base ?? '');
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ mediaBaseUrl?: string }} opts
 * @returns {string}
 */
export function contentSecurityPolicy({ mediaBaseUrl }) {
  const media = mediaOrigin(mediaBaseUrl);
  return [
    "default-src 'self'",
    // No 'unsafe-inline': the report lists each inline script (with a sample) — the inventory enforcement needs.
    "script-src 'self' 'report-sample'",
    // Style attributes (photo tile colours, CSS custom properties) are everywhere; inline CSS is low risk.
    "style-src 'self' 'unsafe-inline'",
    // Any https image: product descriptions embed supplier CDN images (e.g. dms.deckers.com on Hoka pages). The
    // media host is named as well, for an http one (local WordPress).
    ["img-src 'self' data: blob: https:", media].filter(Boolean).join(' '),
    "font-src 'self' data:",
    "connect-src 'self'",
    // WordPress pages can embed a Google map (wpbakery vc_gmaps).
    "frame-src 'self' https://www.google.com https://maps.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Header name/value pairs for a response.
 * @param {{ mediaBaseUrl?: string; hsts?: boolean; csp?: boolean }} opts `csp: false` for non-document responses.
 * @returns {[string, string][]}
 */
export function securityHeaders({ mediaBaseUrl, hsts = false, csp = true }) {
  /** @type {[string, string][]} */
  const out = [
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Frame-Options', 'DENY'],
    // Nothing here uses these; the card payment happens on Straumur's own page (a navigation, not an iframe), so
    // the Payment Request API is off too.
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'],
  ];
  if (csp) out.push(['Content-Security-Policy-Report-Only', contentSecurityPolicy({ mediaBaseUrl })]);
  if (hsts) out.push(['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']);
  return out;
}
