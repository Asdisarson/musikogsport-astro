// checkoutFlow.ts: what the checkout page sends (CO-21) and what it does with every answer, including none (LM-01).
// Upstream is always a fake: no request leaves the test.
import { describe, expect, it, vi } from 'vitest';
import {
  AWAITING_PAYMENT_MESSAGE,
  UNCONFIRMED_MESSAGE,
  checkoutBody,
  parseCheckoutState,
  pollCheckoutStatus,
  submitCheckout,
  type CheckoutState,
  type FormAddress,
} from './checkoutFlow';
import { ATTEMPT_ID, newAttemptId } from './attemptId';

const addr = (over: Partial<FormAddress> = {}): FormAddress => ({
  first_name: ' Jón ', last_name: 'Jónsson', company: '', address_1: 'Laugavegur 1', address_2: '', postcode: '101',
  city: 'Reykjavík', phone: ' 6123456 ', email: ' jon@example.is ', ...over,
});
const base = {
  billing: addr(), ship: addr({ address_1: 'Skipholt 2' }), notes: '  takk  ', paymentMethod: 'bacs', needsPayment: true,
  kennitala: '010203-2390', skiptimidi: true, postbox: null as string | null, attempt: 'a'.repeat(32),
};

describe('newAttemptId', () => {
  it('is 32 lowercase hex characters and different every time', () => {
    const a = newAttemptId();
    expect(a).toMatch(ATTEMPT_ID);
    expect(newAttemptId()).not.toBe(a);
  });
});

describe('checkoutBody', () => {
  it('sends the form fields, trimmed, with the attempt id in extensions.mos', () => {
    const b = checkoutBody(base);
    expect(b.billing_address).toMatchObject({ first_name: 'Jón', email: 'jon@example.is', phone: '6123456', country: 'IS', state: '' });
    expect(b.shipping_address).toMatchObject({ address_1: 'Skipholt 2', phone: '6123456' });
    expect(b.shipping_address).not.toHaveProperty('email');
    expect(b.customer_note).toBe('takk');
    expect(b.payment_method).toBe('bacs');
    expect(b.payment_data).toEqual([]);
    expect(b.extensions).toEqual({ mos: { kennitala: '0102032390', skiptimidi: true, attempt: 'a'.repeat(32) } });
    expect(b).not.toHaveProperty('postis_dpo_postbox');
  });

  it('sends kennitala null when cleared, and the locker with the billing phone when one is chosen', () => {
    const b = checkoutBody({ ...base, kennitala: '  ', skiptimidi: false, postbox: 'DPO9552' });
    expect(b.extensions.mos).toMatchObject({ kennitala: null, skiptimidi: false });
    expect(b).toMatchObject({ postis_dpo_postbox: 'DPO9552', postis_dpo_phonenumber: '6123456' });
  });

  it('asks for an account only when the shopper ticked the box', () => {
    expect(checkoutBody({ ...base, createAccount: true }).mos_create_account).toBe(true);
    expect('mos_create_account' in checkoutBody(base)).toBe(false);
    expect('mos_create_account' in checkoutBody({ ...base, createAccount: false })).toBe(false);
  });

  it('sends no payment method for an order that needs no payment (CO-21: a free order is not a card or bank order)', () => {
    const b = checkoutBody({ ...base, needsPayment: false, paymentMethod: 'straumur' });
    expect(b).not.toHaveProperty('payment_method');
  });
});

