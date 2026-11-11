// Site chrome (menus, campaign bar, store notice, logos, footer details) from the WordPress
// headless API — SERVER-ONLY. Every page needs it, so it is cached in-process for a minute and
// concurrent cold callers share one fetch. On failure the last good value is served, else a
// static fallback that still renders a usable header/footer.
import { WP_INTERNAL_URL } from 'astro:env/server';
import { loadFrontPage } from './frontPage';
import { sanitizeHtml } from './sanitize';
import type { ShippingBar } from './shippingBar';
import { withSafeHrefs } from './safeUrl';
import { createCachedLoader } from './cache';
import { upstreamJson } from './upstream';

export interface MenuItem {
  id: number;
  title: string;
  href: string;
  external: boolean;
  target: string;
  classes: string[];
  children: MenuItem[];
}

export interface ChromeImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface SiteChrome {
  primary: MenuItem[];
  /** The `footer` menu location (live: Hafa Samband, Skilmálar, Opnunartími, Óskalisti, Stærðartafla). */
  footerMenu: MenuItem[];
  campaign: { text: string; textRight: string; notice: string };
  logos: { header: ChromeImage | null; footer: ChromeImage | null };
  /** Goya's free-shipping progress bar, or null when switched off in WordPress. */
  shippingBar: ShippingBar | null;
  footer: {
    address: string;
    directionsLabel: string;
    directionsHref: string;
    email: string;
    phone: string;
    companyLine: string;
  };
}

const API = `${WP_INTERNAL_URL}/wp-json/mos/v1`;
const TTL_MS = 60 * 1000;

const FALLBACK: SiteChrome = {
  primary: [],
  footerMenu: [],
  campaign: { text: '', textRight: '', notice: '' },
  logos: { header: null, footer: null },
  shippingBar: null,
  footer: {
    address: 'Dalshraun 10\n220 Hafnarfjörður',
    directionsLabel: 'Leiðarvísir',
    directionsHref: '',
    email: 'musikogsport@musikogsport.is',
    phone: '+(354) 555 2887',
    companyLine: 'Músík og Sport ehf. Dalshraun 10, 220 Hafnarfjörður, kennitala 710303-2310',
  },
};

async function getJson<T>(path: string): Promise<T> {
  // Menu links are editor input: no javascript:/data: hrefs reach the page.
  return withSafeHrefs(await upstreamJson<T>(`${API}${path}`, 5000, path));
}

async function fetchChrome(): Promise<SiteChrome> {
  const [primary, footerMenu, front] = await Promise.all([
    getJson<{ items: MenuItem[] }>('/menu/location/primary').then((m) => m.items),
    getJson<{ items: MenuItem[] }>('/menu/location/footer').then((m) => m.items).catch(() => []),
    loadFrontPage(),
  ]);
  // The Forsíða data never loaded (a cold start while it fails): the menus are still worth showing, with the
  // built-in campaign/footer around them. (loadFrontPage serves its last good copy otherwise.)
  if (!front) return { ...FALLBACK, primary, footerMenu };
  return {
    primary,
    footerMenu,
    campaign: { text: front.campaign.text, textRight: front.campaign.text_right, notice: front.campaign.notice },
    logos: front.logos,
    shippingBar: front.shipping_bar
      ? {
          goal: front.shipping_bar.goal,
          message: sanitizeHtml(front.shipping_bar.message),
          success: sanitizeHtml(front.shipping_bar.success),
          color: front.shipping_bar.color,
          locations: front.shipping_bar.locations,
          includeTaxes: front.shipping_bar.include_taxes,
        }
      : null,
    footer: {
      address: front.footer.address || FALLBACK.footer.address,
      directionsLabel: front.footer.directions_label || FALLBACK.footer.directionsLabel,
      directionsHref: front.footer.directions_href,
      email: front.footer.email || FALLBACK.footer.email,
      phone: front.footer.phone || FALLBACK.footer.phone,
      companyLine: front.footer.company_line || FALLBACK.footer.companyLine,
    },
  };
}

// Fresh for TTL_MS, then served stale while one refresh runs; an outage is retried every 15 s at most.
const load = createCachedLoader({ load: fetchChrome, ttlMs: TTL_MS, failMemoMs: 15 * 1000 });

/** The menus and Forsíða chrome; the built-in fallback only when they have never loaded. */
export async function loadSiteChrome(): Promise<SiteChrome> {
  return (await load()).value ?? FALLBACK;
}
