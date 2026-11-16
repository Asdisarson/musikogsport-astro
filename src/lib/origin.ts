// Where a visit came from, for WooCommerce's order attribution ("Origin" on an order). WooCommerce's own pages get
// this from sourcebuster.js; the storefront records the same fields itself and sends them with the order
// (extensions['woocommerce/order-attribution'], read by WooCommerce's OrderAttributionBlocksController). Kept in
// sessionStorage, so it lasts while the tab is open. Only a visitor who chose "Samþykkja" on the cookie banner has it
// remembered across visits (localStorage, 30 days). Client-safe; the browser parts are at the bottom.

/** sessionStorage key (this visit), and the localStorage key of the copy kept after consent. */
export const ORIGIN_KEY = 'mos-origin';
/** localStorage key of the banner's answer: 'yes' or 'no'. */
export const CONSENT_KEY = 'mos-consent';
/** How long a consenting visitor's source is remembered. */
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export type Consent = 'yes' | 'no';
/** A source kept across visits, and when it was set (ms). */
export interface Remembered {
  origin: Origin;
  at: number;
}

/** The attribution fields the storefront fills; `user_agent` is added by the server from the request. */
export const ORIGIN_FIELDS = [
  'source_type', 'referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
  'session_entry', 'session_start_time', 'session_pages', 'session_count',
] as const;
export type OriginField = (typeof ORIGIN_FIELDS)[number];
export type Origin = Partial<Record<OriginField, string>>;

/** The source types a browser visit can have (WooCommerce also knows admin, pos and mobile_app). */
const SOURCE_TYPES = new Set(['utm', 'organic', 'referral', 'typein']);
const SEARCH_ENGINES = ['google', 'bing', 'duckduckgo', 'yahoo', 'yandex', 'ecosia', 'brave'];
const FIELD_MAX = 200;
const UTM_TAGS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as const;

const cap = (v: string) => v.slice(0, FIELD_MAX);
const parse = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};
/** "www.shop.example.is" → "example.is": enough to tell our own hosts (apex, www, wp.) from another site. */
const site = (host: string) => host.split('.').slice(-2).join('.');
const searchEngine = (host: string) => SEARCH_ENGINES.find((e) => host.split('.').includes(e));

/** The origin of a visit, from its first page: a tagged link, a search engine, another site, or direct. */
export function originFromVisit(v: { url: string; referrer: string; now: Date }): Origin {
  const page = parse(v.url);
  const from = parse(v.referrer);
  const external = from && /^https?:$/.test(from.protocol) && (!page || site(from.hostname) !== site(page.hostname)) ? from : null;
  const origin: Origin = {
    source_type: 'typein',
    // Like the entry page below, without the query: it can hold what was searched for or a link's token.
    referrer: external ? cap(external.origin + external.pathname) : '',
    utm_source: '(direct)',
    utm_medium: '(none)',
    // Tags are stored in their own fields, and nothing else from a link belongs on an order.
    session_entry: page ? cap(page.origin + page.pathname) : '',
    session_start_time: v.now.toISOString().slice(0, 19).replace('T', ' '),
    session_pages: '1',
    session_count: '1',
  };
  const tagged = page?.searchParams.get('utm_source')?.trim();
  if (page && tagged) {
    origin.source_type = 'utm';
    delete origin.utm_medium;
    for (const tag of UTM_TAGS) {
      const value = page.searchParams.get(tag)?.trim();
      if (value) origin[tag] = cap(value);
    }
  } else if (external) {
    const engine = searchEngine(external.hostname);
    origin.source_type = engine ? 'organic' : 'referral';
    origin.utm_source = engine ?? cap(external.hostname.replace(/^www\./, ''));
    origin.utm_medium = engine ? 'organic' : 'referral';
  }
  return origin;
}

/** One more page seen in this visit. */
export function countPage(o: Origin): Origin {
  const pages = Number.parseInt(o.session_pages ?? '', 10);
  return { ...o, session_pages: String(Number.isFinite(pages) && pages > 0 ? pages + 1 : 1) };
}

/** The visit's origin after one more page view. A page reached from inside the site (or typed in) adds to the
 *  count; arriving again from a tagged link, a search or another site, even in the same tab, starts from that. */
export function pageOrigin(stored: Origin | null, page: Origin): Origin {
  return stored && page.source_type === 'typein' ? countPage(stored) : page;
}

