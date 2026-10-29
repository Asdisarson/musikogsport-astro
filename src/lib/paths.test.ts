import { describe, expect, it } from 'vitest';
import { archiveHref, categoryPath, isCurrentMenuHref, legacyCheckoutTarget, pageLinks, productPath, slashRedirect, splitPagination, homeSearch, legacySearchTarget, wooDefaultPageTarget, movedCategoryTarget } from './paths';

describe('movedCategoryTarget', () => {
  it('sends a folded sports category to the sport filter, keeping the visitor’s filters', () => {
    expect(movedCategoryTarget(['ithrott', 'hlaup-ithrott'], '?kyn=konur')).toBe('/verslun/?ithrott=hlaup&kyn=konur');
    expect(movedCategoryTarget(['ithrott', 'joga'], '')).toBe('/verslun/?ithrott=yoga');
    expect(movedCategoryTarget(['ithrott'], '')).toBe('/verslun/');
  });

  it('sends club categories to the club filter and the brand category to the brand page', () => {
    expect(movedCategoryTarget(['stjarnan'], '')).toBe('/verslun/?team=stjarnan');
    expect(movedCategoryTarget(['aefingarvorur', 'fimleikafelagid-bjork'], '')).toBe('/verslun/?team=bjork');
    expect(movedCategoryTarget(['didriksons'], '?kyn=born')).toBe('/brand/didriksons/?kyn=born');
  });

  it('sends merged categories to their target, and the target’s own query wins over the request’s', () => {
    expect(movedCategoryTarget(['boltar-2'], '')).toBe('/voruflokkur/aefingarvorur/boltar-aefingarvorur/');
    expect(movedCategoryTarget(['ithrott', 'sund'], '?ithrott=golf&lager=1')).toBe('/verslun/?ithrott=sund&lager=1');
  });

  it('leaves unknown categories alone', () => {
    expect(movedCategoryTarget(['skor', 'nope'], '')).toBeNull();
    expect(movedCategoryTarget([], '')).toBeNull();
  });
});

describe('productPath', () => {
  it('turns a Woo permalink into a storefront path on any host', () => {
    expect(productPath('http://localhost:10025/verslun/skor/ithrottaskor/predator-league/', 'predator-league'))
      .toBe('/verslun/skor/ithrottaskor/predator-league/');
  });

  it('adds the trailing slash live uses when the permalink lacks one', () => {
    expect(productPath('https://example.test/verslun/sale/hoka', 'hoka')).toBe('/verslun/sale/hoka/');
  });

  it('falls back to /verslun/<slug>/ when there is no usable permalink', () => {
    expect(productPath(undefined, 'crocs-charms')).toBe('/verslun/crocs-charms/');
    expect(productPath('not a url', 'crocs-charms')).toBe('/verslun/crocs-charms/');
  });

  it('falls back when the permalink is not a product URL (e.g. ?p=123 drafts)', () => {
    expect(productPath('http://localhost:10025/?post_type=product&p=5', 'draft-thing')).toBe('/verslun/draft-thing/');
  });
});

describe('categoryPath', () => {
  it('joins the slug chain under /voruflokkur/', () => {
    expect(categoryPath(['skor', 'ithrottaskor'])).toBe('/voruflokkur/skor/ithrottaskor/');
  });
});

describe('splitPagination', () => {
  it('leaves a path without a page segment on page 1', () => {
    expect(splitPagination(['skor', 'ithrottaskor'])).toEqual({ segments: ['skor', 'ithrottaskor'], page: 1 });
  });

  it('strips a trailing page/N and returns N', () => {
    expect(splitPagination(['skor', 'page', '3'])).toEqual({ segments: ['skor'], page: 3 });
  });

  it('handles a bare page/N (shop or search root)', () => {
    expect(splitPagination(['page', '2'])).toEqual({ segments: [], page: 2 });
  });

  it('rejects a malformed page number so the route can 404', () => {
    expect(splitPagination(['skor', 'page', 'x'])).toBeNull();
    expect(splitPagination(['skor', 'page', '0'])).toBeNull();
    expect(splitPagination(['skor', 'page', '2.5'])).toBeNull();
  });

  it('rejects an explicit page/1 so the route can redirect to the base URL', () => {
    expect(splitPagination(['skor', 'page', '1'])).toBeNull();
  });
});

