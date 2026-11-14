// The checkout's "Stofna aðgang" call to WordPress (lib/account createAccountFromOrder): what it sends, and how each
// answer is read. WordPress is a stubbed fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'https://wp.test', WOOCOMMERCE_CONSUMER_KEY: 'ck', WOOCOMMERCE_CONSUMER_SECRET: 'cs' }));

const { createAccountFromOrder } = await import('./account');
const TOKEN = 'aaa.bbb.ccc-_1';
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createAccountFromOrder', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (impl: () => Promise<Response>) => {
    const f = vi.fn(impl);
    vi.stubGlobal('fetch', f);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return f;
  };

  it('sends the order id and key to WordPress and returns the sign-in token of a new account', async () => {
    const f = stub(async () => answer(200, { ok: true, token: TOKEN }));
    expect(await createAccountFromOrder(55, 'wc_order_k')).toEqual({ token: TOKEN, retry: false });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://wp.test/wp-json/mos/v1/account/from-order');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ order_id: 55, order_key: 'wc_order_k' });
  });

  it('has no token when no account was made (the e-mail already has one)', async () => {
    stub(async () => answer(200, { ok: true }));
    expect(await createAccountFromOrder(55, 'k')).toEqual({ token: null, retry: false });
  });

  it('refuses a token that is not a JWT', async () => {
    for (const token of ['x', 'a.b', 'a.b.c d', 12, null, { a: 1 }]) {
      stub(async () => answer(200, { ok: true, token }));
      expect((await createAccountFromOrder(55, 'k')).token).toBeNull();
    }
  });

  it('asks again later only when WordPress failed or did not answer', async () => {
    stub(async () => answer(400, { code: 'mos_account_order' }));
    expect(await createAccountFromOrder(55, 'k')).toEqual({ token: null, retry: false });
    stub(async () => answer(429, {}));
    expect((await createAccountFromOrder(55, 'k')).retry).toBe(false);
    stub(async () => answer(502, {}));
    expect(await createAccountFromOrder(55, 'k')).toEqual({ token: null, retry: true });
    stub(async () => {
      throw new Error('timeout');
    });
    expect(await createAccountFromOrder(55, 'k')).toEqual({ token: null, retry: true });
  });
});
