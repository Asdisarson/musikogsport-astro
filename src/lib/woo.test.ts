// woo.ts: the REST key pair is read lazily (a build without it succeeds) and never reaches a log line, although it
// travels as query params on every request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const secrets: Record<string, string | undefined> = {};
vi.mock('astro:env/server', () => ({
  WP_INTERNAL_URL: 'http://wp.test',
  getSecret: (name: string) => secrets[name],
}));

const KEY = 'ck_live_0123456789abcdef';
const SECRET = 'cs_live_fedcba9876543210';

describe('woo.ts', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    const sink = (...args: unknown[]) => void out.push(args.map(String).join(' '));
    vi.spyOn(console, 'warn').mockImplementation(sink);
    vi.spyOn(console, 'error').mockImplementation(sink);
    vi.spyOn(console, 'log').mockImplementation(sink);
    secrets.WOOCOMMERCE_CONSUMER_KEY = KEY;
    secrets.WOOCOMMERCE_CONSUMER_SECRET = SECRET;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('imports without the secrets set (they are read when a request is made)', async () => {
    secrets.WOOCOMMERCE_CONSUMER_KEY = undefined;
    secrets.WOOCOMMERCE_CONSUMER_SECRET = undefined;
    const woo = await import('./woo');
    expect(typeof woo.wooGet).toBe('function');
    vi.stubGlobal('fetch', vi.fn());
    await expect(woo.wooGet('/products')).rejects.toThrow(/WOOCOMMERCE_CONSUMER_KEY/);
    expect(fetch).not.toHaveBeenCalled();
    // a missing secret is logged (else it would look like a WordPress outage), once a minute, not per request
    const missing = () => out.filter((l) => l.includes('is not set')).length;
    expect(missing()).toBe(1);
    expect(JSON.parse(out.find((l) => l.includes('is not set'))!).level).toBe('error');
    await expect(woo.wooSend('PUT', '/orders/1', {})).rejects.toThrow(/WOOCOMMERCE_CONSUMER_KEY/);
    expect(missing()).toBe(1);
  });

  it('sends the key pair on the request', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { wooGet } = await import('./woo');
    await wooGet('/products', { slug: 'x' });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('consumer_key')).toBe(KEY);
    expect(url.searchParams.get('consumer_secret')).toBe(SECRET);
  });

  it('keeps the key pair out of logs and out of the rethrown error when fetch fails with the URL in its message', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`Failed to parse URL from ${url}`); }));
    const { wooGet, wooSend } = await import('./woo');
    const getErr = await wooGet('/orders/5').catch((e: unknown) => e);
    const sendErr = await wooSend('PUT', '/orders/5', {}).catch((e: unknown) => e);
    expect(out.join('\n')).toContain('/orders/5'); // it was logged...
    for (const text of [out.join('\n'), String(getErr), String(sendErr), (getErr as Error).message, (sendErr as Error).message]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(SECRET);
    }
  });

  it('keeps the key pair out of logs on an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500, statusText: 'Internal Server Error' })));
    const { wooGet } = await import('./woo');
    await expect(wooGet('/products')).rejects.toThrow('WooCommerce GET /products -> 500');
    expect(out.join('\n')).toContain('/products');
    expect(out.join('\n')).not.toContain(KEY);
  });

  it('tags an HTTP failure with its status (WooHttpError), so callers can tell a 404/400 from an outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404, statusText: 'Not Found' })));
    const { wooGet, WooHttpError } = await import('./woo');
    const err = await wooGet('/customers/9').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WooHttpError);
    expect((err as InstanceType<typeof WooHttpError>).status).toBe(404);
    expect((err as Error).message).toBe('WooCommerce GET /customers/9 -> 404 Not Found');
  });

  it('leaves transport failures untagged (not a WooHttpError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const { wooGet, WooHttpError } = await import('./woo');
    const err = await wooGet('/customers/9').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(WooHttpError);
  });
});