describe('archiveHref', () => {
  it('returns the base for page 1', () => {
    expect(archiveHref('/voruflokkur/skor/', 1)).toBe('/voruflokkur/skor/');
  });

  it('appends page/N/ for later pages', () => {
    expect(archiveHref('/voruflokkur/skor/', 4)).toBe('/voruflokkur/skor/page/4/');
  });

  it('keeps the query string but drops any stray page param', () => {
    const params = new URLSearchParams('kyn=konur&page=9&orderby=price');
    expect(archiveHref('/verslun/', 2, params)).toBe('/verslun/page/2/?kyn=konur&orderby=price');
  });
});

describe('slashRedirect', () => {
  it('adds a trailing slash to page paths, like WordPress', () => {
    expect(slashRedirect('/voruflokkur/skor')).toBe('/voruflokkur/skor/');
  });

  it('leaves slashed paths and the root alone', () => {
    expect(slashRedirect('/voruflokkur/skor/')).toBeNull();
    expect(slashRedirect('/')).toBeNull();
  });

  it('leaves legacy app-astro URLs to their own single-hop redirects', () => {
    expect(slashRedirect('/leita')).toBeNull();
    expect(slashRedirect('/vara/hoka-restore')).toBeNull();
    expect(slashRedirect('/utskra')).toBeNull();
    expect(slashRedirect('/utskra/takk')).toBeNull();
  });

  it('never touches API routes, build assets or files', () => {
    expect(slashRedirect('/api/cart')).toBeNull();
    expect(slashRedirect('/api/healthz')).toBeNull(); // App Platform health check must get a 200, not a 301
    expect(slashRedirect('/_astro/client.js')).toBeNull();
    expect(slashRedirect('/_image')).toBeNull();
    expect(slashRedirect('/sitemap.xml')).toBeNull();
    expect(slashRedirect('/fonts/jost.woff2')).toBeNull();
  });
});

describe('isCurrentMenuHref', () => {
  const at = (u: string) => new URL(u, 'http://x.test');

  it('matches a menu link that equals the URL, query string included (live filter links)', () => {
    expect(isCurrentMenuHref('/voruflokkur/skor/?kyn=konur', at('/voruflokkur/skor/?kyn=konur'))).toBe(true);
    expect(isCurrentMenuHref('/voruflokkur/skor/?kyn=konur', at('/voruflokkur/skor/?kyn=karlar'))).toBe(false);
  });

  it('keeps a plain archive link current while the archive is filtered, sorted or paged (WP term item)', () => {
    expect(isCurrentMenuHref('/voruflokkur/skor/', at('/voruflokkur/skor/?brand=nike&orderby=price'))).toBe(true);
    expect(isCurrentMenuHref('/voruflokkur/skor/', at('/voruflokkur/skor/page/3/'))).toBe(true);
    expect(isCurrentMenuHref('/voruflokkur/skor/', at('/voruflokkur/skor/ithrottaskor/'))).toBe(false);
  });

  it('never marks the root placeholder link current', () => {
    expect(isCurrentMenuHref('/', at('/'))).toBe(false);
  });
});

describe('legacyCheckoutTarget', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('sends the old checkout to live\'s /gera-upp/', () => {
    expect(legacyCheckoutTarget('/utskra', q(''))).toBe('/gera-upp/');
  });

  it('maps the old thank-you URL onto WooCommerce\'s order-received endpoint', () => {
    expect(legacyCheckoutTarget('/utskra/takk', q('order_id=42&order_key=wc_order_abc'))).toBe('/gera-upp/order-received/42/?key=wc_order_abc');
  });

  it('falls back to the checkout when the old thank-you URL has no usable order id', () => {
    expect(legacyCheckoutTarget('/utskra/takk', q('order_id=nope'))).toBe('/gera-upp/');
  });

  it('keeps a payment status on the old failure page', () => {
    expect(legacyCheckoutTarget('/utskra/villa', q('straumurStatus=canceled'))).toBe('/gera-upp/?straumurStatus=canceled');
    expect(legacyCheckoutTarget('/utskra/villa', q(''))).toBe('/gera-upp/?straumurStatus=failed');
  });
});

