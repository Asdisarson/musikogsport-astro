// The lost-password request tells the shopper "sent" only when WordPress took the request. A refusal (the store-wide
// limit's 429, a 5xx) or no answer at all is an error to retry: the answer still depends only on WordPress being
// reachable, never on whether the account exists, so there is no enumeration.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: '', MOS_TRUSTED_PROXY_HOPS: 0 }));

function ctx(login = 'jon@example.is') {
  const url = new URL('https://musikogsport.is/api/account/lost-password');
  const body = new URLSearchParams({ user_login: login });
  const request = new Request(url, { method: 'POST', body, headers: { Origin: url.origin } });
  return {
    request, url, clientAddress: '203.0.113.7', cookies: { get: () => undefined },
    redirect: (to: string, status = 302) => new Response(null, { status, headers: { Location: to } }),
  } as never;
}

async function post(fetchImpl: () => Promise<Response>) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { POST } = await import('../pages/api/account/lost-password');
  const res = await POST(ctx());
  return res.headers.get('Location');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/account/lost-password', () => {
  it('says "sent" when WordPress took the request', async () => {
    expect(await post(async () => new Response('{}', { status: 200 }))).toBe('/min-sida/lost-password/?sent=1');
  });

  it.each([429, 500, 502])('says the request was not sent when WordPress answers %i', async (status) => {
    expect(await post(async () => new Response('{}', { status }))).toBe('/min-sida/lost-password/?error=notsent');
  });

  it('says the request was not sent when WordPress is unreachable', async () => {
    expect(await post(async () => { throw new TypeError('fetch failed'); })).toBe('/min-sida/lost-password/?error=notsent');
  });
});
