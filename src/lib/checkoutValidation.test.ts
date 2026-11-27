// checkoutValidation.ts: what the checkout form still lacks, keyed by where the message is shown. The form asks
// again on every render once an order attempt has failed, so a message goes away the moment its field is fixed.
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
  nationalId: '',
  needsShipping: true,
  rateChosen: true,
  needsPostbox: false,
  postboxChosen: false,
  needsPayment: true,
  paymentChosen: true,
  terms: true,
};
const problems = (s: CheckoutFormState) => Object.fromEntries(validateCheckout(s));

describe('validateCheckout', () => {
  it('a complete form has nothing to report', () => {
    expect(validateCheckout(complete).size).toBe(0);
  });

  it('each empty required billing field gets its own message under its own id; optional fields are left alone', () => {
    expect(problems({ ...complete, billing: { first_name: ' ', company: '', email: '' } })).toEqual({
      billing_first_name: 'Eiginnafn er nauðsynlegur reitur.',
      billing_email: 'Netfang er nauðsynlegur reitur.',
    });
  });

  it('a field that has been filled in is no longer reported, while the others still are', () => {
    expect(problems({ ...complete, billing: { first_name: 'Anna', company: '', email: '' } })).toEqual({
      billing_email: 'Netfang er nauðsynlegur reitur.',
    });
  });

  it('checks the shipping address only when the order goes to another address', () => {
    expect(validateCheckout({ ...complete, shipping: null }).size).toBe(0);
    expect(problems({ ...complete, shipping: { first_name: '', company: '', email: 'x@y.is' } })).toEqual({
      shipping_first_name: 'Eiginnafn er nauðsynlegur reitur.',
    });
  });

  it('a malformed e-mail address and a kennitala that is not ten digits are reported at their fields', () => {
    expect(problems({ ...complete, billing: { ...filled, email: 'anna@b' }, nationalId: '010190-123' })).toEqual({
      billing_email: 'Ógilt netfang.',
      billing_national_id: 'Kennitala á að vera 10 tölustafir.',
    });
    expect(validateCheckout({ ...complete, nationalId: '010190-1239' }).size).toBe(0);
  });

  it('asks for a shipping method, a postbox, a payment method and the terms, each only when it applies', () => {
    expect(problems({ ...complete, rateChosen: false, needsPostbox: true, paymentChosen: false, terms: false })).toEqual({
      shipping_method: 'Veldu sendingarmáta.',
      postbox: 'Veldu póstbox fyrir sendinguna.',
      payment_method: 'Veldu greiðslumáta.',
      terms: 'Samþykktu skilmálana til að halda áfram með pöntunina.',
    });
    expect(validateCheckout({ ...complete, needsShipping: false, rateChosen: false, needsPayment: false, paymentChosen: false }).size).toBe(0);
    expect(validateCheckout({ ...complete, needsPostbox: true, postboxChosen: true }).size).toBe(0);
  });

  it('lists the problems in the order the form shows them (the first one is scrolled to)', () => {
    const order = [...validateCheckout({ ...complete, billing: { first_name: '', company: '', email: '' }, terms: false, rateChosen: false }).keys()];
    expect(order).toEqual(['billing_first_name', 'billing_email', 'shipping_method', 'terms']);
  });
});
