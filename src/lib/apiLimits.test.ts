// Per-visitor limits on the public /api/* routes (WordPress only ever sees this server, so they live here). The
// checkout route is limited (10 a minute, approved by the owner 2026-10-26); the calls the checkout page makes
// (customer address, shipping rate, coupon) are deliberately NOT limited (ticket 02, open for the owner's sign-off).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));
vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://musikogsport.is' }));

const checkout = vi.fn();
const cartOk = { status: 200, ok: true, data: { items: [] }, cartToken: 'tok' };
vi.mock('./storeApi', () => ({
  getCart: vi.fn(async () => cartOk),
  addItem: vi.fn(async () => cartOk),
  updateItem: vi.fn(async () => cartOk),
  removeItem: vi.fn(async () => cartOk),
  checkout: (...a: unknown[]) => checkout(...a),
}));
const lookupOrder = vi.fn();
vi.mock('./woo', () => ({ lookupOrder: (...a: unknown[]) => lookupOrder(...a), getProductsByIds: vi.fn(async () => []) }));
vi.mock('./catalogTerms', () => ({ loadCatalogTerms: vi.fn(async () => ({ categories: [] })) }));
vi.mock('./photoBgServer', () => ({ cardFillOf: () => null }));

let ip = 0;
/** A minimal APIContext for one visitor (a fresh address per test unless given). */
function ctx(path: string, opts: { method?: string; body?: unknown; addr?: string } = {}) {
  const url = new URL(`https://musikogsport.is${path}`);
  const request = new Request(url, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const jar = new Map<string, string>([['wc_cart_token', 'tok']]);
  return {
    request,
    url,
    clientAddress: opts.addr ?? `198.51.100.${ip}`,
    cookies: { get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) },
    redirect: (to: string, status = 302) => new Response(null, { status, headers: { Location: to } }),
  } as never;
}

async function hammer(call: () => Response | Promise<Response>, n: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await call()).status);
  return statuses;
}

beforeEach(() => {
  ip += 1;
});

async function expect429(res: Response) {
  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(typeof (await res.json()).message).toBe('string');
}

describe('cart mutations (add, update, remove): one shared per-visitor budget', () => {
  it('allows 120 a minute, then answers 429 with Retry-After', async () => {
    const add = (await import('../pages/api/cart/index')).POST;
    const update = (await import('../pages/api/cart/update')).POST;
    const statuses = await hammer(() => add(ctx('/api/cart', { method: 'POST', body: { id: 5, quantity: 1 } })), 119);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect((await update(ctx('/api/cart/update', { method: 'POST', body: { key: 'k', quantity: 2 } }))).status).toBe(200);
    await expect429(await update(ctx('/api/cart/update', { method: 'POST', body: { key: 'k', quantity: 2 } })));
    const remove = (await import('../pages/api/cart/remove')).POST;
    await expect429(await remove(ctx('/api/cart/remove', { method: 'POST', body: { key: 'k' } })));
  });

  it('counts each visitor separately', async () => {
    const add = (await import('../pages/api/cart/index')).POST;
    await hammer(() => add(ctx('/api/cart', { method: 'POST', body: { id: 5 }, addr: '203.0.113.1' })), 121);
    expect((await add(ctx('/api/cart', { method: 'POST', body: { id: 5 }, addr: '203.0.113.2' }))).status).toBe(200);
  });

  it('never limits reading the cart (every page view does it)', async () => {
    const get = (await import('../pages/api/cart/index')).GET;
    const statuses = await hammer(() => get(ctx('/api/cart')), 200);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

describe('/api/products (wishlist refresh)', () => {
  it('allows 60 a minute per visitor', async () => {
    const get = (await import('../pages/api/products')).GET;
    const statuses = await hammer(() => get(ctx('/api/products?ids=1,2')), 60);
    expect(statuses.every((s) => s === 200)).toBe(true);
    await expect429(await get(ctx('/api/products?ids=1,2')));
  });
});

describe('/api/posturinn/droppoints', () => {
  it('allows 60 a minute per visitor; a bad postcode costs nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true,"items":[]}', { status: 200 })));
    const get = (await import('../pages/api/posturinn/droppoints')).GET;
    expect(await hammer(() => get(ctx('/api/posturinn/droppoints?postcode=1')), 5)).toEqual([400, 400, 400, 400, 400]);
    const statuses = await hammer(() => get(ctx('/api/posturinn/droppoints?postcode=101')), 60);
    expect(statuses.every((s) => s === 200)).toBe(true);
    await expect429(await get(ctx('/api/posturinn/droppoints?postcode=101')));
    vi.unstubAllGlobals();
  });
});