describe('parseCheckoutState', () => {
  it('reads the three recovery states and nothing else', () => {
    expect(parseCheckoutState({ checkout: 'placed', order_id: 7 })).toEqual({ checkout: 'placed', order_id: 7 });
    expect(parseCheckoutState({ checkout: 'awaiting-payment', order_id: 7 })).toEqual({ checkout: 'awaiting-payment', order_id: 7 });
    expect(parseCheckoutState({ checkout: 'unconfirmed' })).toEqual({ checkout: 'unconfirmed' });
    expect(parseCheckoutState({ checkout: 'placed' })).toBeNull(); // no order id
    expect(parseCheckoutState({ checkout: 'placed', order_id: -1 })).toBeNull();
    expect(parseCheckoutState({ order_id: 7 })).toBeNull();
    expect(parseCheckoutState(null)).toBeNull();
  });
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noSleep = async () => {};

describe('pollCheckoutStatus', () => {
  it('asks /api/checkout/status with the attempt until the order shows up', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { checkout: 'unconfirmed' }))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json(200, { checkout: 'placed', order_id: 55 }));
    const s = await pollCheckoutStatus('b'.repeat(32), { fetchImpl: f, sleep: noSleep, tries: 6, intervalMs: 1 });
    expect(s).toEqual({ checkout: 'placed', order_id: 55 });
    expect(f).toHaveBeenCalledTimes(3);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/checkout/status');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ attempt: 'b'.repeat(32) });
  });

  it('gives up as unconfirmed after the last try, and at once on a 429', async () => {
    const f = vi.fn(async () => json(200, { checkout: 'unconfirmed' }));
    expect(await pollCheckoutStatus('b'.repeat(32), { fetchImpl: f, sleep: noSleep, tries: 4, intervalMs: 1 })).toEqual({ checkout: 'unconfirmed' });
    expect(f).toHaveBeenCalledTimes(4);
    const limited = vi.fn(async () => json(429, { message: 'x' }));
    expect(await pollCheckoutStatus('b'.repeat(32), { fetchImpl: limited, sleep: noSleep, tries: 4, intervalMs: 1 })).toEqual({ checkout: 'unconfirmed' });
    expect(limited).toHaveBeenCalledTimes(1);
  });
});

