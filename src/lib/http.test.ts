import { describe, expect, it } from 'vitest';
import { authStatus, safeNext, sameOrigin, visitorIp } from './http';

describe('safeNext', () => {
  it('accepts a same-site path', () => {
    expect(safeNext('/min-sida/orders/', '/min-sida/')).toBe('/min-sida/orders/');
    expect(safeNext('/gera-upp/?x=1', '/min-sida/')).toBe('/gera-upp/?x=1');
  });

  it('falls back for absolute, protocol-relative or odd values (open-redirect guard)', () => {
    for (const bad of ['https://evil.example/', '//evil.example/', '/\\evil.example', 'javascript:alert(1)', '', undefined, 42]) {
      expect(safeNext(bad, '/min-sida/')).toBe('/min-sida/');
    }
  });

  it('falls back for values a Location header cannot carry (LC-01: the redirect would throw after sign-in)', () => {
    for (const bad of ['/€', '/vörur/', '/\u0000x', '/a\u0001b', '/a\u007fb', '/a\\b']) {
      expect(safeNext(bad, '/min-sida/')).toBe('/min-sida/');
    }
    // every accepted value really is a valid Location
    for (const good of ['/v%C3%B6rur/?s=sk%C3%B3r&p=1', '/min-sida/orders/2/', '/a~b!$&\'()*+,;=:@[]']) {
      expect(safeNext(good, '/min-sida/')).toBe(good);
      expect(() => new Response(null, { status: 303, headers: { Location: good } })).not.toThrow();
    }
  });
});

describe('sameOrigin', () => {
  const req = (origin?: string) => new Request('http://127.0.0.1:4322/api/account/login', { method: 'POST', headers: origin ? { Origin: origin } : {} });
  const local = new URL('http://127.0.0.1:4322/api/account/login');

  it('accepts our own origin, or no Origin header at all', () => {
    expect(sameOrigin(req('http://127.0.0.1:4322'), local)).toBe(true);
    expect(sameOrigin(req(), local)).toBe(true);
  });

  it('refuses a cross-site Origin', () => {
    expect(sameOrigin(req('https://evil.example'), local)).toBe(false);
  });

  it('compares against the public URL, not the proxied socket URL (TLS terminated in front of Node)', () => {
    // Behind the proxy request.url is http://…; Astro's ctx.url carries the validated X-Forwarded-Proto.
    const proxied = new Request('http://musikogsport.is/api/account/login', { method: 'POST', headers: { Origin: 'https://musikogsport.is' } });
    expect(sameOrigin(proxied, new URL('https://musikogsport.is/api/account/login'))).toBe(true);
    expect(sameOrigin(proxied, new URL('http://musikogsport.is/api/account/login'))).toBe(false);
  });
});

