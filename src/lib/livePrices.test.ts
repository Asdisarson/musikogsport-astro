// Pure rules for the live price and stock answer (/api/live). Written before lib/livePrices.ts.
import { describe, expect, it, vi } from 'vitest';
import { stockCap } from './livePrices';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));

import {
  LIVE_MAX_IDS,
  buyable,
  cardAction,
  chunkIds,
  liveProductOf,
  liveVariationOf,
  clampQty,
  parseLiveIds,
  pdpPriceFill,
  purchasableMax,
  soldIndividually,
  type LiveProduct,
  priceChanged,
  stockLabel,
} from './livePrices';
import type { WooProduct, WooVariation } from './types';

describe('parseLiveIds', () => {
  it('reads a comma list of positive ids, dropping repeats', () => {
    expect(parseLiveIds('3,1,3,2')).toEqual([3, 1, 2]);
  });
  it('refuses anything that is not a plain positive integer', () => {
    for (const bad of [null, '', ',', '0', '-4', '1.5', 'abc', '1,,2', '1, 2', '0x10', '1e3']) {
      expect(parseLiveIds(bad)).toBeNull();
    }
  });
  it('refuses more ids than the cap', () => {
    const many = Array.from({ length: LIVE_MAX_IDS + 1 }, (_, i) => i + 1).join(',');
    expect(parseLiveIds(many)).toBeNull();
    const at = Array.from({ length: LIVE_MAX_IDS }, (_, i) => i + 1).join(',');
    expect(parseLiveIds(at)).toHaveLength(LIVE_MAX_IDS);
  });
});

describe('chunkIds', () => {
  it('splits into groups no larger than the cap, keeping order', () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkIds([], 2)).toEqual([]);
  });
});

describe('stock rules (one backorder rule everywhere)', () => {
  it('a backorder product is buyable, like an in-stock one', () => {
    expect(buyable('instock')).toBe(true);
    expect(buyable('onbackorder')).toBe(true);
    expect(buyable('outofstock')).toBe(false);
    expect(buyable(null)).toBe(false);
  });
  it('labels: Á lager for buyable, Uppselt only for outofstock, nothing while unknown', () => {
    expect(stockLabel('instock')).toBe('Á lager');
    expect(stockLabel('onbackorder')).toBe('Á lager');
    expect(stockLabel('outofstock')).toBe('Uppselt');
    expect(stockLabel(null)).toBeNull();
  });
  it('card action: variable always opens the choices; simple buyable adds to cart; otherwise the product link', () => {
    expect(cardAction('variable', 'instock')).toEqual({ kind: 'link', text: 'Veldu kosti' });
    expect(cardAction('variable', null)).toEqual({ kind: 'link', text: 'Veldu kosti' });
    expect(cardAction('simple', 'instock')).toEqual({ kind: 'cart', text: 'Setja í körfu' });
    expect(cardAction('simple', 'onbackorder')).toEqual({ kind: 'cart', text: 'Setja í körfu' });
    expect(cardAction('simple', 'outofstock')).toEqual({ kind: 'link', text: 'Frekari upplýsingar' });
    // Unknown stock: the safe neutral link, never a cart button.
    expect(cardAction('simple', null)).toEqual({ kind: 'link', text: 'Frekari upplýsingar' });
  });
});

describe('priceChanged', () => {
  it('ignores whitespace differences but sees a real change', () => {
    expect(priceChanged('<span>13.990 kr.</span>', '<span>13.990 kr.</span>\n')).toBe(false);
    expect(priceChanged('<span>13.990 kr.</span>', '<span>11.990 kr.</span>')).toBe(true);
  });
});

const base = {
  id: 7,
  name: 'x',
  slug: 'x',
  type: 'simple',
  price: '1000',
  regular_price: '1000',
  sale_price: '',
  on_sale: false,
  price_html: '<span class="woocommerce-Price-amount"><bdi>1.000&nbsp;kr.</bdi></span><script>alert(1)</script>',
  stock_status: 'instock',
} as unknown as WooProduct;

describe('liveProductOf', () => {
  it('returns id, type, sanitised price html, sale percent and raw stock; no other fields', () => {
    const out = liveProductOf(base);
    // stockMax was added to the answer: the stock alone, before sold individually (see the cap tests below)
    expect(out).toEqual({ id: 7, type: 'simple', priceHtml: expect.any(String), percent: null, stock: 'instock', max: null, stockMax: null, soldOne: false });
    expect(out.priceHtml).not.toContain('<script');
    expect(out.priceHtml).toContain('1.000');
  });
  it('reports the sale percent from the del/ins amounts', () => {
    const sale = { ...base, on_sale: true, price_html: '<del><bdi>2.000&nbsp;kr.</bdi></del> <ins><bdi>1.000&nbsp;kr.</bdi></ins>' } as WooProduct;
    expect(liveProductOf(sale).percent).toBe(50);
  });
  it('passes unknown stock through as null', () => {
    expect(liveProductOf({ ...base, stock_status: undefined } as unknown as WooProduct).stock).toBeNull();
  });
});