/** What may go to WooCommerce from a stored or submitted origin: the known fields, as capped strings. Null when it
 *  names no source a browser visit can have (nothing is sent, and the order reads "Unknown" as before). */
export function originExtension(raw: unknown): Origin | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.source_type !== 'string' || !SOURCE_TYPES.has(input.source_type)) return null;
  const out: Origin = {};
  for (const f of ORIGIN_FIELDS) {
    const v = input[f];
    if (typeof v === 'string') out[f] = cap(v);
  }
  return out;
}

/** The banner's stored answer, or null when the visitor hasn't answered. */
export function readConsent(stored: unknown): Consent | null {
  return stored === 'yes' || stored === 'no' ? stored : null;
}

/** The kept source, if it is one and is at most 30 days old. */
export function rememberedOrigin(raw: unknown, now: Date): Remembered | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { origin, at } = raw as { origin?: unknown; at?: unknown };
  const kept = originExtension(origin);
  if (!kept || typeof at !== 'number' || !Number.isFinite(at)) return null;
  const age = now.getTime() - at;
  return age >= 0 && age <= REMEMBER_MS ? { origin: kept, at } : null;
}

/** A consenting visitor's origin for a new visit. A direct visit keeps the remembered source (the ad clicked last
 *  week still gets the order); a new tagged link, search or referral replaces it and restarts the 30 days. */
export function chooseOrigin(fresh: Origin, remembered: Remembered | null, now: Date): Remembered {
  if (!remembered) return { origin: fresh, at: now.getTime() };
  const visits = Number.parseInt(remembered.origin.session_count ?? '', 10);
  const session_count = String(Number.isFinite(visits) && visits > 0 ? visits + 1 : 2);
  if (fresh.source_type !== 'typein') return { origin: { ...fresh, session_count }, at: now.getTime() };
  const { session_entry, session_start_time, session_pages } = fresh;
  return { origin: { ...remembered.origin, session_entry, session_start_time, session_pages, session_count }, at: remembered.at };
}

/** When the 30 days of `origin` began: unchanged if that source is already the kept one, otherwise now. */
export function rememberSince(kept: Remembered | null, origin: Origin, now: Date): number {
  const same = kept && kept.origin.source_type === origin.source_type && kept.origin.utm_source === origin.utm_source;
  return same ? kept.at : now.getTime();
}

// ---------- browser ----------

const REMEMBERED_KEY = 'mos-origin-kept';

function readJson(store: Storage, key: string): unknown {
  try {
    return JSON.parse(store.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** The visitor's answer to the cookie banner, or null (not answered, or storage is blocked). */
export function consent(): Consent | null {
  try {
    return readConsent(localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

/** Store the banner's answer. "Samþykkja" starts remembering this visit's source; "Hafna" forgets any kept one. */
export function setConsent(choice: Consent): void {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
    if (choice === 'no') {
      localStorage.removeItem(REMEMBERED_KEY);
      return;
    }
    const origin = storedOrigin();
    if (!origin) return; // nothing recorded in this tab: whatever is already kept stays
    const now = new Date();
    const at = rememberSince(rememberedOrigin(readJson(localStorage, REMEMBERED_KEY), now), origin, now);
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify({ origin, at } satisfies Remembered));
  } catch {
    // storage blocked: the banner shows again on the next page
  }
}

/** Record this page view: the origin on the visit's first page (or on arriving again from outside), a page count
 *  after that. A browser that refuses storage simply has no origin. */
export function trackVisit(): void {
  try {
    const now = new Date();
    const stored = storedOrigin();
    const page = originFromVisit({ url: location.href, referrer: document.referrer, now });
    let origin = pageOrigin(stored, page);
    // A new visit, or a new source: a consenting visitor's 30-day copy decides and is brought up to date.
    if (origin === page && consent() === 'yes') {
      const kept = chooseOrigin(page, rememberedOrigin(readJson(localStorage, REMEMBERED_KEY), now), now);
      localStorage.setItem(REMEMBERED_KEY, JSON.stringify(kept));
      origin = kept.origin;
    }
    sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    // storage blocked or full
  }
}

/** This visit's origin for the order being placed, or null. */
export function storedOrigin(): Origin | null {
  try {
    return originExtension(readJson(sessionStorage, ORIGIN_KEY));
  } catch {
    return null;
  }
}
