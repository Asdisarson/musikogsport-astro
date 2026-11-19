import { describe, expect, it } from 'vitest';
import { PUBLIC_HTML, cacheControlFor, isPersonalPath } from './cachePolicy';

const base = { method: 'GET', status: 200, current: null, setsCookie: false, isHtml: true, cdn: true };

describe('isPersonalPath', () => {
  it('covers every per-shopper page and API', () => {
    for (const p of [
      '/karfa/',
      '/gera-upp/',
      '/gera-upp/order-received/123/',
      '/min-sida/',
      '/min-sida/view-order/5/',
      '/oskalisti/',
      '/utskra/x',
      '/api/cart',
      '/api/cart/update',
      '/api/checkout',
      '/api/order',
      '/api/account/login',
    ])
      expect(isPersonalPath(p), p).toBe(true);
  });

  it('leaves the public catalogue and public APIs out', () => {
    for (const p of ['/', '/verslun/', '/verslun/skor/vara-1/', '/voruflokkur/skor/', '/karfan-min/', '/api/products', '/api/posturinn/droppoints', '/sitemap.xml', '/api/healthz', '/api/cartoon'])
      expect(isPersonalPath(p), p).toBe(false);
  });
});

describe('cacheControlFor', () => {
  it('makes personal pages private, no-store even when a route asked for something public', () => {
    expect(cacheControlFor({ ...base, path: '/karfa/' })).toBe('private, no-store');
    expect(cacheControlFor({ ...base, path: '/gera-upp/order-received/9/', current: 'public, max-age=60' })).toBe('private, no-store');
    expect(cacheControlFor({ ...base, path: '/api/cart', isHtml: false, current: 'no-store' })).toBe('private, no-store');
  });

  it('makes any response that sets a cookie private, no-store, whatever the path', () => {
    expect(cacheControlFor({ ...base, path: '/verslun/', setsCookie: true })).toBe('private, no-store');
    expect(cacheControlFor({ ...base, path: '/sitemap.xml', isHtml: false, setsCookie: true, current: 'public, max-age=21600' })).toBe('private, no-store');
  });

  it('never lets an error or an outage be cached', () => {
    expect(cacheControlFor({ ...base, path: '/verslun/', status: 503, current: 'no-store' })).toBe('no-store');
    expect(cacheControlFor({ ...base, path: '/x/', status: 404 })).toBe('no-store');
    expect(cacheControlFor({ ...base, path: '/x/', status: 500 })).toBe('no-store');
    expect(cacheControlFor({ ...base, path: '/api/posturinn/droppoints', isHtml: false, status: 502, current: 'public, max-age=600' })).toBe('no-store');
  });

  it('keeps an explicit public policy a route chose for a 200 (sitemap, droppoints)', () => {
    expect(cacheControlFor({ ...base, path: '/sitemap.xml', isHtml: false, current: 'public, max-age=21600, stale-while-revalidate=86400' })).toBe(
      'public, max-age=21600, stale-while-revalidate=86400',
    );
    expect(cacheControlFor({ ...base, path: '/api/posturinn/droppoints', isHtml: false, current: 'public, max-age=600' })).toBe('public, max-age=600');
  });

  it('lets the CDN hold public HTML for five minutes while browsers revalidate every time', () => {
    expect(PUBLIC_HTML).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    expect(cacheControlFor({ ...base, path: '/' })).toBe(PUBLIC_HTML);
    expect(cacheControlFor({ ...base, path: '/verslun/skor/vara-1/' })).toBe(PUBLIC_HTML);
    expect(cacheControlFor({ ...base, path: '/voruflokkur/skor/', method: 'HEAD' })).toBe(PUBLIC_HTML);
  });

  it('keeps public HTML out of the CDN while the shop is closed for maintenance, and for any status but 200', () => {
    expect(cacheControlFor({ ...base, path: '/', cdn: false })).toBe('no-cache');
    expect(cacheControlFor({ ...base, path: '/', status: 206 })).toBe('no-cache');
  });

  it('never lets the CDN hold a personal page, a cookie-setting page or a non-GET, whatever else is true', () => {
    for (const input of [
      { ...base, path: '/min-sida/' },
      { ...base, path: '/karfa/' },
      { ...base, path: '/', setsCookie: true },
      { ...base, path: '/', method: 'POST' },
      { ...base, path: '/x/', status: 404 },
      { ...base, path: '/', status: 503 },
    ])
      expect(cacheControlFor(input), JSON.stringify(input)).not.toContain('public');
  });

  it('gives other un-labelled responses and every non-GET no-store', () => {
    expect(cacheControlFor({ ...base, path: '/api/products', isHtml: false })).toBe('no-store');
    expect(cacheControlFor({ ...base, path: '/api/contact', method: 'POST', isHtml: false })).toBe('no-store');
    expect(cacheControlFor({ ...base, path: '/api/contact', method: 'POST', isHtml: false, current: 'public, max-age=60' })).toBe('no-store');
  });

  it('leaves a public redirect as the route made it', () => {
    expect(cacheControlFor({ ...base, path: '/verslun', status: 301 })).toBeNull();
    expect(cacheControlFor({ ...base, path: '/min-sida', status: 301 })).toBe('private, no-store');
  });
});
