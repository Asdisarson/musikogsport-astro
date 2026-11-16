// The WordPress "Forsíða" content (mos/v1/front-page) — SERVER-ONLY. Shared by the site chrome
// (campaign bar, logos, footer) and the homepage; cached in-process for a minute, one in-flight
// fetch for concurrent cold callers, last good value served on failure.
import { WP_INTERNAL_URL } from 'astro:env/server';
import { withSafeHrefs } from './safeUrl';
import { createCachedLoader } from './cache';
import { upstreamJson } from './upstream';

export interface WpImage {
  url: string;
  width: number;
  height: number;
  alt: string;
  /** The image's smaller sizes as WordPress lists them (`url 768w, …`), or '' when there are none. */
  srcset: string;
}

export interface HeroSlide {
  id: number;
  name: string;
  href: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  /** WooCommerce-rendered price (sale del/ins, variable ranges). */
  price_html: string;
  image: WpImage | null;
}

export interface ProductRowConfig {
  title: string;
  source: 'newest' | 'popular' | 'on_sale' | 'category';
  category: { id: number; slug: string; name: string } | null;
  count: number;
}

export interface Banner {
  image: WpImage | null;
  title: string;
  href: string;
}

export interface FrontPage {
  campaign: { text: string; text_right: string; notice: string };
  logos: { header: WpImage | null; footer: WpImage | null };
  hero: { slides: HeroSlide[]; heading: string; text: string; buttons: { label: string; href: string }[] };
  rows: ProductRowConfig[];
  banners: (Banner | null)[];
  shipping_bar?: { goal: number; message: string; success: string; color: string; locations: string[]; include_taxes: boolean } | null;
  footer: {
    address: string;
    directions_label: string;
    directions_href: string;
    email: string;
    phone: string;
    company_line: string;
  };
}

const URL_FRONT = `${WP_INTERNAL_URL}/wp-json/mos/v1/front-page`;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** An image as WordPress sent it (its URL untouched), or null without a URL. */
function image(v: unknown): WpImage | null {
  const i = obj(v);
  const url = str(i.url);
  const srcset = str(i.srcset);
  // a srcset is only a choice with width descriptors (lib/img mediaSrcset has the same rule)
  return url ? { url, width: Number(i.width) || 0, height: Number(i.height) || 0, alt: str(i.alt), srcset: /\s\d+w\b/.test(srcset) ? srcset : '' } : null;
}

/** The front-page answer in the shape the site expects whatever arrives: every missing field gets its empty default
 *  (one absent field must not throw in planHome or the chrome and 500 every page). Image URLs pass through unchanged:
 *  mediaUrl only rewrites a localhost host (a no-op in production), and the home media uploaded locally exist only on
 *  the local WordPress. Pure. */
export function normaliseFrontPage(raw: unknown): FrontPage {
  const d = obj(raw);
  const campaign = obj(d.campaign);
  const logos = obj(d.logos);
  const hero = obj(d.hero);
  const footer = obj(d.footer);
  const bar = d.shipping_bar && typeof d.shipping_bar === 'object' ? (d.shipping_bar as FrontPage['shipping_bar']) : null;
  return {
    campaign: { text: str(campaign.text), text_right: str(campaign.text_right), notice: str(campaign.notice) },
    logos: { header: image(logos.header), footer: image(logos.footer) },
    hero: {
      slides: list(hero.slides).map((v) => {
        const s = obj(v);
        return {
          id: Number(s.id) || 0,
          name: str(s.name),
          href: str(s.href),
          price: str(s.price),
          regular_price: str(s.regular_price),
          sale_price: str(s.sale_price),
          on_sale: s.on_sale === true,
          price_html: str(s.price_html),
          image: image(s.image),
        };
      }),
      heading: str(hero.heading),
      text: str(hero.text),
      buttons: list(hero.buttons).map((v) => ({ label: str(obj(v).label), href: str(obj(v).href) })),
    },
    rows: list(d.rows) as ProductRowConfig[],
    banners: list(d.banners).map((v) => (v && typeof v === 'object' ? { image: image(obj(v).image), title: str(obj(v).title), href: str(obj(v).href) } : null)),
    shipping_bar: bar,
    footer: {
      address: str(footer.address),
      directions_label: str(footer.directions_label),
      directions_href: str(footer.directions_href),
      email: str(footer.email),
      phone: str(footer.phone),
      company_line: str(footer.company_line),
    },
  };
}

async function fetchFrontPage(): Promise<FrontPage> {
  // ACF links are editor input: no javascript:/data: hrefs reach the page.
  return withSafeHrefs(normaliseFrontPage(await upstreamJson<unknown>(URL_FRONT, 5000, 'front-page')));
}

// A minute fresh, then served stale while one refresh runs; an outage is retried every 15 s at most.
const load = createCachedLoader({ load: fetchFrontPage, ttlMs: 60 * 1000, failMemoMs: 15 * 1000 });

/** Resolves to the content, or null only when it has never loaded successfully. */
export async function loadFrontPage(): Promise<FrontPage | null> {
  return (await load()).value;
}

/** Fetch the content now (it was just saved in WordPress), so the next page view shows it. False when the fetch
 *  failed (the last good copy stays). */
export function refreshFrontPage(): Promise<boolean> {
  return load.refresh();
}
