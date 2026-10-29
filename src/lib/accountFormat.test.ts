import { describe, expect, it } from 'vitest';
import { addressFromForm, addressLines } from './accountFormat';

describe('addressFromForm', () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it('keeps only known address fields, trimmed, and pins the country to Iceland', () => {
    expect(addressFromForm(form({ first_name: ' Jón ', city: 'Reykjavík', role: 'administrator', country: 'US' }), 'billing')).toEqual({
      first_name: 'Jón',
      city: 'Reykjavík',
      country: 'IS',
    });
  });

  it('drops email from a shipping address (WooCommerce shipping has none)', () => {
    expect(addressFromForm(form({ email: 'a@b.is', postcode: '220' }), 'shipping')).toEqual({ postcode: '220', country: 'IS' });
  });

  it('sends a field submitted empty as "" so clearing it in the form clears it in WooCommerce', () => {
    expect(addressFromForm(form({ company: '   ', city: 'Reykjavík' }), 'billing')).toEqual({ company: '', city: 'Reykjavík', country: 'IS' });
  });

  it('caps very long values', () => {
    expect(addressFromForm(form({ address_1: 'x'.repeat(500) }), 'billing').address_1).toHaveLength(200);
  });
});

describe('addressLines', () => {
  it('formats a WooCommerce address the Icelandic way (postcode before town)', () => {
    expect(addressLines({ first_name: 'Jón', last_name: 'Jónsson', address_1: 'Dalshraun 10', postcode: '220', city: 'Hafnarfjörður' })).toEqual([
      'Jón Jónsson',
      'Dalshraun 10',
      '220 Hafnarfjörður',
    ]);
  });

  it('is empty for an empty address', () => {
    expect(addressLines({})).toEqual([]);
  });
});
