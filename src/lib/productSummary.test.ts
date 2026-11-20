import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.example' }));

import { productSummary } from './productSummary';
import type { WooProduct } from './types';

const SALE = '<del><span class="amount">2.000 kr.</span></del> <ins><span class="amount">1.500 kr.</span></ins>';
const product = (over: Partial<WooProduct> = {}): WooProduct =>
  ({
    id: 5,
    name: 'Skór',
    slug: 'skor',
    permalink: 'https://example.test/vara/skor/',
    type: 'simple',
    price: '1500',
    regular_price: '2000',
    sale_price: '1500',
    on_sale: true,
    price_html: SALE,
    stock_status: 'outofstock',
    images: [],
    categories: [],
    ...over,
  }) as WooProduct;

describe('productSummary', () => {
  it('carries the sold-out mark and no discount for a sold-out product by default (the wishlist reads it live)', () => {
    const s = productSummary(product(), []);
    expect(s.outOfStock).toBe(true);
    expect(s.percent).toBeUndefined();
  });

  it('carries the discount for an in-stock sale product', () => {
    const s = productSummary(product({ stock_status: 'instock' }), []);
    expect(s.outOfStock).toBe(false);
    expect(s.percent).toBe(25);
  });

  it('with stock off (a cached product) carries no stock at all, and the discount does not depend on it', () => {
    const soldOut = productSummary(product(), [], { stock: false });
    expect('outOfStock' in soldOut).toBe(false);
    expect(soldOut.percent).toBe(25);
    const inStock = productSummary(product({ stock_status: 'instock' }), [], { stock: false });
    expect('outOfStock' in inStock).toBe(false);
    expect(inStock.percent).toBe(25);
  });
});
