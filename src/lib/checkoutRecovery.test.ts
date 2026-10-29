// LM-01, server side: what an order found by its checkout attempt id means for the shopper, and the two routes that
// use it (/api/checkout after a lost answer, /api/checkout/status for the browser's follow-up). Upstream is mocked:
// no order is ever placed, and the checkout is never sent twice.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));

const checkout = vi.fn();
vi.mock('./storeApi', () => ({
  getCart: vi.fn(async () => ({ status: 200, ok: true, data: { items: [] }, cartToken: 'primed' })),
  checkout: (...a: unknown[]) => checkout(...a),
}));
const findAttemptOrder = vi.fn();
vi.mock('./woo', () => ({ findAttemptOrder: (...a: unknown[]) => findAttemptOrder(...a) }));
const readAuthToken = vi.fn((): string | null => null);
const verifiedUser = vi.fn();
vi.mock('./auth', () => ({ readAuthToken: () => readAuthToken(), verifiedUser: (...a: unknown[]) => verifiedUser(...a) }));
const linkOrderToSignedIn = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./account', () => ({ linkOrderToSignedIn: (...a: unknown[]) => linkOrderToSignedIn(...a) }));

const ATTEMPT = '0123456789abcdef0123456789abcdef';
const attemptOrder = (status: string, payment_method = 'bacs') => ({ id: 501, status, order_key: 'wc_order_found', payment_method });

describe('classifyAttemptOrder', () => {
  it('maps WooCommerce statuses to what the shopper is told', async () => {
    const { classifyAttemptOrder } = await import('./checkoutRecovery');
    expect(classifyAttemptOrder(null)).toEqual({ state: 'unconfirmed', reason: 'none' });
    for (const s of ['on-hold', 'processing', 'completed']) {
      expect(classifyAttemptOrder(attemptOrder(s)), s).toEqual({ state: 'placed', orderId: 501, orderKey: 'wc_order_found' });
    }
    // A card order is pending until the shopper pays on the hosted page: no money moved, Panta again reuses it.
    expect(classifyAttemptOrder(attemptOrder('pending', 'straumur'))).toEqual({ state: 'awaiting-payment', orderId: 501 });
    expect(classifyAttemptOrder(attemptOrder('failed', 'straumur'))).toEqual({ state: 'awaiting-payment', orderId: 501 });
    // Bank transfer goes pending -> on-hold inside the same request: pending means it is still running.
    expect(classifyAttemptOrder(attemptOrder('pending', 'bacs'))).toEqual({ state: 'unconfirmed', reason: 'in-progress' });
    expect(classifyAttemptOrder(attemptOrder('checkout-draft'))).toEqual({ state: 'unconfirmed', reason: 'in-progress' });
    for (const s of ['cancelled', 'refunded', 'trash']) expect(classifyAttemptOrder(attemptOrder(s)).state, s).toBe('unconfirmed');
  });

  it('recoverCheckoutAttempt: an outage is unconfirmed, never an error', async () => {
    findAttemptOrder.mockRejectedValueOnce(new Error('WooCommerce GET /orders -> 503'));
    const { recoverCheckoutAttempt } = await import('./checkoutRecovery');
    expect(await recoverCheckoutAttempt(ATTEMPT)).toEqual({ state: 'unconfirmed', reason: 'unavailable' });
  });
});

let ip = 0;
function ctx(path: string, body: unknown, opts: { origin?: string; jar?: Record<string, string> } = {}) {
  const url = new URL(`https://musikogsport.is${path}`);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.origin) headers.Origin = opts.origin;
  const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const jar = new Map<string, string>(Object.entries(opts.jar ?? { wc_cart_token: 'tok' }));
  return {
    ctx: {
      request, url, clientAddress: `192.0.2.${ip}`,
      cookies: { get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) },
    } as never,
    jar,
  };
}
const form = {
  billing_address: { first_name: 'A', last_name: 'B', email: 'a@b.is', phone: '6123456', address_1: 'X 1', city: 'R', postcode: '101', country: 'IS' },
  payment_method: 'bacs',
  extensions: { mos: { kennitala: null, skiptimidi: false, attempt: ATTEMPT } },
};
const lost = { status: 504, ok: false, data: { message: 'Þjónustan svaraði ekki, reyndu aftur.' }, cartToken: null, transportFailure: 'timeout' };

