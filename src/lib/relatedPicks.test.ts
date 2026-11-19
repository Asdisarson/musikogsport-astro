import { describe, expect, it } from 'vitest';
import { pickedIds, relatedOrder } from './relatedPicks';
import type { WooProduct } from './types';

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
  const ids = (products: WooProduct[]) => products.map((x) => x.id);

  it('puts the hand-picked first, then the category best sellers, then the top-up', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7), p(3)], scoped: [p(20), p(21)], topUp: [p(30)], limit: 12 }))).toEqual([7, 3, 20, 21, 30]);
  });

  it('shows each product once, at its first place', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7)], scoped: [p(20), p(7)], topUp: [p(20), p(30)], limit: 12 }))).toEqual([7, 20, 30]);
  });

  it('never shows the product itself', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(1), p(7)], scoped: [p(1)], topUp: [p(1)], limit: 12 }))).toEqual([7]);
  });

  it('leaves out a hand-picked product that is sold out', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7, 'outofstock'), p(3), p(4, 'onbackorder')], scoped: [p(20)], topUp: [], limit: 12 }))).toEqual([3, 4, 20]);
  });

  it('keeps a sold-out hand-picked product out even when the best sellers or the top-up list it too', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7, 'outofstock'), p(3)], scoped: [p(7), p(20)], topUp: [p(7, 'outofstock'), p(30)], limit: 12 }))).toEqual([3, 20, 30]);
  });

  it('stops at the limit, hand-picked kept ahead of the rest', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [p(7), p(3)], scoped: [p(20), p(21), p(22)], topUp: [p(30)], limit: 3 }))).toEqual([7, 3, 20]);
    expect(ids(relatedOrder({ productId: 1, picked: [p(7), p(3), p(4)], scoped: [p(20)], topUp: [], limit: 2 }))).toEqual([7, 3]);
  });

  it('is the row as before when nothing is hand-picked', () => {
    expect(ids(relatedOrder({ productId: 1, picked: [], scoped: [p(20), p(21)], topUp: [p(30)], limit: 12 }))).toEqual([20, 21, 30]);
  });
});
