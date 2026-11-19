// Pure rules for the live price and stock answer (/api/live). Written before lib/livePrices.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));

import {
  LIVE_MAX_IDS,
  buyable,
  cardAction,
  chunkIds,
  liveProductOf,
  liveVariationOf,
  parseLiveIds,
  pdpPriceFill,
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
    expect(out).toEqual({ id: 7, type: 'simple', priceHtml: expect.any(String), percent: null, stock: 'instock' });
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
    expect(liveVariationOf(v)).toEqual({ id: 9, price: '900', regular_price: '1000', sale_price: '900', on_sale: true, stock: 'outofstock' });
  });
});

describe('pdpPriceFill (the product page price, corrected from the live answer)', () => {
  const shown = '<span class="amount">1.000 kr.</span>';
  const liveOf = (over: Partial<LiveProduct> = {}): LiveProduct => ({ id: 1, type: 'simple', priceHtml: shown, percent: null, stock: 'instock', ...over });
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