describe('/api/checkout', () => {
  beforeEach(() => {
    ip += 1;
    checkout.mockReset();
    findAttemptOrder.mockReset();
    linkOrderToSignedIn.mockClear();
    readAuthToken.mockReturnValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('LM-03: forwards only the allowed fields, keeping the attempt id', async () => {
    checkout.mockResolvedValue({ status: 400, ok: false, data: { code: 'x', message: 'Nei' }, cartToken: 'tok' });
    const { POST } = await import('../pages/api/checkout');
    const { ctx: c } = ctx('/api/checkout', { ...form, create_account: true, customer_password: 'pw', expected_total: '0', extensions: { ...form.extensions, other: { a: 1 } } });
    await POST(c);
    const sent = checkout.mock.calls[0][0];
    expect(sent).not.toHaveProperty('create_account');
    expect(sent).not.toHaveProperty('customer_password');
    expect(sent).not.toHaveProperty('expected_total');
    expect(sent.extensions).toEqual({ mos: { kennitala: null, skiptimidi: false, attempt: ATTEMPT } });
  });

  it('LM-01: makes an attempt id when the browser sent none, so its own recovery still works', async () => {
    checkout.mockResolvedValue(lost);
    findAttemptOrder.mockResolvedValue(null);
    const { POST } = await import('../pages/api/checkout');
    const { ctx: c } = ctx('/api/checkout', { ...form, extensions: { mos: { kennitala: null, skiptimidi: false } } });
    await POST(c);
    const made = checkout.mock.calls[0][0].extensions.mos.attempt;
    expect(made).toMatch(/^[0-9a-f]{32}$/);
    expect(findAttemptOrder).toHaveBeenCalledWith(made);
  });

  it('CO-21: an order without a payment method goes to WooCommerce; its refusal is shown in Icelandic', async () => {
    checkout.mockResolvedValue({ status: 400, ok: false, data: { code: 'woocommerce_rest_checkout_missing_payment_method', message: 'No payment method provided.' }, cartToken: 'tok' });
    const { POST } = await import('../pages/api/checkout');
    const { payment_method: _drop, ...free } = form;
    const res = await POST(ctx('/api/checkout', free).ctx);
    expect(checkout).toHaveBeenCalledTimes(1);
    expect(checkout.mock.calls[0][0]).not.toHaveProperty('payment_method');
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Veldu greiðslumáta.');
  });

  it('LM-01: no answer, but the order was placed -> the receipt cookie, never a second checkout', async () => {
    checkout.mockResolvedValue(lost);
    findAttemptOrder.mockResolvedValue(attemptOrder('on-hold'));
    const { POST } = await import('../pages/api/checkout');
    const { ctx: c, jar } = ctx('/api/checkout', form);
    const res = await POST(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkout: 'placed', order_id: 501 });
    expect(JSON.parse(jar.get('mos_order')!)).toEqual({ id: 501, key: 'wc_order_found', seen: false });
    expect(jar.get('wc_cart_token')).toBe('tok'); // the cart token is kept, never replaced
    expect(checkout).toHaveBeenCalledTimes(1);
    expect(findAttemptOrder).toHaveBeenCalledWith(ATTEMPT);
  });

  it('LM-01: a recovered order of a signed-in shopper goes on their account, as a normal one does', async () => {
    checkout.mockResolvedValue(lost);
    findAttemptOrder.mockResolvedValue(attemptOrder('processing'));
    readAuthToken.mockReturnValue('a.b.c');
    verifiedUser.mockResolvedValue({ id: 12 });
    const { POST } = await import('../pages/api/checkout');
    await POST(ctx('/api/checkout', form).ctx);
    expect(linkOrderToSignedIn).toHaveBeenCalledWith('a.b.c', 501, { id: 12 });
  });

  it('LM-01: a card order whose payment page never opened -> 409 awaiting-payment, no receipt cookie', async () => {
    checkout.mockResolvedValue(lost);
    findAttemptOrder.mockResolvedValue(attemptOrder('pending', 'straumur'));
    const { POST } = await import('../pages/api/checkout');
    const { ctx: c, jar } = ctx('/api/checkout', form);
    const res = await POST(c);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ checkout: 'awaiting-payment', order_id: 501 });
    expect(jar.has('mos_order')).toBe(false);
  });

  it('LM-01: not found yet, or WordPress down -> 504 unconfirmed with the careful message', async () => {
    const { POST } = await import('../pages/api/checkout');
    const { UNCONFIRMED_MESSAGE } = await import('./checkoutFlow');
    for (const lookup of [() => findAttemptOrder.mockResolvedValue(null), () => findAttemptOrder.mockRejectedValue(new Error('down'))]) {
      checkout.mockResolvedValue(lost);
      lookup();
      const { ctx: c, jar } = ctx('/api/checkout', form);
      const res = await POST(c);
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({ checkout: 'unconfirmed', message: UNCONFIRMED_MESSAGE });
      expect(jar.has('mos_order')).toBe(false);
    }
  });

  it("LM-01: a proxy's 504 page in front of WordPress counts as no answer", async () => {
    checkout.mockResolvedValue({ status: 504, ok: false, data: '<html>Gateway Time-out</html>', cartToken: null });
    findAttemptOrder.mockResolvedValue(attemptOrder('on-hold'));
    const { POST } = await import('../pages/api/checkout');
    expect((await POST(ctx('/api/checkout', form).ctx)).status).toBe(200);
  });

  // SR-17: WooCommerce can answer with its own error after it placed the order. BACS marks the order on-hold and fires
  // the status hooks (emails, other plugins') BEFORE it empties the cart; an exception there comes back as a coded 400
  // while the order exists. On-hold orders are not reused, so a retry with the full cart would make a second order.
  it('SR-17: a coded error answer for an order that WAS placed -> placed (receipt cookie), never the error', async () => {
    checkout.mockResolvedValue({
      status: 400, ok: false, cartToken: 'tok2',
      data: { code: 'woocommerce_rest_checkout_process_payment_error', message: 'Villa í tengdri viðbót' },
    });
    findAttemptOrder.mockResolvedValue(attemptOrder('on-hold'));
    const { POST } = await import('../pages/api/checkout');
    const { ctx: c, jar } = ctx('/api/checkout', form);
    const res = await POST(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkout: 'placed', order_id: 501 });
    expect(JSON.parse(jar.get('mos_order')!)).toEqual({ id: 501, key: 'wc_order_found', seen: false });
    expect(checkout).toHaveBeenCalledTimes(1); // the order is never sent twice
    expect(findAttemptOrder).toHaveBeenCalledWith(ATTEMPT);
  });

  it("SR-17: WooCommerce's own error stands when no order was placed for the attempt (looked up once, read-only)", async () => {
    const { POST } = await import('../pages/api/checkout');
    const errors = [
      { status: 500, data: { code: 'woocommerce_rest_unknown_server_error', message: 'x' } },
      { status: 400, data: { code: 'mos_invalid_kennitala', message: 'Kennitala á að vera 10 tölustafir.' } },
    ];
    for (const e of errors) {
      for (const found of [null, attemptOrder('pending', 'straumur'), attemptOrder('cancelled')]) {
        checkout.mockResolvedValue({ ...e, ok: false, cartToken: 'tok' });
        findAttemptOrder.mockReset();
        findAttemptOrder.mockResolvedValue(found);
        const { ctx: c, jar } = ctx('/api/checkout', form);
        const res = await POST(c);
        expect(res.status).toBe(e.status);
        expect((await res.json()).code).toBe(e.data.code);
        expect(findAttemptOrder).toHaveBeenCalledTimes(1);
        expect(jar.has('mos_order')).toBe(false);
      }
    }
  });

  it("SR-17: an outage of the lookup leaves WooCommerce's own error as it was", async () => {
    checkout.mockResolvedValue({ status: 400, ok: false, data: { code: 'x', message: 'Nei' }, cartToken: 'tok' });
    findAttemptOrder.mockRejectedValue(new Error('down'));
    const { POST } = await import('../pages/api/checkout');
    const res = await POST(ctx('/api/checkout', form).ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Nei');
  });
});