describe('pageLinks', () => {
  it('gives page 1 a next link only (live: <link rel="next" href="…/page/2/">)', () => {
    expect(pageLinks('/voruflokkur/skor/', 1, 27)).toEqual({ prev: null, next: '/voruflokkur/skor/page/2/' });
  });

  it('links a middle page both ways, and page 2 back to the plain archive URL', () => {
    expect(pageLinks('/voruflokkur/skor/', 2, 27)).toEqual({ prev: '/voruflokkur/skor/', next: '/voruflokkur/skor/page/3/' });
  });

  it('gives the last page a prev link only, and a single page none', () => {
    expect(pageLinks('/brand/hoka/', 3, 3)).toEqual({ prev: '/brand/hoka/page/2/', next: null });
    expect(pageLinks('/brand/hoka/', 1, 1)).toEqual({ prev: null, next: null });
  });

  it('keeps the filter query', () => {
    expect(pageLinks('/', 1, 2, new URLSearchParams('s=hoka&post_type=product')).next).toBe('/page/2/?s=hoka&post_type=product');
  });
});

describe('slashRedirect never answers a protocol-relative target (LC-12)', () => {
  it('leaves a path starting with // or /\\ alone, whatever the front controller does with it', () => {
    expect(slashRedirect('//evil.example')).toBeNull();
    expect(slashRedirect('//evil.example/x')).toBeNull();
    expect(slashRedirect('/\\evil.example')).toBeNull();
    expect(slashRedirect('/ok/x')).toBe('/ok/x/');
  });
});

describe('wooDefaultPageTarget (PA-01)', () => {
  it("sends WooCommerce's English default pages to the storefront's Icelandic routes", () => {
    expect(wooDefaultPageTarget('cart')).toBe('/karfa/');
    expect(wooDefaultPageTarget('checkout')).toBe('/gera-upp/');
    expect(wooDefaultPageTarget('my-account')).toBe('/min-sida/');
    expect(wooDefaultPageTarget('shop')).toBe('/verslun/');
  });

  it('leaves every other slug to the content-page route', () => {
    for (const slug of ['hafa-samband', 'karfa', 'carts', 'constructor', 'toString', '__proto__', '']) expect(wooDefaultPageTarget(slug)).toBeNull();
  });
});

describe('homeSearch (PA-10)', () => {
  const q = (s: string) => (s ? `?${s}` : ''); // Astro.url.search
  it('rewrites a product search on the home URL to the search results', () => {
    expect(homeSearch(q('s=nike&post_type=product'))).toEqual({ rewrite: '/page/1/?s=nike&post_type=product' });
  });
  it('sends an empty or blank search to the shop, as WordPress shows the shop for it', () => {
    expect(homeSearch(q('s='))).toEqual({ redirect: '/verslun/' });
    expect(homeSearch(q('s=%20%20&post_type=product'))).toEqual({ redirect: '/verslun/' });
  });
  it('leaves the home page alone without `s`', () => {
    expect(homeSearch(q(''))).toBeNull();
    expect(homeSearch(q('utm_source=x'))).toBeNull();
  });
});

describe('legacySearchTarget', () => {
  it("maps the old /leita?q= onto live's /?s=<q>&post_type=product, or the shop without a query", () => {
    expect(legacySearchTarget(' nike skór ')).toBe('/?s=nike+sk%C3%B3r&post_type=product');
    expect(legacySearchTarget('')).toBe('/verslun/');
    expect(legacySearchTarget(null)).toBe('/verslun/');
  });
});

