// The storefront's search-engine rules in one place: the shop's name and page titles, meta descriptions, which
// filtered listing is its own page, which host may be indexed, and the shop's structured data. Pure: pages and the
// middleware only call it.
import { decodeEntities } from './decode';
import type { Week } from './openingHours';

export const SITE_NAME = 'Músík og Sport';
export const INSTAGRAM_URL = 'https://www.instagram.com/musikogsport/';
const HOME_TITLE = `${SITE_NAME} – íþróttavöruverslun í Hafnarfirði`;
const SHOP_LINE = 'Íþróttavörur frá fagfólki í Hafnarfirði.';

/** `<title>`: "Page | Músík og Sport"; the home page (no title) has its own. */
export function pageTitle(title: string | undefined): string {
  return title ? `${title} | ${SITE_NAME}` : HOME_TITLE;
}

/** Search engines show about this many characters of a description. */
const DESCRIPTION_MAX = 155;

const plainText = (html: string | null | undefined): string =>
  decodeEntities((html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** The first candidate with text (HTML allowed), as plain text of at most 155 characters, cut at a word. */
export function metaDescription(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const text = plainText(candidate);
    if (!text) continue;
    if (text.length <= DESCRIPTION_MAX) return text;
    const room = text.slice(0, DESCRIPTION_MAX); // one character is kept for the "…"
    const cut = room.lastIndexOf(' ', DESCRIPTION_MAX - 1);
    return cut > 0 ? `${room.slice(0, cut).replace(/[\s.,;:–—-]+$/, '')}…` : room;
  }
  return '';
}

/** A product without any description text still gets one: "Clifton 9 frá Hoka. 24.990 kr. Fæst í …". */
export function productFallbackDescription(p: { name: string; brand?: string; price?: string }): string {
  const head = p.brand ? `${p.name} frá ${p.brand}.` : `${p.name}.`;
  return [head, p.price, `Fæst í vefverslun ${SITE_NAME}.`].filter(Boolean).join(' ');
}

/** "vara" after 1, 21, 31 …; "vörur" otherwise (11 included). */
const productsWord = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'vara' : 'vörur');

/** A category or brand listing: the term's own description from WooCommerce, else its name and product count. */
export function listingDescription(l: { name: string; count?: number; termDescription?: string | null }): string {
  const own = metaDescription(l.termDescription);
  if (own) return own;
  const count = l.count && l.count > 0 ? ` – ${l.count} ${productsWord(l.count)}` : '';
  return metaDescription(`${l.name}${count} í vefverslun ${SITE_NAME}. ${SHOP_LINE}`);
}

/** The query a shop listing keeps in its canonical URL: `?kyn=<slug>` when that one value is the only parameter
 *  (Konur, Karlar and Börn are pages of their own); every other filter, sort or page is a view of the bare path. */
export function listingCanonicalSearch(params: URLSearchParams): string {
  const entries = [...params.entries()];
  if (entries.length !== 1) return '';
  const [key, value] = entries[0];
  return key === 'kyn' && /^[a-z0-9-]+$/.test(value) ? `?kyn=${value}` : '';
}

/** Whether the request came in on the site's own host. Any other host (new.musikogsport.is before the move) is a
 *  duplicate and is kept out of the index. Unknown host or site: true, so the real site is never hidden by mistake. */
export function isCanonicalHost(host: string | null | undefined, site: string | URL | undefined): boolean {
  if (!host || !site) return true;
  let siteHost: string;
  try {
    siteHost = new URL(site).hostname;
  } catch {
    return true;
  }
  return host.toLowerCase().replace(/:\d+$/, '') === siteHost.toLowerCase();
}

const KNOWN_ADDRESS = { streetAddress: 'Dalshraun 10', postalCode: '220', addressLocality: 'Hafnarfjörður' };
const SCHEMA_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Dalshraun 10\n220 Hafnarfjörður" (the footer text from wp-admin) as a postal address; the known one otherwise. */
function postalAddress(text: string) {
  const [street, place] = text.split('\n').map((l) => l.trim());
  const m = /^(\d{3})\s+(.+)$/.exec(place ?? '');
  const parts = street && m ? { streetAddress: street, postalCode: m[1], addressLocality: m[2] } : KNOWN_ADDRESS;
  return { '@type': 'PostalAddress', ...parts, addressCountry: 'IS' };
}

/** "555 2887" -> "+3545552887". */
function internationalPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+354${digits}`;
}

/** Open days grouped by equal hours; closed days are simply absent, as schema.org reads them. */
function openingHours(week: Week) {
  const groups = new Map<string, { opens: string; closes: string; days: string[] }>();
  week.forEach((day, i) => {
    if (!day || !SCHEMA_DAYS[i]) return;
    const key = `${day.open}-${day.close}`;
    const group = groups.get(key) ?? { opens: day.open, closes: day.close, days: [] };
    group.days.push(SCHEMA_DAYS[i]);
    groups.set(key, group);
  });
  return [...groups.values()].map((g) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: g.days,
    opens: g.opens,
    closes: g.closes,
  }));
}

export interface StoreLdInput {
  siteUrl: string;
  logo: string;
  email: string;
  phone: string;
  /** The footer's address text, lines split by "\n". */
  address: string;
  instagram: string;
  /** The opening hours read from the Opnunartími page, or null when they couldn't be read. */
  week: Week | null;
}

/** The shop itself (schema.org SportingGoodsStore) for the home and opening-hours pages. */
export function storeLd(s: StoreLdInput) {
  const telephone = internationalPhone(s.phone);
  const hours = s.week ? openingHours(s.week) : [];
  return {
    '@context': 'https://schema.org',
    '@type': 'SportingGoodsStore',
    '@id': `${s.siteUrl}#store`,
    name: SITE_NAME,
    url: s.siteUrl,
    image: s.logo,
    logo: s.logo,
    ...(telephone ? { telephone } : {}),
    ...(s.email ? { email: s.email } : {}),
    address: postalAddress(s.address),
    sameAs: [s.instagram],
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
  };
}
