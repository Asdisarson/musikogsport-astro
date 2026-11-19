import { describe, expect, it } from 'vitest';
import { productStock, snapshotFor, withLive } from './liveStore';

const answer = {
  product: { id: 5, type: 'variable', priceHtml: '<span>1</span>', percent: null, stock: 'instock' as const },
  variations: [
    { id: 11, price: '4500', regular_price: '9990', sale_price: '4500', on_sale: true, stock: 'onbackorder' as const },
    { id: 12, price: '9990', regular_price: '9990', sale_price: '', on_sale: false, stock: null },
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
  const baked = { id: 11, price: '9990', regular_price: '9990', sale_price: '', on_sale: false, stock_status: 'instock' };

  it('lays the live price and stock over the baked variation', () => {
    const s = snapshotFor(5, answer);
    expect(withLive(baked, s.variations)).toMatchObject({ price: '4500', sale_price: '4500', on_sale: true, stock_status: 'onbackorder' });
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