describe('/api/order (order id + key guessing)', () => {
  it('counts only misses: 20 wrong guesses per 15 minutes, then 429', async () => {
    lookupOrder.mockResolvedValue({ state: 'not-found' });
    const get = (await import('../pages/api/order')).GET;
    const statuses = await hammer(() => get(ctx('/api/order?id=7&key=wc_order_guess')), 20);
    expect(statuses.every((s) => s === 404)).toBe(true);
    const calls = lookupOrder.mock.calls.length;
    await expect429(await get(ctx('/api/order?id=7&key=wc_order_guess')));
    expect(lookupOrder.mock.calls.length).toBe(calls); // refused before asking WooCommerce
  });

  it('LC-13: a WordPress outage answers 503 and never uses up a miss slot', async () => {
    lookupOrder.mockResolvedValue({ state: 'unavailable' });
    const get = (await import('../pages/api/order')).GET;
    const outage = await get(ctx('/api/order?id=7&key=wc_order_real'));
    expect(outage.status).toBe(503);
    expect(outage.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(outage.headers.get('Cache-Control')).toBe('no-store');
    expect(typeof (await outage.json()).message).toBe('string');
    const statuses = await hammer(() => get(ctx('/api/order?id=7&key=wc_order_real')), 40);
    expect(statuses.every((s) => s === 503)).toBe(true);
    lookupOrder.mockResolvedValue({ state: 'not-found' });
    const misses = await hammer(() => get(ctx('/api/order?id=7&key=wc_order_real')), 20);
    expect(misses.every((s) => s === 404)).toBe(true); // all 20 miss slots were still there
  });

  it('never limits the thank-you page poll of a real order (a found order gives its slot back)', async () => {
    lookupOrder.mockResolvedValue({ state: 'found', order: { order_number: '7', paid: false } });
    const get = (await import('../pages/api/order')).GET;
    const statuses = await hammer(() => get(ctx('/api/order?id=7&key=wc_order_real')), 100);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

describe('/api/checkout (order placing)', () => {
  const valid = { billing_address: { email: 'a@b.is' }, payment_method: 'bacs' };
  beforeEach(() => {
    checkout.mockReset();
    // A refused order: no cookie written, nothing placed. No real upstream is ever involved.
    checkout.mockResolvedValue({ status: 422, ok: false, data: { message: 'Hafnað.' }, cartToken: 'tok' });
  });

  it('allows 10 attempts a minute, then 429 before anything reaches WooCommerce', async () => {
    const post = (await import('../pages/api/checkout')).POST;
    const statuses = await hammer(() => post(ctx('/api/checkout', { method: 'POST', body: valid })), 10);
    expect(statuses.every((s) => s === 422)).toBe(true);
    expect(checkout).toHaveBeenCalledTimes(10);
    await expect429(await post(ctx('/api/checkout', { method: 'POST', body: valid })));
    expect(checkout).toHaveBeenCalledTimes(10);
  });

  it('counts each visitor separately', async () => {
    const post = (await import('../pages/api/checkout')).POST;
    await hammer(() => post(ctx('/api/checkout', { method: 'POST', body: valid, addr: '203.0.113.50' })), 11);
    expect((await post(ctx('/api/checkout', { method: 'POST', body: valid, addr: '203.0.113.51' }))).status).toBe(422);
  });

  it('starts a fresh window after a minute', async () => {
    vi.useFakeTimers();
    try {
      // The limiter captures Date.now when the module loads, so load a fresh copy under the fake clock.
      vi.resetModules();
      const post = (await import('../pages/api/checkout')).POST;
      const addr = '203.0.113.60';
      await hammer(() => post(ctx('/api/checkout', { method: 'POST', body: valid, addr })), 10);
      expect((await post(ctx('/api/checkout', { method: 'POST', body: valid, addr }))).status).toBe(429);
      vi.advanceTimersByTime(61_000);
      expect((await post(ctx('/api/checkout', { method: 'POST', body: valid, addr }))).status).toBe(422);
    } finally {
      vi.useRealTimers();
    }
  });
});
