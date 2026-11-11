import { describe, expect, it } from 'vitest';
import { cartSubtotal, variationText } from './cartView';
import type { Cart } from './types';

describe('variationText', () => {
  it('names any size attribute "Stærð", like the product page’s "Veldu stærð"', () => {
    expect(variationText([{ attribute: 'Stærðir', value: '42.5' }])).toBe('Stærð: 42.5');
    expect(variationText([{ attribute: 'Skóstærð', value: '40' }])).toBe('Stærð: 40');
  });
  it('keeps other attributes as named, joined with commas', () => {
    expect(variationText([{ attribute: 'Litur', value: 'Rauður' }, { attribute: 'Stærðir', value: 'M' }])).toBe('Litur: Rauður, Stærð: M');
  });
  it('is empty without a variation', () => {
    expect(variationText([])).toBe('');
  });
});

describe('cartSubtotal', () => {
  const cart = { totals: { total_items: '19000', total_items_tax: '4560', currency_minor_unit: 0 } } as Cart;

  it('is the items with tax, as the cart shows it', () => {
    expect(cartSubtotal(cart)).toBe(23560);
  });
  it('leaves the tax out when asked (the free-shipping bar with "subtotal incl. taxes" off in WordPress)', () => {
    expect(cartSubtotal(cart, false)).toBe(19000);
  });
  it('is 0 without a cart', () => {
    expect(cartSubtotal(null, false)).toBe(0);
  });
});
