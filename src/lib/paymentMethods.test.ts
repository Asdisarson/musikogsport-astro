// How the checkout presents the gateways the Store API offers: either card gateway (Straumur, or live's Valitor)
// reads "Greiðslukort" with the card logos, comes first and is the one chosen for the shopper.
import { describe, expect, it } from 'vitest';
import { defaultPaymentMethod, isCardGateway, orderPaymentMethods, paymentMeta } from './paymentMethods';

describe('paymentMeta', () => {
  it('presents both card gateways the same way', () => {
    const card = { label: 'Greiðslukort', desc: 'Gera upp með kreditkorti', cards: true };
    expect(paymentMeta('straumur')).toEqual(card);
    expect(paymentMeta('valitor')).toEqual(card);
  });

  it('keeps the bank transfer copy and falls back to the id for a gateway it does not know', () => {
    expect(paymentMeta('bacs').label).toBe('Bankamillifærsla');
    expect(paymentMeta('cod')).toEqual({ label: 'cod', desc: '' });
  });
});

describe('orderPaymentMethods', () => {
  it('lists card gateways first, then the bank transfer, then anything else as offered', () => {
    expect(orderPaymentMethods(['cod', 'bacs', 'valitor'])).toEqual(['valitor', 'bacs', 'cod']);
    expect(orderPaymentMethods(['bacs', 'straumur'])).toEqual(['straumur', 'bacs']);
    expect(orderPaymentMethods(['valitor'])).toEqual(['valitor']);
    expect(orderPaymentMethods([])).toEqual([]);
  });
});

describe('defaultPaymentMethod', () => {
  it('chooses the card gateway when one is offered', () => {
    expect(defaultPaymentMethod(['bacs', 'valitor'])).toBe('valitor');
    expect(defaultPaymentMethod(['bacs', 'straumur'])).toBe('straumur');
    expect(defaultPaymentMethod(['valitor'])).toBe('valitor');
  });

  it('prefers Straumur, the gateway the hand-off is built for, if both card gateways are ever offered', () => {
    expect(orderPaymentMethods(['valitor', 'straumur'])).toEqual(['straumur', 'valitor']);
    expect(defaultPaymentMethod(['valitor', 'straumur'])).toBe('straumur');
  });

  it('otherwise chooses the first one, and nothing when none is offered', () => {
    expect(defaultPaymentMethod(['bacs', 'cod'])).toBe('bacs');
    expect(defaultPaymentMethod([])).toBe('');
  });
});

describe('isCardGateway', () => {
  it('knows the card gateways: their payment is confirmed after the shopper returns', () => {
    expect(isCardGateway('valitor')).toBe(true);
    expect(isCardGateway('straumur')).toBe(true);
    expect(isCardGateway('bacs')).toBe(false);
    expect(isCardGateway('')).toBe(false);
  });
});