// lookupOrder is the receipt's IDOR gate: REST answers any order to the admin key pair, so the order_key is compared
// here. LC-13: it tells "no such order / wrong key" (a miss, counted by /api/order) from "WordPress didn't answer"
// (an outage: 503, never counted as a miss).
describe('lookupOrder', () => {
  const order = {
    id: 42, number: '42', status: 'processing', order_key: 'wc_order_abc123', currency: 'ISK', total: '5990',
    payment_method: 'straumur', payment_method_title: 'Kort', date_created: '2026-10-01T10:00:00',
    discount_total: '0', discount_tax: '0',
    line_items: [{ name: 'Skór', quantity: 1, subtotal: '4790', subtotal_tax: '1200' }],
    shipping_lines: [{ method_title: 'Sótt', total: '0', total_tax: '0' }],
  };
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    secrets.WOOCOMMERCE_CONSUMER_KEY = KEY;
    secrets.WOOCOMMERCE_CONSUMER_SECRET = SECRET;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const serve = (status: number, body: unknown) => {
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('returns the non-PII summary for the right key', async () => {
    serve(200, order);
    const { lookupOrder } = await import('./woo');
    const got = await lookupOrder(42, 'wc_order_abc123');
    expect(got.state).toBe('found');
    const summary = got.state === 'found' ? got.order : null;
    expect(summary).toMatchObject({ order_number: '42', status: 'processing', paid: true, total: '5990', currency: 'ISK' });
    expect(JSON.stringify(summary)).not.toContain('wc_order_abc123');
  });

  it('answers not-found for a wrong key, a key of another length and an empty key', async () => {
    const f = serve(200, order);
    const { lookupOrder } = await import('./woo');
    expect(await lookupOrder(42, 'wc_order_abc124')).toEqual({ state: 'not-found' });
    expect(await lookupOrder(42, 'wc_order_abc12')).toEqual({ state: 'not-found' });
    const calls = f.mock.calls.length;
    expect(await lookupOrder(42, '')).toEqual({ state: 'not-found' });
    expect(f.mock.calls.length).toBe(calls); // no request without a key
  });

  it('answers not-found for an order without a string order_key and for a non-positive id', async () => {
    const f = serve(200, { ...order, order_key: undefined });
    const { lookupOrder } = await import('./woo');
    expect(await lookupOrder(42, 'wc_order_abc123')).toEqual({ state: 'not-found' });
    const calls = f.mock.calls.length;
    expect(await lookupOrder(0, 'wc_order_abc123')).toEqual({ state: 'not-found' });
    expect(await lookupOrder(-1, 'wc_order_abc123')).toEqual({ state: 'not-found' });
    expect(f.mock.calls.length).toBe(calls);
  });

  it("answers not-found for WooCommerce's 404 and 400 (no such order)", async () => {
    const { lookupOrder } = await import('./woo');
    serve(404, { code: 'woocommerce_rest_shop_order_invalid_id' });
    expect(await lookupOrder(42, 'wc_order_abc123')).toEqual({ state: 'not-found' });
    serve(400, { code: 'rest_invalid_param' });
    expect(await lookupOrder(42, 'wc_order_abc123')).toEqual({ state: 'not-found' });
  });

  it('answers unavailable for an outage: no answer, a 5xx, refused keys, unset keys (LC-13)', async () => {
    const { lookupOrder } = await import('./woo');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await lookupOrder(42, 'wc_order_abc123')).toEqual({ state: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }));
    expect(await lookupOrder(42, 'wc_order_abc123')).toEqual({ state: 'unavailable' });
    for (const status of [500, 502, 503, 401, 403, 429]) {
      serve(status, { code: 'x' });
      expect(await lookupOrder(42, 'wc_order_abc123'), String(status)).toEqual({ state: 'unavailable' });
    }
    secrets.WOOCOMMERCE_CONSUMER_SECRET = undefined;
    expect(await lookupOrder(42, 'wc_order_abc123')).toEqual({ state: 'unavailable' });
  });

  it('reports paid only for processing/completed', async () => {
    const { lookupOrder } = await import('./woo');
    for (const [status, paid] of [['pending', false], ['on-hold', false], ['completed', true], ['failed', false]] as const) {
      serve(200, { ...order, status });
      const got = await lookupOrder(42, 'wc_order_abc123');
      expect(got.state === 'found' && got.order.paid).toBe(paid);
    }
  });
});

