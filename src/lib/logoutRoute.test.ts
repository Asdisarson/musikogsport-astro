// LM-04: signing out also forgets this browser's cart (wc_cart_token: the Store API cart holds the shopper's
// addresses) and the last order's receipt cookie (mos_order holds its order key), as WooCommerce drops its session on
// logout. The cookies are deleted with the attributes they were set with.
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const revokeToken = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./auth', () => ({
  readAuthToken: () => 'a.b.c',
  revokeToken: (...a: unknown[]) => revokeToken(...a),
  clearAuth: (cookies: { delete: (k: string, o: unknown) => void }) => {
    cookies.delete('mos_auth', { path: '/' });
    cookies.delete('mos_li', { path: '/' });
  },
}));

function ctx(origin?: string) {
  const url = new URL('https://musikogsport.is/api/account/logout');
  const jar = new Map<string, string>([['mos_auth', 'a.b.c'], ['mos_li', '1'], ['wc_cart_token', 'tok'], ['mos_order', '{"id":1,"key":"k","seen":true}'], ['other', 'x']]);
  const deleted: [string, unknown][] = [];
  const cookies = {
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
    delete: (k: string, o: unknown) => { deleted.push([k, o]); jar.delete(k); },
  };
  const request = new Request(url, { method: 'POST', headers: origin ? { Origin: origin } : {} });
  return { c: { request, url, cookies, redirect: (to: string, status = 302) => new Response(null, { status, headers: { Location: to } }) } as never, jar, deleted };
}

describe('POST /api/account/logout (LM-04)', () => {
  it('clears the sign-in, the cart token and the order cookie, and nothing else', async () => {
    const { POST } = await import('../pages/api/account/logout');
    const { c, jar, deleted } = ctx();
    const res = await POST(c);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/min-sida/');
    expect([...jar.keys()]).toEqual(['other']);
    expect(revokeToken).toHaveBeenCalledWith('a.b.c');
    const opts = Object.fromEntries(deleted) as Record<string, Record<string, unknown>>;
    for (const name of ['wc_cart_token', 'mos_order']) {
      expect(opts[name], name).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax' });
      expect(typeof opts[name].secure, name).toBe('boolean');
    }
  });

  it('refuses a cross-site sign-out and leaves every cookie', async () => {
    const { POST } = await import('../pages/api/account/logout');
    const { c, jar } = ctx('https://evil.example');
    expect((await POST(c)).status).toBe(403);
    expect(jar.size).toBe(5);
  });
});
