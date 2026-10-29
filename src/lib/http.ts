// Shared JSON Response builder for the non-cart /api/* routes. The cart family uses its own
// respondCart()/badRequest() because those also rotate the Cart-Token.
export function jsonResponse(data: unknown, status: number, cache = 'no-store'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });
}

/** A per-visitor limit was hit (lib/rateLimit): 429 with Retry-After (the window's length, an upper bound) and an
 *  Icelandic message the islands show as they show any other `{message}` error. Never cached. */
export function tooManyRequests(retryAfterSeconds: number, message = 'Of margar beiðnir í einu. Reyndu aftur eftir smástund.'): Response {
  return new Response(JSON.stringify({ message }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

/** CSRF defence in depth for cookie-authenticated POSTs: a browser-sent Origin must be our own. Pass
 *  Astro's `ctx.url`: behind the TLS proxy `request.url` is plain http, while ctx.url carries the
 *  X-Forwarded-Proto/Host that `security.allowedDomains` (astro.config.mjs) lets through. */
export function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}

/** The visitor's rate-limit key. With `trustedHops` proxies in front of Node, each appending to
 *  X-Forwarded-For, the visitor is the entry the outermost trusted proxy added: `trustedHops` from the
 *  right; anything to its left came from the client and is ignored. With 0 (Node faces visitors), any
 *  X-Forwarded-For is the client's own, and Astro may already have copied its first entry into
 *  clientAddress (security.allowedDomains), so all such requests share one key rather than letting a
 *  client choose its own. IPv6 is keyed by /64, the block one subscriber controls.
 *  `edgeIp` is the value of a header the hosting edge sets to the visitor's address (MOS_CLIENT_IP_HEADER,
 *  e.g. App Platform's do-connecting-ip, whose X-Forwarded-For ends in DO's ingress instead): when present
 *  it wins, last entry first in case the edge appends; when absent or blank the hop logic applies. */
export function visitorIp(forwardedFor: string | null, clientAddress: string, trustedHops: number, edgeIp: string | null = null): string {
  const edge = (edgeIp ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop();
  if (edge) return ipKey(edge);
  if (trustedHops <= 0) return forwardedFor ? 'forwarded-untrusted' : ipKey(clientAddress);
  const hops = (forwardedFor ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return ipKey(hops.length >= trustedHops ? hops[hops.length - trustedHops] : clientAddress);
}

function ipKey(raw: string): string {
  const ip = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => (g.replace(/^0+(?=.)/, '') || '0').toLowerCase()).join(':')}::/64`;
}

/** How to read WordPress's answer to a token or password check (`code` = the REST error code). Only an
 *  explicit refusal is final: 401, or a jwt-auth 403 (bad/expired token, wrong password). Outages (null =
 *  no answer), timeouts, a misconfigured plugin and a 403 that isn't jwt-auth's (a WAF) are transient:
 *  the session is kept and no failed attempt is counted. */
export function authStatus(status: number | null, code?: string): 'ok' | 'rejected' | 'unavailable' {
  if (status !== null && status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'rejected';
  if (status === 403 && typeof code === 'string' && /^\[?jwt_auth/.test(code) && !/bad_config|unsupported_algorithm/.test(code)) return 'rejected';
  return 'unavailable';
}

/** WordPress couldn't be reached: answer 503 (retry shortly, never cache) instead of a misleading 404. */
export function markUnavailable(response: { status?: number; headers: Headers }): void {
  response.status = 503;
  response.headers.set('Retry-After', '30');
  response.headers.set('Cache-Control', 'no-store');
}

/** A same-site path to send the visitor back to — never an absolute, protocol-relative or odd URL. Printable ASCII
 *  only, without a backslash: a non-Latin-1 or control character can't go in a Location header (the redirect would
 *  throw after the sign-in had already set its cookie), so such a value takes the fallback. Browsers send
 *  `location.pathname + search` percent-encoded, which passes. */
export function safeNext(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/.test(value) ? value : fallback;
}
