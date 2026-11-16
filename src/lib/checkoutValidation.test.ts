// checkoutValidation.ts: what the checkout form still lacks. The form asks again on every render once an order
// attempt has failed, so a field stops being marked the moment it is filled in.
import { describe, expect, it } from 'vitest';
import { validateCheckout, type CheckoutFormState } from './checkoutValidation';

const defs = [
  { key: 'first_name', label: 'Eiginnafn', required: true },
  { key: 'company', label: 'Nafn fyrirtækis' },
  { key: 'email', label: 'Netfang', required: true },
];
const filled = { first_name: 'Anna', company: '', email: 'anna@b.is' };
const complete: CheckoutFormState = {
  billing: filled,
  billingFields: defs,
  shipping: null,
  shippingFields: defs,
  kennitala: '',
  needsShipping: true,
  rateChosen: true,
  needsPostbox: false,
  postboxChosen: false,
  needsPayment: true,
  paymentChosen: true,
  terms: true,
};

describe('validateCheckout', () => {
  it('a complete form has nothing to report', () => {
    expect(validateCheckout(complete)).toEqual({ messages: [], fields: new Set() });
  });

  it('names each empty required billing field and marks it; optional fields are left alone', () => {
    const r = validateCheckout({ ...complete, billing: { first_name: ' ', company: '', email: '' } });
    expect(r.messages).toEqual(['Greiðsluupplýsingar Eiginnafn er nauðsynlegur reitur.', 'Greiðsluupplýsingar Netfang er nauðsynlegur reitur.']);
    expect([...r.fields]).toEqual(['billing_first_name', 'billing_email']);
  });

  it('a field that has been filled in is no longer reported, while the others still are', () => {
    const r = validateCheckout({ ...complete, billing: { first_name: 'Anna', company: '', email: '' } });
    expect(r.messages).toEqual(['Greiðsluupplýsingar Netfang er nauðsynlegur reitur.']);
    expect([...r.fields]).toEqual(['billing_email']);
  });

  it('checks the shipping address only when the order goes to another address', () => {
    const empty = { first_name: '', company: '', email: 'x@y.is' };
    expect(validateCheckout({ ...complete, shipping: null }).messages).toEqual([]);
    const r = validateCheckout({ ...complete, shipping: empty });
    expect(r.messages).toEqual(['Sendingarupplýsingar Eiginnafn er nauðsynlegur reitur.']);
    expect([...r.fields]).toEqual(['shipping_first_name']);
  });

  it('a malformed e-mail address and a kennitala that is not ten digits are marked', () => {
    const r = validateCheckout({ ...complete, billing: { ...filled, email: 'anna@b' }, kennitala: '010190-123' });
    expect(r.messages).toEqual(['Ógilt netfang.', 'Kennitala á að vera 10 tölustafir.']);
    expect([...r.fields]).toEqual(['billing_email', 'billing_kennitala']);
    expect(validateCheckout({ ...complete, kennitala: '010190-1239' }).messages).toEqual([]);
  });

  it('asks for a shipping method, a postbox, a payment method and the terms, each only when it applies', () => {
    expect(validateCheckout({ ...complete, rateChosen: false, needsPostbox: true, paymentChosen: false, terms: false }).messages).toEqual([
      'Veldu sendingarmáta.',
      'Veldu póstbox fyrir sendinguna.',
      'Veldu greiðslumáta.',
      'Vinsamlegast lestu og samþykktu skilmálana til að halda áfram með pöntunina.',
    ]);
    expect(validateCheckout({ ...complete, needsShipping: false, rateChosen: false, needsPayment: false, paymentChosen: false }).messages).toEqual([]);
    expect(validateCheckout({ ...complete, needsPostbox: true, postboxChosen: true }).messages).toEqual([]);
  });
});
