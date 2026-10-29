import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { collectionCounts, currencyMinorUnit, matchCount, storeProducts } = await import('./storeCatalog');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn<typeof fetch>();
let n = 0; // a distinct query per test, so the in-process counts cache never answers for another test
const q = () => ({ categoryIds: [1000 + ++n] });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collectionCounts: failed request vs empty result (the dead-end bug)', () => {
  it('returns null when the request fails', async () => {
    fetchMock.mockImplementation(async () => json({ code: 'oops' }, 500));
    expect(await collectionCounts(q(), { attributes: ['pa_felag-lid'] })).toBeNull();
  });

  it('returns null when the request cannot be made at all', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await collectionCounts(q(), { taxonomies: ['product_cat'] })).toBeNull();
  });

  it('returns empty maps (not null) when nothing matches', async () => {
    fetchMock.mockImplementation(async () => json({ attribute_counts: [], taxonomy_counts: null, stock_status_counts: null }));
    const counts = await collectionCounts(q(), { attributes: ['pa_felag-lid'] });
    expect(counts).not.toBeNull();
    expect(counts?.attribute.size).toBe(0);
    expect(counts?.taxonomy.size).toBe(0);
  });

  it('maps term, size and stock counts and asks for exactly what is requested', async () => {
    fetchMock.mockResolvedValue(
      json({
        taxonomy_counts: [{ term: 653, count: 581 }],
        attribute_counts: [{ term: 627, count: 4 }],
        stock_status_counts: [{ status: 'instock', count: '572' }, { status: 'outofstock', count: '9' }],
        mos_size_counts: [{ slug: '42', label: '42', group: 'shoe', sort: 42, count: 125 }],
      }),
    );
    const counts = await collectionCounts(
      { categoryIds: [653], sizeSlugs: ['42'], minPrice: 5000, maxPrice: 9999, stockStatus: ['instock'], on_sale: true },
      { taxonomies: ['product_cat'], attributes: ['pa_ithrott'], sizes: true, stock: true },
    );
    expect(counts?.taxonomy.get(653)).toBe(581);
    expect(counts?.attribute.get(627)).toBe(4);
    expect(counts?.stock.get('instock')).toBe(572);
    expect(counts?.sizes).toEqual([{ slug: '42', label: '42', group: 'shoe', sort: 42, count: 125 }]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/wp-json/wc/store/v1/products/collection-data');
    expect(url.searchParams.get('mos_size')).toBe('42');
    expect(url.searchParams.get('min_price')).toBe('5000');
    expect(url.searchParams.get('max_price')).toBe('9999');
    expect(url.searchParams.getAll('stock_status[]')).toEqual(['instock']);
    expect(url.searchParams.get('on_sale')).toBe('true');
    expect(url.searchParams.get('mos_size_counts')).toBe('1');
    expect(url.searchParams.get('calculate_stock_status_counts')).toBe('true');
    expect(url.searchParams.get('calculate_attribute_counts[0][taxonomy]')).toBe('pa_ithrott');
  });

  it('serves a repeated query from the cache; a failure is only remembered briefly (LC-03)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const query = q();
    fetchMock.mockImplementationOnce(async () => json({}, 503));
    expect(await collectionCounts(query, { taxonomies: ['product_cat'] })).toBeNull();
    vi.setSystemTime(Date.now() + 16_000); // past the failure memo
    fetchMock.mockImplementation(async () => json({ taxonomy_counts: [{ term: 1, count: 2 }] }));
    expect((await collectionCounts(query, { taxonomies: ['product_cat'] }))?.taxonomy.get(1)).toBe(2);
    expect((await collectionCounts(query, { taxonomies: ['product_cat'] }))?.taxonomy.get(1)).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('matchCount', () => {
  it('sums the stock statuses, or only the ones the query is limited to', async () => {
    fetchMock.mockImplementation(async () => json({ stock_status_counts: [{ status: 'instock', count: '10' }, { status: 'outofstock', count: '2' }] }));
    expect(await matchCount(q())).toBe(12);
    expect(await matchCount({ ...q(), stockStatus: ['instock'] })).toBe(10);
  });

  it('is undefined when the request fails', async () => {
    fetchMock.mockImplementation(async () => json({}, 500));
    expect(await matchCount(q())).toBeUndefined();
  });
});

describe('collectionCounts: concurrent identical requests share one fetch (F-3)', () => {
  it('makes one request for two concurrent calls with the same URL', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementation(async () => {
      await gate;
      return json({ taxonomy_counts: [{ term: 7, count: 3 }] });
    });
    const query = q();
    const a = collectionCounts(query, { taxonomies: ['product_cat'] });
    const b = collectionCounts(query, { taxonomies: ['product_cat'] });
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ra?.taxonomy.get(7)).toBe(3);
    expect(rb?.taxonomy.get(7)).toBe(3);
  });

  it('drops a failed in-flight request, so the next call after the failure memo asks again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const query = q();
    fetchMock.mockImplementationOnce(async () => json({}, 500));
    const [a, b] = await Promise.all([collectionCounts(query, { stock: true }), collectionCounts(query, { stock: true })]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 16_000); // past the failure memo (LC-03)
    fetchMock.mockImplementation(async () => json({ stock_status_counts: [{ status: 'instock', count: '4' }] }));
    expect((await collectionCounts(query, { stock: true }))?.stock.get('instock')).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('collectionCounts: price-preset and sale counts in the same request (F-3, mos_extra_counts)', () => {
  it('asks for the ranges and the sale count, and maps the answer', async () => {
    fetchMock.mockResolvedValue(json({ stock_status_counts: [], mos_extra_counts: { price: [12, 0, 5], on_sale: 4 } }));
    const counts = await collectionCounts(q(), {
      stock: true,
      extra: { priceRanges: [{ min: undefined, max: 4999 }, { min: 5000, max: 9999 }, { min: 20000, max: undefined }], onSale: true },
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('mos_extra_counts')).toBe('1');
    expect(url.searchParams.get('mos_price_ranges')).toBe(':4999,5000:9999,20000:');
    expect(url.searchParams.get('mos_sale_count')).toBe('1');
    expect(counts?.extra).toEqual({ price: [12, 0, 5], onSale: 4 });
  });

  it('is null when the plugin does not answer the field (not deployed), so the caller falls back', async () => {
    fetchMock.mockResolvedValue(json({ stock_status_counts: [] }));
    const counts = await collectionCounts(q(), { stock: true, extra: { priceRanges: [{ min: 1, max: 2 }], onSale: false } });
    expect(counts).not.toBeNull();
    expect(counts?.extra).toBeNull();
  });

  it('does not ask for a sale count it does not need', async () => {
    fetchMock.mockResolvedValue(json({ mos_extra_counts: { price: [1], on_sale: null } }));
    const counts = await collectionCounts(q(), { extra: { priceRanges: [{ min: 1, max: 2 }], onSale: false } });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('mos_sale_count')).toBeNull();
    expect(counts?.extra).toEqual({ price: [1], onSale: undefined });
  });
});

describe('collectionCounts: a response that is not the expected JSON is logged (F-16)', () => {
  it('logs the path (no query) as one JSON error line (LC-06) and returns null', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response('<html>not json', { status: 200 }));
    expect(await collectionCounts(q(), { stock: true })).toBeNull();
    const errors = out.mock.calls.map((c) => String(c[0])).filter((l) => JSON.parse(l).level === 'error');
    expect(errors).toHaveLength(1);
    const line = errors[0];
    expect(line).toContain('/wc/store/v1/products/collection-data');
    expect(line).not.toContain('category=');
  });
});

describe('currencyMinorUnit (F-17)', () => {
  it('is 0 until a product response says otherwise, then follows it', async () => {
    expect(currencyMinorUnit()).toBe(0);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: 1, name: 'x', prices: { price: '100', regular_price: '100', sale_price: '100', currency_minor_unit: 2 } }]), {
        status: 200,
        headers: { 'X-WP-Total': '1', 'X-WP-TotalPages': '1' },
      }),
    );
    await storeProducts({ categoryIds: [1] }).catch(() => undefined);
    expect(currencyMinorUnit()).toBe(2);
  });
});
