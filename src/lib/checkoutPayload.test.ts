// LM-03: /api/checkout forwards only the fields the storefront's checkout form sends; everything else is dropped
// before WooCommerce sees it (create_account, customer_password, expected_total, other plugins' extensions, ...).
import { describe, expect, it } from 'vitest';
import { CHECKOUT_NOTE_MAX, checkoutPayload, wantsAccount } from './checkoutPayload';
import { checkoutBody } from './checkoutFlow';

const address = {
  first_name: 'Jón', last_name: 'Jónsson', company: '', address_1: 'Laugavegur 1', address_2: '', city: 'Reykjavík',
  state: '', postcode: '101', country: 'IS', phone: '6123456',
};
const form = {
  billing_address: { ...address, email: 'jon@example.is' },
  shipping_address: address,
  customer_note: 'Takk',
  payment_method: 'bacs',
  payment_data: [],
  extensions: { mos: { kennitala: '0102032390', skiptimidi: true, attempt: 'a'.repeat(32) } },
  postis_dpo_postbox: 'DPO9552',
  postis_dpo_phonenumber: '6123456',
};

describe('checkoutPayload (LM-03)', () => {
  it('passes exactly what the checkout form sends', () => {
    expect(checkoutPayload(form)).toEqual(form);
  });

  it('round-trips the real form body (checkoutFlow.checkoutBody) unchanged', () => {
    const f = { first_name: 'A', last_name: 'B', company: 'C', address_1: 'D 1', address_2: '', postcode: '101', city: 'R', phone: '6123456', email: 'a@b.is' };
    const body = checkoutBody({
      billing: f, ship: f, notes: 'n', paymentMethod: 'straumur', needsPayment: true, kennitala: '', skiptimidi: false,
      postbox: 'DPO1', attempt: 'b'.repeat(32),
    });
    expect(checkoutPayload(JSON.parse(JSON.stringify(body)))).toEqual(JSON.parse(JSON.stringify(body)));
  });

  it('drops every other top-level key', () => {
    const p = checkoutPayload({
      ...form, create_account: true, customer_password: 'x', expected_total: '1', additional_fields: { a: 1 },
      order_notes: 'x', billing: {}, __proto__x: 1,
    });
    expect(Object.keys(p!).sort()).toEqual(Object.keys(form).sort());
  });

  it('keeps only the address fields, as strings, capped', () => {
    const p = checkoutPayload({
      ...form,
      billing_address: { ...form.billing_address, role: 'admin', first_name: 'x'.repeat(500), postcode: 101 },
      shipping_address: { ...address, email: 'not-on-shipping@x.is', meta: [1] },
    })!;
    expect(p.billing_address).not.toHaveProperty('role');
    expect(p.billing_address.first_name).toHaveLength(200);
    expect(p.billing_address.postcode).toBe(''); // not a string: dropped to empty, WooCommerce then refuses it
    expect(p.shipping_address).toEqual(address);
  });

  it('keeps only the mos extension, with exact types; a malformed attempt id is dropped', () => {
    const p = checkoutPayload({
      ...form,
      extensions: { mos: { kennitala: 123, skiptimidi: 'yes', attempt: 'ZZ', other: 1 }, 'woocommerce/x': { a: 1 } },
    })!;
    expect(p.extensions).toEqual({ mos: { kennitala: null, skiptimidi: false } });
    const q = checkoutPayload({ ...form, extensions: undefined })!;
    expect(q.extensions).toEqual({ mos: { kennitala: null, skiptimidi: false } });
  });

  it('caps the customer note at CHECKOUT_NOTE_MAX characters', () => {
    expect(checkoutPayload({ ...form, customer_note: 'n'.repeat(5000) })!.customer_note).toHaveLength(CHECKOUT_NOTE_MAX);
    expect(CHECKOUT_NOTE_MAX).toBe(1000);
  });

  it('sends payment_data as an empty list whatever arrives (the form sends none)', () => {
    expect(checkoutPayload({ ...form, payment_data: [{ key: 'x', value: 'y' }] })!.payment_data).toEqual([]);
  });

  it('keeps a locker id only in its known shape', () => {
    const p = checkoutPayload({ ...form, postis_dpo_postbox: '<script>' })!;
    expect(p).not.toHaveProperty('postis_dpo_postbox');
    const q = checkoutPayload({ ...form, postis_dpo_postbox: undefined, postis_dpo_phonenumber: undefined })!;
    expect(q).not.toHaveProperty('postis_dpo_postbox');
    expect(q).not.toHaveProperty('postis_dpo_phonenumber');
  });

  it('allows no payment method (CO-21: a free order) but never an empty or non-string one', () => {
    const { payment_method: _drop, ...free } = form;
    expect(checkoutPayload(free)).not.toHaveProperty('payment_method');
    expect(checkoutPayload({ ...form, payment_method: '  ' })).not.toHaveProperty('payment_method');
    expect(checkoutPayload({ ...form, payment_method: 7 })).not.toHaveProperty('payment_method');
  });

  it('refuses a body without a billing address and e-mail', () => {
    expect(checkoutPayload(null)).toBeNull();
    expect(checkoutPayload([])).toBeNull();
    expect(checkoutPayload({ ...form, billing_address: undefined })).toBeNull();
    expect(checkoutPayload({ ...form, billing_address: { ...address, email: ' ' } })).toBeNull();
  });
});

describe('wantsAccount', () => {
  it('is true only for the exact flag the checkout form sends', () => {
    expect(wantsAccount({ mos_create_account: true })).toBe(true);
    for (const raw of [{ mos_create_account: 'true' }, { mos_create_account: 1 }, { create_account: true }, {}, null, 'x', []]) {
      expect(wantsAccount(raw)).toBe(false);
    }
  });

  it('never reaches WooCommerce: the forwarded body has no account field', () => {
    const body = checkoutPayload({ billing_address: { email: 'a@b.is' }, mos_create_account: true, create_account: true });
    expect(body && Object.keys(body).some((k) => /account/.test(k))).toBe(false);
  });

  it("passes the visit's origin on to WooCommerce's order attribution, filtered, with the server's user agent", () => {
    const p = checkoutPayload(
      { ...form, extensions: { ...form.extensions, 'woocommerce/order-attribution': { source_type: 'organic', utm_source: 'google', user_agent: 'spoofed', evil: 'x' } } },
      { userAgent: 'Mozilla/5.0 (iPhone)' },
    )!;
    expect(p.extensions['woocommerce/order-attribution']).toEqual({ source_type: 'organic', utm_source: 'google', user_agent: 'Mozilla/5.0 (iPhone)' });
  });

  it('sends no order attribution without a usable origin', () => {
    expect(checkoutPayload(form, { userAgent: 'Mozilla/5.0' })!.extensions).toEqual(form.extensions);
    const p = checkoutPayload({ ...form, extensions: { ...form.extensions, 'woocommerce/order-attribution': { evil: 'x' } } }, { userAgent: 'Mozilla/5.0' })!;
    expect(p.extensions).toEqual(form.extensions);
  });
});
