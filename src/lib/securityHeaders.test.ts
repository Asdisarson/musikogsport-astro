import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, hstsEnabled, mediaOrigin, securityHeaders } from './securityHeaders.mjs';

const directives = (csp: string) => new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)]));

describe('securityHeaders', () => {
  const byName = (opts: Parameters<typeof securityHeaders>[0]) => new Map(securityHeaders(opts));

  it('sets the fixed hardening headers', () => {
    const h = byName({ mediaBaseUrl: 'https://musikogsport.is' });
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
    expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(h.get('X-Frame-Options')).toBe('DENY');
    const pp = h.get('Permissions-Policy')!;
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()']) expect(pp).toContain(feature);
  });

  it('ships the CSP as Report-Only, never as an enforced policy', () => {
    const h = byName({ mediaBaseUrl: 'https://musikogsport.is' });
    expect(h.has('Content-Security-Policy')).toBe(false);
    expect(h.get('Content-Security-Policy-Report-Only')).toBe(contentSecurityPolicy({ mediaBaseUrl: 'https://musikogsport.is' }));
  });

  it('leaves the CSP off when asked (static files: no document to protect)', () => {
    expect(byName({ mediaBaseUrl: 'https://musikogsport.is', csp: false }).has('Content-Security-Policy-Report-Only')).toBe(false);
  });

  it('adds HSTS only when switched on, without preload', () => {
    expect(byName({ mediaBaseUrl: 'https://musikogsport.is' }).has('Strict-Transport-Security')).toBe(false);
    expect(byName({ mediaBaseUrl: 'https://musikogsport.is', hsts: true }).get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('contentSecurityPolicy', () => {
  const csp = directives(contentSecurityPolicy({ mediaBaseUrl: 'https://wp.musikogsport.is/' }));

  it('forbids framing and plugins and pins base/form targets to this origin', () => {
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('default-src')).toEqual(["'self'"]);
  });

  it('allows scripts from this origin only, with samples in reports (no unsafe-inline, no unsafe-eval)', () => {
    expect(csp.get('script-src')).toEqual(["'self'", "'report-sample'"]);
  });

  it('allows inline styles (style attributes carry per-photo colours) but no other style hosts', () => {
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('allows images over https (supplier CDNs in product descriptions), data:/blob:, and the media host by origin', () => {
    expect(csp.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:', 'https://wp.musikogsport.is']);
    const local = directives(contentSecurityPolicy({ mediaBaseUrl: 'http://localhost:10025/' }));
    expect(local.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:', 'http://localhost:10025']);
  });

  it('keeps fetches on this origin (the islands only call /api/*) and allows Google Maps embeds', () => {
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    expect(csp.get('frame-src')).toEqual(["'self'", 'https://www.google.com', 'https://maps.google.com']);
  });

  it('never names the payment gateway: the Straumur hand-off is a top-level navigation, which CSP does not govern', () => {
    expect(contentSecurityPolicy({ mediaBaseUrl: 'https://musikogsport.is' })).not.toContain('straumur');
  });
});

describe('mediaOrigin', () => {
  it('reduces a base URL to its origin and refuses anything but http(s)', () => {
    expect(mediaOrigin('https://wp.musikogsport.is/some/path/')).toBe('https://wp.musikogsport.is');
    expect(mediaOrigin('http://localhost:10025')).toBe('http://localhost:10025');
    expect(mediaOrigin('javascript:alert(1)')).toBeNull();
    expect(mediaOrigin('not a url')).toBeNull();
    expect(mediaOrigin(undefined)).toBeNull();
  });

  it('leaves the media host out of img-src when it is unusable', () => {
    expect(directives(contentSecurityPolicy({ mediaBaseUrl: 'nope' })).get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:']);
  });
});

describe('hstsEnabled', () => {
  it('is on only for an explicit truthy MOS_HSTS', () => {
    for (const on of ['1', 'true', 'TRUE', 'on', 'yes']) expect(hstsEnabled(on)).toBe(true);
    for (const off of [undefined, '', '0', 'false', 'off', 'no', 'maybe']) expect(hstsEnabled(off)).toBe(false);
  });
});