describe('submitCheckout', () => {
  const origin = 'https://musikogsport.is';
  const deps = (send: () => Promise<Response>, poll: (attempt: string) => Promise<CheckoutState> = vi.fn(async () => ({ checkout: 'unconfirmed' as const }))) => ({
    send: vi.fn(send), poll, origin, onRecovering: vi.fn(),
  });

  it('follows the payment page of a card order (cart kept: a declined card comes back to it)', async () => {
    const d = deps(async () => json(200, { order_id: 9, order_key: 'wc_order_k', payment_result: { redirect_url: 'https://pay.straumur.is/s/abc' } }));
    expect(await submitCheckout({ a: 1 }, 'c'.repeat(32), d)).toEqual({ kind: 'go', url: 'https://pay.straumur.is/s/abc', resetCart: false });
  });

  it("follows WordPress's pay-for-order page (Valitor) when the WordPress host is known", async () => {
    const url = 'https://wp.musikogsport.is/gera-upp/order-pay/9/?pay_for_order=true&key=wc_order_k';
    const answer = async () => json(200, { order_id: 9, order_key: 'wc_order_k', payment_result: { redirect_url: url } });
    expect(await submitCheckout({ a: 1 }, 'c'.repeat(32), { ...deps(answer), wpOrigin: 'https://wp.musikogsport.is' })).toEqual({ kind: 'go', url, resetCart: false });
    expect(await submitCheckout({ a: 1 }, 'c'.repeat(32), deps(answer))).toEqual({ kind: 'go', url: '/gera-upp/?straumurStatus=failed', resetCart: false });
  });

  it('goes to the receipt of a bank-transfer order', async () => {
    const d = deps(async () => json(200, { order_id: 9, order_key: 'wc_order_k', payment_result: { redirect_url: 'http://localhost:10026/gera-upp/order-received/9/?key=wc_order_k' } }));
    expect(await submitCheckout({}, 'c'.repeat(32), d)).toEqual({ kind: 'go', url: '/gera-upp/order-received/9/?key=wc_order_k', resetCart: false });
    const noRedirect = deps(async () => json(200, { order_id: 9, order_key: 'wc_order_k' }));
    expect(await submitCheckout({}, 'c'.repeat(32), noRedirect)).toEqual({ kind: 'go', url: '/gera-upp/order-received/9/?key=wc_order_k', resetCart: true });
  });

  it("shows WooCommerce's refusal (decoded) and never polls for it", async () => {
    const d = deps(async () => json(400, { code: 'x', message: 'Ógilt &quot;netfang&quot;' }));
    expect(await submitCheckout({}, 'c'.repeat(32), d)).toEqual({ kind: 'error', message: 'Ógilt "netfang"' });
    expect(d.poll).not.toHaveBeenCalled();
  });

  it('LM-01: no answer at all -> asks whether the order went through, and goes to the receipt when it did', async () => {
    const poll = vi.fn(async () => ({ checkout: 'placed' as const, order_id: 31 }));
    const d = deps(async () => { throw new TypeError('Failed to fetch'); }, poll);
    expect(await submitCheckout({}, 'd'.repeat(32), d)).toEqual({ kind: 'go', url: '/gera-upp/order-received/31/', resetCart: true });
    expect(poll).toHaveBeenCalledWith('d'.repeat(32));
    expect(d.onRecovering).toHaveBeenCalledTimes(1); // the page says it is checking, meanwhile
  });

  it("LM-01: the server's own time-out answer -> the same recovery", async () => {
    const poll = vi.fn(async () => ({ checkout: 'unconfirmed' as const }));
    const d = deps(async () => json(504, { checkout: 'unconfirmed', message: 'x' }), poll);
    expect(await submitCheckout({}, 'd'.repeat(32), d)).toEqual({ kind: 'error', message: UNCONFIRMED_MESSAGE });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('LM-01: a gateway time-out from a proxy in front of us (HTML 502/503/504) is treated as no answer', async () => {
    for (const status of [502, 503, 504]) {
      const poll = vi.fn(async () => ({ checkout: 'placed' as const, order_id: 8 }));
      const d = deps(async () => new Response('<html>Gateway Timeout</html>', { status }), poll);
      expect(await submitCheckout({}, 'd'.repeat(32), d), String(status)).toEqual({ kind: 'go', url: '/gera-upp/order-received/8/', resetCart: true });
    }
    const refused = deps(async () => json(500, { code: 'woocommerce_rest_unknown_server_error', message: 'Villa' }));
    expect(await submitCheckout({}, 'd'.repeat(32), refused)).toEqual({ kind: 'error', message: 'Villa' });
    expect(refused.poll).not.toHaveBeenCalled();
  });

  it('LM-01: an order recovered by the server goes straight to the receipt', async () => {
    const d = deps(async () => json(200, { checkout: 'placed', order_id: 31 }));
    expect(await submitCheckout({}, 'd'.repeat(32), d)).toEqual({ kind: 'go', url: '/gera-upp/order-received/31/', resetCart: true });
    expect(d.poll).not.toHaveBeenCalled();
  });

  it('LM-01: a card order whose payment page never opened -> say so; Panta again reuses the order', async () => {
    const d = deps(async () => json(409, { checkout: 'awaiting-payment', order_id: 31 }));
    expect(await submitCheckout({}, 'd'.repeat(32), d)).toEqual({ kind: 'error', message: AWAITING_PAYMENT_MESSAGE });
    const polled = deps(async () => { throw new TypeError('x'); }, vi.fn(async () => ({ checkout: 'awaiting-payment' as const, order_id: 31 })));
    expect(await submitCheckout({}, 'd'.repeat(32), polled)).toEqual({ kind: 'error', message: AWAITING_PAYMENT_MESSAGE });
  });

  it('the unconfirmed message says the order may have gone through and to check email first (not a blind retry)', () => {
    expect(UNCONFIRMED_MESSAGE).toMatch(/tölvupóst/);
    expect(UNCONFIRMED_MESSAGE).not.toMatch(/reyndu aftur/i);
  });
});
