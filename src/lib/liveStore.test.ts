import { describe, expect, it } from 'vitest';
import { productMax, productSoldOne, productStock, snapshotFor, withLive } from './liveStore';

const answer = {
  product: { id: 5, type: 'variable', priceHtml: '<span>1</span>', percent: null, stock: 'instock' as const, max: 7, stockMax: 7, soldOne: false },
  variations: [
    { id: 11, price: '4500', regular_price: '9990', sale_price: '4500', on_sale: true, stock: 'onbackorder' as const, max: null, stockMax: null, sharedStock: false, soldOne: false },
    { id: 12, price: '9990', regular_price: '9990', sale_price: '', on_sale: false, stock: null, max: 3, stockMax: 3, sharedStock: false, soldOne: false },
  ],
};

describe('snapshotFor', () => {
  it('maps a good answer to ready with variations keyed by id', () => {
    const s = snapshotFor(5, answer);
    expect(s.state).toBe('ready');
    expect(s.variations?.[11].stock).toBe('onbackorder');
  });

  it('maps a missing or malformed answer to failed, never to a guessed stock', () => {
    expect(snapshotFor(5, null)).toEqual({ state: 'failed', productId: 5 });
    expect(snapshotFor(5, { product: answer.product } as unknown as typeof answer)).toEqual({ state: 'failed', productId: 5 });
  });
});

describe('withLive', () => {
  const baked = { id: 11, price: '9990', regular_price: '9990', sale_price: '', on_sale: false, stock_status: 'instock', max: null as number | null | undefined };

  it('lays the live price and stock over the baked variation', () => {
    const s = snapshotFor(5, answer);
    expect(withLive(baked, s.variations)).toMatchObject({ price: '4500', sale_price: '4500', on_sale: true, stock_status: 'onbackorder' });
  });

  it('lays the live cap over the baked variation, and drops it while pending', () => {
    const s = snapshotFor(5, answer);
    expect(withLive({ ...baked, id: 12 }, s.variations).max).toBe(3);
    expect(withLive(baked, undefined).max).toBeUndefined();
  });

  it('drops baked stock while pending: unknown, not instock', () => {
    expect(withLive(baked, undefined).stock_status).toBeUndefined();
  });

  it('keeps a null live stock as unknown rather than sold out', () => {
    const s = snapshotFor(5, answer);
    expect(withLive({ ...baked, id: 12 }, s.variations).stock_status).toBeUndefined();
  });
});

describe('productStock', () => {
  it('is undefined while pending or failed, and the live value once ready', () => {
    expect(productStock({ state: 'pending', productId: 5 })).toBeUndefined();
    expect(productStock(snapshotFor(5, null))).toBeUndefined();
    expect(productStock(snapshotFor(5, answer))).toBe('instock');
  });
});

describe('productMax', () => {
  it('is the live cap once ready, null for no cap, undefined while pending or failed', () => {
    expect(productMax(snapshotFor(5, answer))).toBe(7);
    expect(productMax(snapshotFor(5, { ...answer, product: { ...answer.product, max: undefined } } as unknown as typeof answer))).toBeNull();
    expect(productMax({ state: 'pending', productId: 5 })).toBeUndefined();
    expect(productMax(snapshotFor(5, null))).toBeUndefined();
  });
});

describe('sold individually through the live snapshot', () => {
  it('withLive carries the flag over a variation, and drops it while pending', () => {
    const s = snapshotFor(5, { ...answer, variations: [{ ...answer.variations[1], soldOne: true }] } as unknown as typeof answer);
    const bare: { id: number; price: string; regular_price: string; sale_price: string; on_sale: boolean; soldOne?: boolean } = { id: 12, price: '1', regular_price: '1', sale_price: '', on_sale: false };
    expect(withLive(bare, s.variations).soldOne).toBe(true);
    expect(withLive(bare, undefined).soldOne).toBeUndefined();
  });
  it('productSoldOne reads the product flag once ready', () => {
    const s = snapshotFor(5, { ...answer, product: { ...answer.product, soldOne: true } } as unknown as typeof answer);
    expect(productSoldOne(s)).toBe(true);
    expect(productSoldOne({ state: 'pending', productId: 5 })).toBeUndefined();
  });
});