describe('/api/checkout/status', () => {
  beforeEach(() => {
    ip += 1;
    findAttemptOrder.mockReset();
    readAuthToken.mockReturnValue(null);
  });

  it('answers the state of the attempt, and sets the receipt cookie once the order is placed', async () => {
    const { POST } = await import('../pages/api/checkout/status');
    findAttemptOrder.mockResolvedValueOnce(null);
    let r = ctx('/api/checkout/status', { attempt: ATTEMPT });
    let res = await POST(r.ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkout: 'unconfirmed' });
    expect(r.jar.has('mos_order')).toBe(false);

    findAttemptOrder.mockResolvedValueOnce(attemptOrder('on-hold'));
    r = ctx('/api/checkout/status', { attempt: ATTEMPT });
    res = await POST(r.ctx);
    expect(await res.json()).toEqual({ checkout: 'placed', order_id: 501 });
    expect(JSON.parse(r.jar.get('mos_order')!)).toMatchObject({ id: 501, key: 'wc_order_found' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses a malformed attempt before asking WordPress, and a cross-site request', async () => {
    const { POST } = await import('../pages/api/checkout/status');
    for (const body of [{ attempt: 'x' }, {}, { attempt: ATTEMPT.toUpperCase() }]) {
      expect((await POST(ctx('/api/checkout/status', body).ctx)).status).toBe(400);
    }
    expect((await POST(ctx('/api/checkout/status', { attempt: ATTEMPT }, { origin: 'https://evil.example' }).ctx)).status).toBe(403);
    expect(findAttemptOrder).not.toHaveBeenCalled();
  });

  it('is limited per visitor (30 a minute)', async () => {
    findAttemptOrder.mockResolvedValue(null);
    const { POST } = await import('../pages/api/checkout/status');
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await POST(ctx('/api/checkout/status', { attempt: ATTEMPT }).ctx)).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