// LM-01: the order a checkout attempt created, found by the attempt id mos-checkout-fields.php stores on it.
describe('findAttemptOrder', () => {
  const ATTEMPT = '0123456789abcdef0123456789abcdef';
  const row = (id: number, attempt: string | null, extra: Record<string, unknown> = {}) => ({
    id, status: 'on-hold', order_key: `wc_order_k${id}`, payment_method: 'bacs',
    meta_data: attempt ? [{ id: 9, key: '_mos_checkout_attempt', value: attempt }] : [],
    ...extra,
  });
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    secrets.WOOCOMMERCE_CONSUMER_KEY = KEY;
    secrets.WOOCOMMERCE_CONSUMER_SECRET = SECRET;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('asks the orders collection for this attempt only, with just the fields it needs', async () => {
    const f = vi.fn(async (_url: string) => new Response(JSON.stringify([row(77, ATTEMPT)]), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { findAttemptOrder } = await import('./woo');
    expect(await findAttemptOrder(ATTEMPT)).toEqual({ id: 77, status: 'on-hold', order_key: 'wc_order_k77', payment_method: 'bacs' });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.pathname).toBe('/wp-json/wc/v3/orders');
    expect(url.searchParams.get('mos_attempt')).toBe(ATTEMPT);
    expect(url.searchParams.get('include_meta')).toBe('_mos_checkout_attempt');
    expect(url.searchParams.get('_fields')).toBe('id,status,order_key,payment_method,meta_data');
  });

  it('never takes an order that does not carry this attempt (a WordPress without the filter answers the newest orders)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([row(90, null), row(89, 'ffffffffffffffffffffffffffffffff'), row(88, ATTEMPT)]), { status: 200 })));
    const { findAttemptOrder } = await import('./woo');
    expect((await findAttemptOrder(ATTEMPT))?.id).toBe(88);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([row(90, null), row(89, 'ffffffffffffffffffffffffffffffff')]), { status: 200 })));
    expect(await findAttemptOrder(ATTEMPT)).toBeNull();
  });

  it('answers null when no order has the attempt, and asks nothing for a malformed attempt id', async () => {
    const f = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { findAttemptOrder } = await import('./woo');
    expect(await findAttemptOrder(ATTEMPT)).toBeNull();
    const calls = f.mock.calls.length;
    for (const bad of ['', 'abc', ATTEMPT.toUpperCase(), `${ATTEMPT}0`, 'g'.repeat(32)]) expect(await findAttemptOrder(bad)).toBeNull();
    expect(f.mock.calls.length).toBe(calls);
  });

  it('throws on an outage (the caller says the outcome is unknown)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const { findAttemptOrder } = await import('./woo');
    await expect(findAttemptOrder(ATTEMPT)).rejects.toThrow();
  });
});

// LC-04: the 6 h sitemap sweep serves its stale copy on a failure, and must not re-run the ~7 s sweep for every
// later request while WooCommerce is still failing.
describe('listAllProductSlugs', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    secrets.WOOCOMMERCE_CONSUMER_KEY = KEY;
    secrets.WOOCOMMERCE_CONSUMER_SECRET = SECRET;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serves the stale list after a failed refresh and waits a minute before sweeping again', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify([{ slug: 'a', permalink: 'p', modified: 'm' }]), { status: 200, headers: { 'X-WP-TotalPages': '1' } }));
    vi.stubGlobal('fetch', ok);
    const { listAllProductSlugs } = await import('./woo');
    expect(await listAllProductSlugs()).toHaveLength(1);
    const down = vi.fn(async () => new Response('', { status: 502, statusText: 'Bad Gateway' }));
    vi.stubGlobal('fetch', down);
    vi.setSystemTime(6 * 60 * 60 * 1000 + 1); // stale
    expect(await listAllProductSlugs()).toHaveLength(1);
    expect(await listAllProductSlugs()).toHaveLength(1);
    expect(down).toHaveBeenCalledTimes(1);
    vi.setSystemTime(6 * 60 * 60 * 1000 + 61_000);
    expect(await listAllProductSlugs()).toHaveLength(1);
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('throws on a cold failure (the sitemap degrades to its static part)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const { listAllProductSlugs } = await import('./woo');
    await expect(listAllProductSlugs()).rejects.toThrow();
  });
});
