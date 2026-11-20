import { describe, expect, it } from 'vitest';
import { isRowSpare, pickedIds, relatedOrder, relatedVisible } from './relatedPicks';
import type { CachedWooProduct, WooProduct } from './types';

const p = (id: number, stock: string = 'instock') => ({ id, stock_status: stock }) as WooProduct;

describe('pickedIds', () => {
  it('lists upsells, then cross-sells, in the order the shop set them', () => {
    expect(pickedIds({ id: 1, upsell_ids: [7, 3], cross_sell_ids: [9] })).toEqual([7, 3, 9]);
  });

  it('keeps each product once and never the product itself', () => {
    expect(pickedIds({ id: 1, upsell_ids: [7, 1, 7], cross_sell_ids: [7, 9, 1] })).toEqual([7, 9]);
  });

  it('drops anything that is not a positive whole number', () => {
    expect(pickedIds({ id: 1, upsell_ids: [0, -2, 1.5, Number.NaN, 4] as number[], cross_sell_ids: ['5' as unknown as number] })).toEqual([4]);
  });

  it('is empty for a product with no linked products, or none loaded', () => {
    expect(pickedIds({ id: 1 })).toEqual([]);
    expect(pickedIds({ id: 1, upsell_ids: [], cross_sell_ids: [] })).toEqual([]);
    expect(pickedIds(null)).toEqual([]);
  });
});

describe('relatedOrder', () => {
  const ids = (products: CachedWooProduct[]) => products.map((x) => x.id);

  it('puts the hand-picked first, then the category best sellers, then the top-up', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7), p(3)], scoped: [p(20), p(21)], topUp: [p(30)], limit: 12 }))).toEqual([7, 3, 20, 21, 30]);
  });

  it('shows each product once, at its first place', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7)], scoped: [p(20), p(7)], topUp: [p(20), p(30)], limit: 12 }))).toEqual([7, 20, 30]);
  });

  it('never shows the product itself', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(1), p(7)], scoped: [p(1)], topUp: [p(1)], limit: 12 }))).toEqual([7]);
  });

  // Changed on purpose (stock rule): the candidates no longer depend on stock, so a sold-out hand-picked product stays
  // in the row's candidates in its place, and the browser hides it (relatedVisible) once the live answer says so.
  it('keeps a sold-out hand-picked product among the candidates, in the shop order', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7, 'outofstock'), p(3), p(4, 'onbackorder')], scoped: [p(20)], topUp: [], limit: 12 }))).toEqual([7, 3, 4, 20]);
  });

  it('lists a product once, at its first place, even when the best sellers or the top-up list it too', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7, 'outofstock'), p(3)], scoped: [p(7), p(20)], topUp: [p(7, 'outofstock'), p(30)], limit: 12 }))).toEqual([7, 3, 20, 30]);
  });

  it('stops at the limit, hand-picked kept ahead of the rest', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7), p(3)], scoped: [p(20), p(21), p(22)], topUp: [p(30)], limit: 3 }))).toEqual([7, 3, 20]);
    expect(ids(relatedOrder({ productId: 1, picked: [p(7), p(3), p(4)], scoped: [p(20)], topUp: [], limit: 2 }))).toEqual([7, 3]);
  });

  it('is the row as before when nothing is hand-picked', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [], scoped: [p(20), p(21)], topUp: [p(30)], limit: 12 }))).toEqual([20, 21, 30]);
  });
});

describe('relatedVisible', () => {
  const none = new Set<number>();

  it('shows the first `limit` candidates before any live answer (nothing is known sold out)', () => {
    expect(relatedVisible([1, 2, 3, 4, 5], none, 3)).toEqual([1, 2, 3]);
  });

  it('hides a sold-out candidate and reveals the next spare one, so the row still shows `limit`', () => {
    expect(relatedVisible([1, 2, 3, 4, 5], new Set([2]), 3)).toEqual([1, 3, 4]);
  });

  it('brings a restocked product back when the answer no longer names it sold out', () => {
    expect(relatedVisible([1, 2, 3, 4], new Set([2]), 2)).toEqual([1, 3]);
    expect(relatedVisible([1, 2, 3, 4], none, 2)).toEqual([1, 2]);
  });

  it('shows fewer than `limit` when there are fewer available candidates, and none when all are sold out', () => {
    expect(relatedVisible([1, 2, 3], new Set([1]), 5)).toEqual([2, 3]);
    expect(relatedVisible([1, 2], new Set([1, 2]), 12)).toEqual([]);
    expect(relatedVisible([], none, 12)).toEqual([]);
  });

  it('keeps the row order of the candidates', () => {
    expect(relatedVisible([9, 4, 7], new Set([4]), 12)).toEqual([9, 7]);
  });
});

describe('isRowSpare', () => {
  // The row renders every candidate, but only the first `shown` are visible before the live answer: the rest are spares
  // the browser reveals when a shown product turns out sold out. Without JavaScript the spares stay hidden for good.
  it('marks the candidates from index `shown` on as spares', () => {
    expect([0, 1, 2, 3].map((i) => isRowSpare(i, 2))).toEqual([false, false, true, true]);
  });

  it('marks nothing as a spare when the row does not say how many it shows', () => {
    expect([0, 5, 23].map((i) => isRowSpare(i, undefined))).toEqual([false, false, false]);
  });
});
