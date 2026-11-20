// cartQty.ts: the cart line maximum and what the product page may still add. Pure, no browser.
import { describe, expect, it } from 'vitest';
import { cappedIds, clampLineQty, inCartAmong, inCartQty, lineMax, remainingFor, stillAddable } from './cartQty';
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

// A variation managed by its parent draws on the parent's stock with every variation managed that way: WooCommerce sums
// their lines by the managed id, so all of them count against that one cap. Sold individually is per cart line.
describe('stock shared through the parent', () => {
  it('counts the lines of every id that draws on the same stock', () => {
    const items = [line({ id: 11, quantity: 2 }), line({ id: 12, quantity: 1 }), line({ id: 13, quantity: 4 })];
    expect(inCartAmong(items, [11, 12])).toBe(3);
    expect(inCartAmong(items, [])).toBe(0);
  });

  it('a variation managed by its parent counts the shared ids; any other selection counts its own id only', () => {
    expect(cappedIds(12, [11, 12])).toEqual([11, 12]);
    expect(cappedIds(13, [11, 12])).toEqual([13]);
    expect(cappedIds(7, [])).toEqual([7]);
  });

  it('what is left under a stock cap is the cap less the shared lines (parent stock 3, S holds 3: M may add none)', () => {
    expect(remainingFor(3, 3, false, 0)).toBe(0);
    expect(remainingFor(3, 2, false, 0)).toBe(1);
    expect(remainingFor(null, 9, false, 0)).toBeNull();
  });

  it('sold individually is one per own line, whatever the shared stock says (parent 5, S holds 1: M may still add 1)', () => {
    expect(remainingFor(5, 1, true, 0)).toBe(1);
    expect(remainingFor(5, 1, true, 1)).toBe(0);
    expect(remainingFor(null, 0, true, 0)).toBe(1);
    expect(remainingFor(0, 0, true, 0)).toBe(0);
  });
});

