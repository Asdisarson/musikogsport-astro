import { describe, expect, it } from 'vitest';
import { PUBLIC_HTML } from './cachePolicy';
import { finishResponse } from './responseHeaders';
import { securityHeaders } from './securityHeaders.mjs';

const HEADERS = securityHeaders({ mediaBaseUrl: 'https://musikogsport.is' });
const html = (status = 200, extra: Record<string, string> = {}) =>
  new Response('<!doctype html>', { status, headers: { 'Content-Type': 'text/html', ...extra } });
const req = (path: string, method = 'GET', cookiesPending = false, cdn = true) => ({ path, method, cookiesPending, cdn, headers: HEADERS });

describe('finishResponse', () => {
  it('adds every security header and the CDN policy to a public page', () => {
    const res = finishResponse(html(), req('/verslun/'));
    for (const [name, value] of HEADERS) expect(res.headers.get(name)).toBe(value);
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe(PUBLIC_HTML);
  });

  it('keeps a public page out of the CDN while the shop is closed for maintenance', () => {
    expect(finishResponse(html(), req('/verslun/', 'GET', false, false)).headers.get('Cache-Control')).toBe('no-cache');
  });

  it('marks a page that sets cookies private, no-store', () => {
    expect(finishResponse(html(), req('/', 'GET', true)).headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('keeps the 503 + Retry-After outage answer uncacheable', () => {
    const res = finishResponse(html(503, { 'Retry-After': '30', 'Cache-Control': 'no-store' }), req('/verslun/'));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('copies a response whose headers are immutable (one passed through from fetch) instead of throwing', async () => {
    const frozen = Response.redirect('https://musikogsport.is/verslun/', 301); // Response.redirect headers are immutable
    expect(() => frozen.headers.set('X-Test', '1')).toThrow();
    const res = finishResponse(frozen, req('/verslun'));
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://musikogsport.is/verslun/');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('labels a JSON API without its own policy no-store and a personal one private, no-store', () => {
    const json = () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    expect(finishResponse(json(), req('/api/products')).headers.get('Cache-Control')).toBe('no-store');
    expect(finishResponse(json(), req('/api/cart')).headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('finishResponse: stock-filtered listings', () => {
  it('sends a stock-filtered listing private, no-store, alone or with other filters', () => {
    expect(finishResponse(html(), { ...req('/verslun/skor/'), query: new URLSearchParams('lager=1') }).headers.get('Cache-Control')).toBe('private, no-store');
    expect(finishResponse(html(), { ...req('/verslun/page/2/'), query: new URLSearchParams('utsala=1&lager=1') }).headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('keeps the public policy for the same listing without the stock filter', () => {
    expect(finishResponse(html(), { ...req('/verslun/skor/'), query: new URLSearchParams('utsala=1') }).headers.get('Cache-Control')).toBe(PUBLIC_HTML);
    expect(finishResponse(html(), req('/verslun/skor/')).headers.get('Cache-Control')).toBe(PUBLIC_HTML);
  });
});
