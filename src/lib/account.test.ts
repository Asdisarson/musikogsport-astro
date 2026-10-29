// account.ts: /min-sida/ data, always for the customer id of the verified session. The owner check, the order link
// retries and the address copy rule are pinned here (LM-11), and an outage is told apart from "not there" for the
// account pages (PA-04): a WooCommerce outage must not render as an empty address book or a missing order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({
  WP_INTERNAL_URL: 'http://wp.test',
  getSecret: (name: string) => ({ WOOCOMMERCE_CONSUMER_KEY: 'ck_test', WOOCOMMERCE_CONSUMER_SECRET: 'cs_test' })[name],
}));
const verifiedUser = vi.fn();
vi.mock('./auth', () => ({ verifiedUser: (...a: unknown[]) => verifiedUser(...a) }));

const { getCustomer, loadCustomer, getOwnOrder, attachOrderToCustomer, linkOrderToSignedIn, listOrders } = await import('./account');

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'ERR' });
let route: Route;
const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => route(new URL(String(input)), init));

beforeEach(() => {
  fetchMock.mockClear();
  verifiedUser.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const customer = { id: 7, email: 'a@b.is', first_name: 'Anna', last_name: 'Jóns', username: 'anna', billing: { city: 'Reykjavík' }, shipping: {} };
const order = {
  id: 50, number: '50', date_created: '2026-10-01T10:00:00', status: 'processing', total: '5990', customer_id: 7,
  payment_method_title: 'Kort', customer_note: '', discount_total: '0', discount_tax: '0',
  line_items: [{ name: 'Skór', quantity: 2, subtotal: '4790', subtotal_tax: '1200' }],
  shipping_lines: [], billing: { city: 'Reykjavík' }, shipping: {},
};

describe('loadCustomer / getCustomer (PA-04)', () => {
  it('reads the customer by the session id', async () => {
    route = () => json(customer);
    expect(await loadCustomer(7)).toMatchObject({ id: 7, first_name: 'Anna', display_name: 'Anna', billing: { city: 'Reykjavík' } });
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/wp-json/wc/v3/customers/7');
  });

  it('is null when WooCommerce has no such customer, or answers for another id', async () => {
    route = () => json({ code: 'woocommerce_rest_invalid_id' }, 404);
    expect(await loadCustomer(7)).toBeNull();
    route = () => json({ ...customer, id: 8 });
    expect(await loadCustomer(7)).toBeNull();
  });

  it("is 'unavailable' on an outage (transport failure, 5xx, refused keys), not an empty customer", async () => {
    route = () => {
      throw new TypeError('fetch failed');
    };
    expect(await loadCustomer(7)).toBe('unavailable');
    route = () => json({}, 503);
    expect(await loadCustomer(7)).toBe('unavailable');
    route = () => json({ code: 'woocommerce_rest_cannot_view' }, 401);
    expect(await loadCustomer(7)).toBe('unavailable');
  });

  it('getCustomer keeps its old contract for the checkout prefill: null on an outage', async () => {
    route = () => json({}, 503);
    expect(await getCustomer(7)).toBeNull();
    route = () => json(customer);
    expect((await getCustomer(7))?.email).toBe('a@b.is');
  });
});

describe('getOwnOrder', () => {
  it("returns the order only to its owner; someone else's order is null (same as a missing one)", async () => {
    route = () => json(order);
    expect(await getOwnOrder(7, 50)).toMatchObject({ id: 50, number: '50', customer_id: 7, items: 2 });
    expect(await getOwnOrder(8, 50)).toBeNull();
    route = () => json({ ...order, customer_id: 0 }); // a guest order
    expect(await getOwnOrder(7, 50)).toBeNull();
  });

  it("is null for a missing order (404/400) and 'unavailable' on an outage (PA-04)", async () => {
    route = () => json({ code: 'woocommerce_rest_shop_order_invalid_id' }, 404);
    expect(await getOwnOrder(7, 50)).toBeNull();
    route = () => json({ code: 'rest_invalid_param' }, 400);
    expect(await getOwnOrder(7, 50)).toBeNull();
    route = () => json({}, 500);
    expect(await getOwnOrder(7, 50)).toBe('unavailable');
    route = () => {
      throw new TypeError('fetch failed');
    };
    expect(await getOwnOrder(7, 50)).toBe('unavailable');
  });
});

describe('listOrders (PA-05)', () => {
  it('lists a page with item counts and the page total', async () => {
    route = () => new Response(JSON.stringify([{ ...order, line_items: [{ quantity: 2 }, { quantity: 1 }] }]), { status: 200, headers: { 'X-WP-TotalPages': '3' } });
    expect(await listOrders(7, 1)).toEqual({ totalPages: 3, orders: [{ id: 50, number: '50', date_created: order.date_created, status: 'processing', total: '5990', items: 3 }] });
  });

  it("answers 'out-of-range' for a page past the last (WooCommerce's 400), and still throws on an outage", async () => {
    route = () => json({ code: 'woocommerce_rest_invalid_page_number' }, 400);
    expect(await listOrders(7, 9)).toBe('out-of-range');
    route = () => json({}, 502);
    await expect(listOrders(7, 1)).rejects.toThrow();
  });
});

describe('attachOrderToCustomer (current behaviour, LM-11)', () => {
  it('sets customer_id, then copies the order addresses onto the account', async () => {
    const calls: { path: string; body: unknown }[] = [];
    route = (url, init) => {
      calls.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
      return url.pathname.includes('/orders/') ? json({ billing: { city: 'Akureyri' }, shipping: { city: 'Selfoss' } }) : json({ id: 7 });
    };
    expect(await attachOrderToCustomer(50, 7)).toBe(true);
    expect(calls).toEqual([
      { path: '/wp-json/wc/v3/orders/50', body: { customer_id: 7 } },
      { path: '/wp-json/wc/v3/customers/7', body: { billing: { city: 'Akureyri' }, shipping: { city: 'Selfoss' } } },
    ]);
  });

  it('skips the address copy when asked, and still counts a failed copy as linked', async () => {
    route = (url) => (url.pathname.includes('/orders/') ? json({ billing: {}, shipping: {} }) : json({ message: 'nope' }, 500));
    expect(await attachOrderToCustomer(50, 7, { copyAddresses: false })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await attachOrderToCustomer(50, 7)).toBe(true); // the copy failed, the link didn't
  });

  it('tries the link twice, then gives up without throwing', async () => {
    route = () => json({ message: 'down' }, 503);
    expect(await attachOrderToCustomer(50, 7)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('linkOrderToSignedIn (current behaviour, LM-11)', () => {
  it('links at once with the user WordPress named at order time, copying addresses', async () => {
    const bodies: unknown[] = [];
    route = (url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return url.pathname.includes('/orders/') ? json({ billing: { city: 'Vík' }, shipping: {} }) : json({ id: 7 });
    };
    await linkOrderToSignedIn('tok', 50, { id: 7, name: 'Anna', email: 'a@b.is' });
    expect(verifiedUser).not.toHaveBeenCalled();
    expect(bodies).toEqual([{ customer_id: 7 }, { billing: { city: 'Vík' }, shipping: {} }]);
  });

  it('asks again (fresh) while WordPress could not say, then links without copying addresses', async () => {
    vi.useFakeTimers();
    verifiedUser.mockResolvedValueOnce('unavailable').mockResolvedValueOnce({ id: 7, name: '', email: '' });
    route = () => json({ billing: {}, shipping: {} });
    const done = linkOrderToSignedIn('tok', 50, 'unavailable');
    await vi.advanceTimersByTimeAsync(5_000 + 30_000);
    await done;
    expect(verifiedUser).toHaveBeenCalledTimes(2);
    expect(verifiedUser).toHaveBeenCalledWith('tok', true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the link only: a late link never overwrites saved addresses
  });

  it('leaves a guest order when the session was signed out meanwhile, or WordPress never answers', async () => {
    vi.useFakeTimers();
    verifiedUser.mockResolvedValue(null);
    const a = linkOrderToSignedIn('tok', 50, 'unavailable');
    await vi.advanceTimersByTimeAsync(5_000);
    await a;
    verifiedUser.mockReset();
    verifiedUser.mockResolvedValue('unavailable');
    const b = linkOrderToSignedIn('tok', 51, 'unavailable');
    await vi.advanceTimersByTimeAsync(5_000 + 30_000 + 120_000);
    await b;
    expect(verifiedUser).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
