// Pure rules for filling product cards from /api/live. Written before lib/liveCards.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));

import { cardFill, LIVE_RETRY_MS, parseLiveAnswer, pendingIds, shouldRetry, takesAnswer } from './liveCards';
import type { LiveProduct } from './livePrices';

const live = (over: Partial<LiveProduct> = {}): LiveProduct => ({
  id: 1,
  type: 'simple',
  max: null,
  priceHtml: '<span class="amount">1.000 kr.</span>',
  percent: null,
  stock: 'instock',
  soldOne: false,
  ...over,
});
const BAKED = '<span class="amount">1.000 kr.</span>';

describe('pendingIds', () => {
  it('keeps order, drops repeats and ids already filled', () => {
    expect(pendingIds([3, 1, 3, 2], new Set([1]))).toEqual([3, 2]);
  });
});

describe('parseLiveAnswer', () => {
  it('maps a valid answer by id', () => {
    const m = parseLiveAnswer({
      products: [{ id: 7, type: 'simple', priceHtml: '<span>x</span>', percent: 20, stock: 'onbackorder', max: 2 }],
    });
    expect(m.get(7)).toEqual({ id: 7, type: 'simple', priceHtml: '<span>x</span>', percent: 20, stock: 'onbackorder', max: 2, soldOne: false });
  });
  it('skips malformed rows and returns an empty map for anything else', () => {
    expect(parseLiveAnswer(null).size).toBe(0);
    expect(parseLiveAnswer({ products: 'nope' }).size).toBe(0);
    const m = parseLiveAnswer({ products: [{ id: 'x' }, { id: 2, type: 'simple', priceHtml: '', percent: null, stock: 'instock' }] });
    expect([...m.keys()]).toEqual([2]);
  });
  it('turns an unknown stock word into null, not a guess', () => {
    const m = parseLiveAnswer({ products: [{ id: 2, type: 'simple', priceHtml: '', percent: null, stock: 'weird' }] });
    expect(m.get(2)?.stock).toBeNull();
  });
});

describe('cardFill', () => {
  it('stays neutral (null) when the product is missing from the answer', () => {
    expect(cardFill('simple', BAKED, undefined)).toBeNull();
  });
  it('labels a sold-out card Uppselt and offers no cart button', () => {
    const f = cardFill('simple', BAKED, live({ stock: 'outofstock' }));
    expect(f).toMatchObject({ label: 'Uppselt', outOfStock: true, action: { kind: 'link', text: 'Frekari upplýsingar' } });
  });
  it('leaves the label line empty for an in-stock plain product (no Á lager label on cards) and gives it the cart action', () => {
    expect(cardFill('simple', BAKED, live())).toMatchObject({ label: '', outOfStock: false, action: { kind: 'cart' } });
  });
  it('hides the -N% badge on a sold-out product, even one that is discounted', () => {
    expect(cardFill('simple', BAKED, live({ stock: 'outofstock', percent: 20 }))).toMatchObject({ label: 'Uppselt', percent: null });
  });
  it('clears the label back to empty when a sale ends on an in-stock product', () => {
    expect(cardFill('simple', BAKED, live({ percent: null }))?.label).toBe('');
  });
  it('shows Útsala for a discounted in-stock product', () => {
    expect(cardFill('simple', BAKED, live({ percent: 20 }))).toMatchObject({ label: 'Útsala', percent: 20 });
  });
  it('treats backorder as buyable', () => {
    expect(cardFill('simple', BAKED, live({ stock: 'onbackorder' }))?.action.kind).toBe('cart');
  });
  it('keeps variable products on the link, whatever the parent stock', () => {
    expect(cardFill('variable', BAKED, live({ type: 'variable' }))?.action).toEqual({ kind: 'link', text: 'Veldu kosti' });
  });
  it('leaves the label alone when stock is unknown, but still corrects the price', () => {
    const f = cardFill('simple', BAKED, live({ stock: null, priceHtml: '<span>2.000 kr.</span>' }));
    expect(f?.label).toBeNull();
    expect(f?.outOfStock).toBe(false);
    expect(f?.priceHtml).toBe('<span>2.000 kr.</span>');
  });
  it('returns the baked price when the live price is the same', () => {
    expect(cardFill('simple', BAKED, live())?.priceHtml).toBe(BAKED);
  });
  it('returns the live price when it differs from the baked one', () => {
    expect(cardFill('simple', BAKED, live({ priceHtml: '<span>900 kr.</span>' }))?.priceHtml).toBe('<span>900 kr.</span>');
  });
});

// A failed call is retried once after a short delay (then on the next pageshow or tab return); an answer for a card is
// applied only if no newer call has already applied one (an older response must not overwrite a newer one).
describe('card refresh rules', () => {
  it('retries a failed refresh once, after a few seconds', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(1)).toBe(false);
    expect(LIVE_RETRY_MS).toBeGreaterThanOrEqual(2000);
    expect(LIVE_RETRY_MS).toBeLessThanOrEqual(5000);
  });

  it('applies the first answer, and a newer call’s answer; never an older one after a newer one', () => {
    expect(takesAnswer(undefined, 1)).toBe(true);
    expect(takesAnswer(1, 2)).toBe(true);
    expect(takesAnswer(2, 2)).toBe(true);
    expect(takesAnswer(3, 2)).toBe(false); // a slow older response arrives after the newer one was applied
  });
});