describe('visitorIp', () => {
  it('uses the socket address when no proxy is trusted', () => {
    expect(visitorIp(null, '10.0.0.5', 0)).toBe('10.0.0.5');
  });

  it('puts every forwarded request in one bucket when no proxy is trusted (the header is the client\'s own)', () => {
    // With security.allowedDomains set, Astro may already have copied the client-chosen first
    // X-Forwarded-For into clientAddress, so neither value can be trusted.
    expect(visitorIp('1.1.1.1', '1.1.1.1', 0)).toBe(visitorIp('9.9.9.9, 8.8.8.8', '9.9.9.9', 0));
  });

  it('keys IPv6 visitors by their /64, the block one subscriber controls', () => {
    expect(visitorIp('2001:db8:1:2:aaaa::1', '10.0.0.5', 1)).toBe(visitorIp('2001:db8:1:2:bbbb:cccc:dddd:eeee', '10.0.0.5', 1));
    expect(visitorIp('2001:db8:1:2::1', '10.0.0.5', 1)).not.toBe(visitorIp('2001:db8:1:3::1', '10.0.0.5', 1));
    expect(visitorIp(null, '::ffff:203.0.113.9', 0)).toBe('203.0.113.9');
  });

  it('takes the address the trusted proxy appended, ignoring whatever the client put in front', () => {
    expect(visitorIp('203.0.113.9', '10.0.0.5', 1)).toBe('203.0.113.9');
    expect(visitorIp('6.6.6.6, 203.0.113.9', '10.0.0.5', 1)).toBe('203.0.113.9');
    expect(visitorIp('6.6.6.6, 203.0.113.9, 10.0.0.2', '10.0.0.5', 2)).toBe('203.0.113.9');
  });

  it('falls back to the socket address when the header is missing or shorter than the hop count', () => {
    expect(visitorIp(null, '10.0.0.5', 1)).toBe('10.0.0.5');
    expect(visitorIp('', '10.0.0.5', 1)).toBe('10.0.0.5');
    expect(visitorIp('203.0.113.9', '10.0.0.5', 2)).toBe('10.0.0.5');
  });

  // App Platform: X-Forwarded-For ends in DO's ingress address, the visitor is in do-connecting-ip.
  it('prefers the trusted edge header (MOS_CLIENT_IP_HEADER) over X-Forwarded-For', () => {
    expect(visitorIp('203.0.113.9, 10.244.0.7', '10.244.0.7', 1, '198.51.100.4')).toBe('198.51.100.4');
    expect(visitorIp(null, '10.0.0.5', 0, '198.51.100.4')).toBe('198.51.100.4');
    expect(visitorIp(null, '10.0.0.5', 1, ' 2001:db8:1:2::1 ')).toBe(visitorIp(null, '10.0.0.5', 1, '2001:db8:1:2:ffff::9'));
  });

  it('takes the edge header\'s last entry, the one the edge itself added, if it ever carries a list', () => {
    expect(visitorIp(null, '10.0.0.5', 1, '6.6.6.6, 198.51.100.4')).toBe('198.51.100.4');
  });

  it('falls back to the hop logic when the edge header is absent or blank', () => {
    expect(visitorIp('6.6.6.6, 203.0.113.9', '10.0.0.5', 1, null)).toBe('203.0.113.9');
    expect(visitorIp('6.6.6.6, 203.0.113.9', '10.0.0.5', 1, '  ')).toBe('203.0.113.9');
    expect(visitorIp('6.6.6.6, 203.0.113.9', '10.0.0.5', 1, ' , ')).toBe('203.0.113.9');
  });
});

describe('authStatus', () => {
  it('treats a 2xx answer as a live session', () => {
    expect(authStatus(200)).toBe('ok');
  });

  it('treats WordPress refusing the token or credentials as final (401, or a jwt-auth 403)', () => {
    expect(authStatus(401, 'rest_not_logged_in')).toBe('rejected');
    expect(authStatus(403, 'jwt_auth_invalid_token')).toBe('rejected');
    expect(authStatus(403, '[jwt_auth] incorrect_password')).toBe('rejected');
  });

  it('treats outages, misconfiguration and foreign refusals as transient (keep the session, count no failure)', () => {
    for (const s of [null, 400, 404, 429, 500, 502, 503, 504]) expect(authStatus(s)).toBe('unavailable');
    expect(authStatus(403, 'jwt_auth_bad_config')).toBe('unavailable');
    expect(authStatus(403)).toBe('unavailable'); // a WAF page, not WordPress
  });
});

describe('markDegraded', () => {
  it('keeps a 200 with content missing out of every cache, and cachePolicy leaves that choice alone', async () => {
    const { markDegraded } = await import('./http');
    const { cacheControlFor } = await import('./cachePolicy');
    const response = { headers: new Headers() };
    markDegraded(response);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(cacheControlFor({ path: '/', method: 'GET', status: 200, current: 'no-store', setsCookie: false, isHtml: true, cdn: true })).toBe('no-store');
  });
});
