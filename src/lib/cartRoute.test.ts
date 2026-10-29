// CO-02: every page view reads the cart (the header badge), so a visitor with no cart token gets an empty cart from
// here: no WordPress round trip and no wc_cart_token cookie for people who never touch the cart. The first add
// still primes a token (ensureToken).
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));
const getCart = vi.fn(async (_token: unknown) => ({ status: 200, ok: true, data: { items: [{ key: 'k' }], items_count: 1 }, cartToken: 'rotated' }));
const addItem = vi.fn(async (_body: unknown, _token: unknown) => ({ status: 201, ok: true, data: { items: [], items_count: 1 }, cartToken: 'after-add' }));
vi.mock('./storeApi', () => ({ getCart: (t: unknown) => getCart(t), addItem: (b: unknown, t: unknown) => addItem(b, t) }));

function ctx(jarInit: Record<string, string> = {}, init: { method?: string; body?: unknown } = {}) {
  const url = new URL('https://musikogsport.is/api/cart');
  const jar = new Map(Object.entries(jarInit));
  const sets: string[] = [];
  const request = new Request(url, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'Content-Type': 'application/json' } : {},
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return {
    c: {
      request, url, clientAddress: '192.0.2.77',
      cookies: { get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => { sets.push(k); jar.set(k, v); }, delete: (k: string) => jar.delete(k) },
    } as never,
    jar, sets,
  };
}

describe('GET /api/cart (CO-02)', () => {
  it('answers an empty cart locally for a visitor without a cart token: no upstream call, no cookie', async () => {
    const { GET } = await import('../pages/api/cart/index');
    getCart.mockClear();
    const { c, sets } = ctx();
    const res = await GET(c);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const cart = await res.json();
    expect(cart).toMatchObject({ items: [], items_count: 0, coupons: [], needs_payment: false, needs_shipping: false, shipping_rates: [] });
    expect(cart.totals).toMatchObject({ total_price: '0', currency_code: 'ISK', currency_minor_unit: 0 });
    expect(getCart).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });

  it('reads the Store API cart when the visitor has one', async () => {
    const { GET } = await import('../pages/api/cart/index');
    getCart.mockClear();
    const { c, jar } = ctx({ wc_cart_token: 'tok' });
    const res = await GET(c);
    expect(getCart).toHaveBeenCalledWith('tok');
    expect((await res.json()).items_count).toBe(1);
    expect(jar.get('wc_cart_token')).toBe('rotated');
  });

  it('still primes a token on the first add', async () => {
    const { POST } = await import('../pages/api/cart/index');
    getCart.mockClear();
    const { c, jar } = ctx({}, { method: 'POST', body: { id: 5, quantity: 1 } });
    await POST(c);
    expect(getCart).toHaveBeenCalledWith(null);
    expect(addItem.mock.calls[0][1]).toBe('rotated');
    expect(jar.get('wc_cart_token')).toBe('after-add');
  });
});
