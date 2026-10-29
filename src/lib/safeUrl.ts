// URL guards for links and embeds that come from WordPress content (menus, ACF fields, WPBakery).
// An editor account (or a compromised one) must not be able to plant a `javascript:` link on the
// storefront. Client-safe and pure. The WHATWG URL parser strips tabs, newlines and leading control
// characters exactly as browsers do, so disguised schemes are caught.

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const BASE = 'https://relative.invalid/';

function parse(value: string): URL | null {
  try {
    return new URL(value, BASE);
  } catch {
    return null;
  }
}

// A leading "\" or "/\", read the way the URL parser does (leading control characters and spaces dropped, tabs
// and newlines removed): browsers treat "\" as "/", so "/\evil.example" is a link to another host dressed as a
// path. wp-mu-plugins/mos-headless-api.php refuses the same forms (MU-07).
const BACKSLASH_HOST = /^(\\|\/\\)/;

/** The link if it is relative, http(s), mailto or tel; otherwise '#'. */
export function safeHref(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '#';
  if (BACKSLASH_HOST.test(value.replace(/^[\u0000-\u0020]+/, '').replace(/[\t\n\r]/g, ''))) return '#';
  const u = parse(value);
  return u && LINK_PROTOCOLS.has(u.protocol) ? value : '#';
}

/** An absolute http(s) embed URL (a map), or null. */
export function safeIframeSrc(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const u = parse(value);
  return u && (u.protocol === 'https:' || u.protocol === 'http:') && u.origin !== new URL(BASE).origin ? value : null;
}

/** A deep copy of API data with every `href` / `*_href` string passed through safeHref. An empty value
 *  stays empty (it means "no link"). */
export function withSafeHrefs<T>(data: T): T {
  if (Array.isArray(data)) return data.map((v) => withSafeHrefs(v)) as T;
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = /href$/i.test(k) && typeof v === 'string' ? (v === '' ? '' : safeHref(v)) : withSafeHrefs(v);
    }
    return out as T;
  }
  return data;
}

/** `rel` for a WordPress menu link: noopener when it opens a new tab or leaves the site, else none. */
export function linkRel(target: string | undefined, external = false): 'noopener' | undefined {
  return target === '_blank' || external ? 'noopener' : undefined;
}
