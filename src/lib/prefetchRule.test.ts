// Which links the layout's hover prefetch may fetch ahead of a click: the home page and the catalogue (listings and
// product pages), whose HTML is shared between visitors and held at the CDN. Never a per-shopper page, never
// anything a GET changes (sign-out), never a filtered or paged listing (each is its own Store API query).
import { describe, expect, it } from 'vitest';
import { prefetchable } from './prefetchRule';

describe('prefetchable', () => {
  it('allows the home page, listings and product pages', () => {
    for (const p of ['/', '/verslun/', '/verslun/skor/', '/verslun/skor/ithrottaskor/asics-gel-nimbus-28/', '/voruflokkur/skor/', '/brand/nike/', '/merkimidar/utsala/'])
      expect(prefetchable(p, ''), p).toBe(true);
  });

  it('refuses per-shopper pages and anything a visit changes', () => {
    for (const p of ['/karfa/', '/gera-upp/', '/gera-upp/order-received/5/', '/min-sida/', '/min-sida/orders/', '/oskalisti/', '/utskra/', '/min-sida/customer-logout/'])
      expect(prefetchable(p, ''), p).toBe(false);
  });

  it('refuses APIs, assets and pages outside the catalogue', () => {
    for (const p of ['/api/cart', '/api/live/', '/_astro/x.js', '/_image', '/wp-content/uploads/a.jpg', '/leita/', '/hafa-samband/', '/personuvernd/', '/bidlisti/stadfesta/', '/sitemap.xml', '/verslunin/', '/branding/'])
      expect(prefetchable(p, ''), p).toBe(false);
  });

  it('refuses any URL with a query: a filtered, sorted, searched or paged listing is not fetched ahead', () => {
    expect(prefetchable('/verslun/', '?kyn=konur')).toBe(false);
    expect(prefetchable('/brand/nike/', '?lager=1')).toBe(false);
    expect(prefetchable('/', '?s=skor')).toBe(false);
    expect(prefetchable('/verslun/skor/', '?')).toBe(true);   // an empty query is none
  });

  it('refuses a later page of a listing, however deep', () => {
    for (const p of ['/verslun/page/3/', '/voruflokkur/skor/page/2/', '/brand/nike/page/2', '/merkimidar/utsala/page/12/', '/page/2/'])
      expect(prefetchable(p, ''), p).toBe(false);
    expect(prefetchable('/verslun/skor/page-turner-skor/', '')).toBe(true);   // a slug that only starts like one
  });

  it('refuses the old /vara/ address: it only redirects', () => {
    expect(prefetchable('/vara/asics-gel-nimbus-28/', '')).toBe(false);
  });

  it('refuses a path that is not one of ours in shape', () => {
    for (const p of ['', 'verslun/', '//evil.example/verslun/', '/verslun/../karfa/', '/verslun/\\evil'])
      expect(prefetchable(p, ''), p).toBe(false);
  });
});
