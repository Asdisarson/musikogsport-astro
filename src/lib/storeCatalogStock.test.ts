// A product grid that the catalog holds (60 s, stale-while-revalidate) carries no stock: stock is read live (the
// /api/live answer) and never kept in memory (owner rule 1). The stock-filtered grid is read live too; it holds no
// stock on its products either, as nothing reads it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { storeProducts } = await import('./storeCatalog');

const fetchMock = vi.fn<typeof fetch>();
let n = 0;
const fresh = () => ({ categoryIds: [7000 + ++n] }); // a URL no other test has used (module-level caches)

const raw = {
  id: 7,
  name: 'Bolur',
  slug: 'bolur',
  type: 'simple',
  prices: { price: '4990', regular_price: '4990', sale_price: '', currency_minor_unit: 0 },
  price_html: '<span>4.990 kr.</span>',
  on_sale: false,
  is_in_stock: false,
  images: [],
  categories: [],
  attributes: [],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify([raw]), { status: 200, headers: { 'X-WP-Total': '1', 'X-WP-TotalPages': '1' } }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the product grid holds no stock', () => {
  it('a grid kept in the cache has its products without stock, and a repeat is served from it', async () => {
    const q = fresh();
    const first = await storeProducts(q);
    expect(first.items[0].slug).toBe('bolur');
    expect(first.items[0]).not.toHaveProperty('stock_status');
    const again = await storeProducts(q);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.items[0]).not.toHaveProperty('stock_status');
    expect(again.items[0].price).toBe('4990');
  });

  it('a stock-filtered grid is read on each request and its products hold no stock either', async () => {
    const q = { ...fresh(), stockStatus: ['instock'] };
    const page = await storeProducts(q);
    await storeProducts(q);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.items[0]).not.toHaveProperty('stock_status');
  });
});
