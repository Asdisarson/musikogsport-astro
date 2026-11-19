// cartQty.ts: the cart line maximum and what the product page may still add. Pure, no browser.
import { describe, expect, it } from 'vitest';
import { clampLineQty, inCartQty, lineMax, purchaseNote, stillAddable } from './cartQty';
import type { CartItem } from './types';

const line = (over: Partial<CartItem>): CartItem => ({ key: 'k', id: 5, quantity: 1, variation: [], ...over } as CartItem);

describe('lineMax (the Store API quantity_limits.maximum of a cart line)', () => {
  it('reads the maximum', () => {
    expect(lineMax(line({ quantity_limits: { minimum: 1, maximum: 10, multiple_of: 1, editable: true } }))).toBe(10);
  });
  it('null when the limits are absent: the counter behaves as before', () => {
    expect(lineMax(line({}))).toBeNull();
  });
  it('never negative, a fraction floored', () => {
    expect(lineMax(line({ quantity_limits: { minimum: 1, maximum: -3, multiple_of: 1, editable: true } }))).toBe(0);
    expect(lineMax(line({ quantity_limits: { minimum: 1, maximum: 4.7, multiple_of: 1, editable: true } }))).toBe(4);
  });
});

describe('clampLineQty', () => {
  it('leaves the value with no maximum, holds it at the maximum, never below 1', () => {
    expect(clampLineQty(50, null)).toBe(50);
    expect(clampLineQty(50, 10)).toBe(10);
    expect(clampLineQty(7, 10)).toBe(7);
    expect(clampLineQty(3, 0)).toBe(1);
  });
});

describe('inCartQty (how much of this product or variation the cart already holds)', () => {
  // the Store API's line id: the variation's id for a variation, the product's id for a simple product
  const items = [
    line({ key: 'a', id: 264826, quantity: 3 }),
    line({ key: 'b', id: 264827, quantity: 2 }),
    line({ key: 'c', id: 9, quantity: 4 }),
  ];
  it('counts only the variation asked for', () => {
    expect(inCartQty(items, 264826)).toBe(3);
    expect(inCartQty(items, 264827)).toBe(2);
  });
  it('a simple product by its own id', () => {
    expect(inCartQty(items, 9)).toBe(4);
  });
  it('zero for a product or variation not in the cart', () => {
    expect(inCartQty(items, 264824)).toBe(0);
    expect(inCartQty([], 9)).toBe(0);
  });
});

describe('stillAddable (the live cap less the cart)', () => {
  it('the cap less what the cart holds', () => {
    expect(stillAddable(10, 3)).toBe(7);
    expect(stillAddable(10, 0)).toBe(10);
  });
  it('0 when the cart holds all of it, never below 0', () => {
    expect(stillAddable(10, 10)).toBe(0);
    expect(stillAddable(10, 12)).toBe(0);
  });
  it('no cap stays no cap', () => {
    expect(stillAddable(null, 5)).toBeNull();
  });
});

describe('purchaseNote (the quiet line under the product counter)', () => {
  const base = { cap: 10, inCart: 0, remaining: 10, soldOne: false, atMax: false };
  it('no note with no cap, or a cap of 0 and nothing in the cart', () => {
    expect(purchaseNote({ ...base, cap: null, remaining: null }, 5)).toBeNull();
    expect(purchaseNote({ ...base, cap: 0, remaining: 0 }, 5)).toBeNull();
  });
  it('a low stock cap says how many are left', () => {
    expect(purchaseNote({ ...base, cap: 3, remaining: 3 }, 5)).toBe('Aðeins 3 til á lager');
  });
  it('at the counter maximum on stock: not more in stock', () => {
    expect(purchaseNote({ ...base, cap: 10, inCart: 2, remaining: 8, atMax: true }, 5)).toBe('Ekki fleiri til á lager');
  });
  it('nothing more addable: the count in the cart, never the live cap', () => {
    // stock fell to 3 while 5 are in the cart: the note must say 5
    expect(purchaseNote({ ...base, cap: 3, inCart: 5, remaining: 0 }, 5)).toBe('Þú ert þegar með öll 5 stk. í körfunni');
  });
  it('sold individually: no stock wording, only the cart note once it is in the cart', () => {
    expect(purchaseNote({ cap: 1, inCart: 0, remaining: 1, soldOne: true, atMax: true }, 5)).toBeNull();
    expect(purchaseNote({ cap: 1, inCart: 1, remaining: 0, soldOne: true, atMax: false }, 5)).toBe('Þú ert þegar með öll 1 stk. í körfunni');
  });
});