describe('liveVariationOf', () => {
  it('keeps prices and stock of one variation', () => {
    const v = { id: 9, price: '900', regular_price: '1000', sale_price: '900', on_sale: true, stock_status: 'outofstock', attributes: [], menu_order: 0 } as unknown as WooVariation;
    // stockMax and sharedStock were added to the answer (the stock alone; whether the parent's stock is shared)
    expect(liveVariationOf(v)).toEqual({ id: 9, price: '900', regular_price: '1000', sale_price: '900', on_sale: true, stock: 'outofstock', max: null, stockMax: null, sharedStock: false, soldOne: false });
  });
  it('carries the purchasable maximum, read from the parent when the variation inherits stock management', () => {
    const v = { id: 9, price: '900', regular_price: '1000', sale_price: '', on_sale: false, stock_status: 'instock', manage_stock: 'parent' } as unknown as WooVariation;
    const parent = { ...base, type: 'variable', manage_stock: true, stock_quantity: 4, backorders: 'no' } as unknown as WooProduct;
    expect(liveVariationOf(v, parent).max).toBe(4);
    expect(liveVariationOf(v).max).toBeNull();
  });
  it('carries the cap of a managed simple product', () => {
    expect(liveProductOf({ ...base, manage_stock: true, stock_quantity: 2, backorders: 'no' } as unknown as WooProduct).max).toBe(2);
  });
});

describe('pdpPriceFill (the product page price, corrected from the live answer)', () => {
  const shown = '<span class="amount">1.000 kr.</span>';
  const liveOf = (over: Partial<LiveProduct> = {}): LiveProduct => ({ id: 1, type: 'simple', priceHtml: shown, percent: null, stock: 'instock', max: null, stockMax: null, soldOne: false, ...over });
  it('keeps the shown price and draws no badge when the live price is the same', () => {
    expect(pdpPriceFill(shown, liveOf())).toEqual({ priceHtml: null, percent: null });
  });
  it('replaces the price markup when the live price differs', () => {
    expect(pdpPriceFill(shown, liveOf({ priceHtml: '<span>900 kr.</span>' }))).toEqual({ priceHtml: '<span>900 kr.</span>', percent: null });
  });
  it('carries the live sale percent (the badge appears, changes or goes)', () => {
    expect(pdpPriceFill(shown, liveOf({ percent: 30 }))?.percent).toBe(30);
    expect(pdpPriceFill(shown, liveOf({ percent: null }))?.percent).toBeNull();
  });
  it('does nothing while the live answer is missing', () => {
    expect(pdpPriceFill(shown, undefined)).toBeNull();
  });
});

describe('purchasableMax (the most one customer may buy; null = no cap)', () => {
  it('managed with a quantity and no backorders: the quantity', () => {
    expect(purchasableMax({ manage_stock: true, stock_quantity: 5, backorders: 'no' })).toBe(5);
  });
  it('managed with a quantity but backorders allowed: no cap', () => {
    expect(purchasableMax({ manage_stock: true, stock_quantity: 5, backorders: 'notify' })).toBeNull();
    expect(purchasableMax({ manage_stock: true, stock_quantity: 5, backorders: 'yes' })).toBeNull();
    expect(purchasableMax({ manage_stock: true, stock_quantity: 5, backorders_allowed: true })).toBeNull();
  });
  it('not managed: no cap', () => {
    expect(purchasableMax({ manage_stock: false, stock_quantity: 5, backorders: 'no' })).toBeNull();
  });
  it('parent-managed variation: the parent quantity decides, and the variation own (unmanaged) fields do not', () => {
    expect(purchasableMax({ manage_stock: 'parent' }, { manage_stock: true, stock_quantity: 3, backorders: 'no' })).toBe(3);
    expect(purchasableMax({ manage_stock: 'parent' }, { manage_stock: true, stock_quantity: 3, backorders: 'yes' })).toBeNull();
    expect(purchasableMax({ manage_stock: 'parent' }, { manage_stock: false })).toBeNull();
    expect(purchasableMax({ manage_stock: 'parent' })).toBeNull();
  });
  it('sold individually: at most 1, and 0 when the managed stock is empty', () => {
    expect(purchasableMax({ sold_individually: true })).toBe(1);
    expect(purchasableMax({ sold_individually: true, manage_stock: true, stock_quantity: 5, backorders: 'no' })).toBe(1);
    expect(purchasableMax({ sold_individually: true, manage_stock: true, stock_quantity: 0, backorders: 'no' })).toBe(0);
  });
  it('quantity 0 or negative: 0; a fraction is floored', () => {
    expect(purchasableMax({ manage_stock: true, stock_quantity: 0, backorders: 'no' })).toBe(0);
    expect(purchasableMax({ manage_stock: true, stock_quantity: -3, backorders: 'no' })).toBe(0);
    expect(purchasableMax({ manage_stock: true, stock_quantity: 2.7, backorders: 'no' })).toBe(2);
  });
  it('missing fields: no cap, nothing guessed', () => {
    expect(purchasableMax({})).toBeNull();
    expect(purchasableMax({ manage_stock: true, backorders: 'no' })).toBeNull();
    expect(purchasableMax({ manage_stock: true, stock_quantity: null, backorders: 'no' })).toBeNull();
    expect(purchasableMax({ manage_stock: true, stock_quantity: 4 })).toBe(4);
  });
});

describe('purchasableMax, variable product sold individually', () => {
  it('caps every variation at 1, whatever the variation itself says', () => {
    expect(purchasableMax({ manage_stock: false }, { sold_individually: true })).toBe(1);
    expect(purchasableMax({ manage_stock: true, stock_quantity: 7, backorders: 'no' }, { sold_individually: true })).toBe(1);
    expect(purchasableMax({ manage_stock: true, stock_quantity: 7, backorders: 'no' }, { sold_individually: false })).toBe(7);
  });
});

describe('clampQty', () => {
  it('leaves the value alone with no cap, and holds it at the cap', () => {
    expect(clampQty(7, null)).toBe(7);
    expect(clampQty(7, 3)).toBe(3);
    expect(clampQty(2, 3)).toBe(2);
  });
  it('never goes below 1, even for a cap of 0 (the button is off then)', () => {
    expect(clampQty(4, 0)).toBe(1);
  });
});

describe('soldIndividually (one per cart: a limit of the product, not of its stock)', () => {
  it('true when the variation or the parent is sold individually', () => {
    expect(soldIndividually({ sold_individually: true })).toBe(true);
    expect(soldIndividually({ manage_stock: 'parent' }, { sold_individually: true })).toBe(true);
    expect(soldIndividually({ manage_stock: true, stock_quantity: 7 }, { sold_individually: false })).toBe(false);
    expect(soldIndividually({})).toBe(false);
  });
});

describe('sold individually does not read as stock', () => {
  it('a managed stock of 50 with sold individually: the flag is set, and the stock is not reported as the cap', () => {
    const p = { ...base, sold_individually: true, manage_stock: true, stock_quantity: 50, backorders: 'no' } as unknown as WooProduct;
    const out = liveProductOf(p);
    expect(out.max).toBe(1);
    expect(out.soldOne).toBe(true);
  });
  it('a plain managed product is not flagged', () => {
    const p = { ...base, manage_stock: true, stock_quantity: 50, backorders: 'no' } as unknown as WooProduct;
    expect(liveProductOf(p).soldOne).toBe(false);
  });
  it('a variation carries the flag too', () => {
    const v = { id: 9, price: '900', regular_price: '900', sale_price: '', on_sale: false, stock_status: 'instock', manage_stock: 'parent', attributes: [], menu_order: 0 } as unknown as WooVariation;
    expect(liveVariationOf(v, { sold_individually: true } as unknown as WooProduct).soldOne).toBe(true);
  });
});

// The live answer gives the stock alone (stockMax: what the stock allows, the parent's when a variation shares it) apart
// from sold individually (soldOne), and says which variations share the parent's stock (sharedStock).
describe('the stock cap, apart from sold individually', () => {
  it('stockCap is the managed quantity, never clamped by sold individually', () => {
    expect(stockCap({ manage_stock: true, stock_quantity: 5, sold_individually: true })).toBe(5);
    expect(stockCap({ manage_stock: false, stock_quantity: 5 })).toBeNull();
    expect(stockCap({ manage_stock: true, stock_quantity: 5, backorders: 'yes' })).toBeNull();
  });

  it('a variation sharing the parent stock carries the parent cap and says it shares it', () => {
    const parent = { manage_stock: true, stock_quantity: 5, sold_individually: true } as unknown as WooProduct;
    const v = { id: 11, price: '900', regular_price: '900', sale_price: '', on_sale: false, stock_status: 'instock', manage_stock: 'parent', attributes: [], menu_order: 0 } as unknown as WooVariation;
    const out = liveVariationOf(v, parent);
    expect(out.stockMax).toBe(5);
    expect(out.max).toBe(1); // purchasableMax keeps its one-per-cart cap
    expect(out.soldOne).toBe(true);
    expect(out.sharedStock).toBe(true);
    const own = { ...v, manage_stock: true, stock_quantity: 2 } as unknown as WooVariation;
    expect(liveVariationOf(own, parent).sharedStock).toBe(false);
    expect(liveVariationOf(own, parent).stockMax).toBe(2);
  });

  it('a simple product carries its stock cap too', () => {
    expect(liveProductOf({ id: 3, type: 'simple', price: '1', price_html: '', stock_status: 'instock', manage_stock: true, stock_quantity: 4, sold_individually: false } as unknown as WooProduct).stockMax).toBe(4);
  });
});

