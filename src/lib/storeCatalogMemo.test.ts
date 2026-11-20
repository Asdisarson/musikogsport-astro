// LC-03: while WordPress is failing, the catalog must not send (and wait on) the same Store API request for every
// render. Concurrent identical grid requests share one call; a failed grid or count request is remembered briefly.
// A grid that loaded is held for a minute (stale-while-revalidate).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { storeProducts, collectionCounts, STOCK_GRIDS_PER_MINUTE } = await import('./storeCatalog');

const fetchMock = vi.fn<typeof fetch>();
let n = 0;
const fresh = () => ({ categoryIds: [9000 + ++n] }); // a URL no other test has used (module-level caches)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
  fetchMock.mockReset();
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

const products = () => new Response('[]', { status: 200, headers: { 'X-WP-Total': '0', 'X-WP-TotalPages': '0' } });

describe('storeProducts', () => {
  it('shares one request between concurrent identical queries', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (release = r)));
    const q = fresh();
    const a = storeProducts(q);
    const b = storeProducts(q);
    release(products());
    expect((await a).total).toBe(0);
    expect((await b).total).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers a failure for a few seconds, then asks again', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const q = fresh();
    await expect(storeProducts(q)).rejects.toThrow('fetch failed');
    await expect(storeProducts(q)).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 30_000);
    fetchMock.mockImplementation(async () => products());
    expect((await storeProducts(q)).items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('holds a grid for a minute: a repeat is served without asking, a stale one at once while it refreshes', async () => {
    fetchMock.mockImplementation(async () => products());
    const q = fresh();
    await storeProducts(q);
    await storeProducts(q);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 60_000);
    await storeProducts(q);
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps different queries apart', async () => {
    fetchMock.mockImplementation(async () => products());
    await storeProducts(fresh());
    await storeProducts(fresh());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Stock rule: a grid filtered by stock lists products by their stock, so it is read on each request and never held.
  it('reads a stock-filtered grid again on each request (nothing held)', async () => {
    fetchMock.mockImplementation(async () => products());
    const q = { ...fresh(), stockStatus: ['instock'] };
    await storeProducts(q);
    await storeProducts(q);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // A stock-filtered grid's failure is remembered for a few seconds, as the other grids' are: a view during an outage
  // does not send (and wait on) the same request again.
  it('remembers a failed stock-filtered grid for a few seconds, then asks again', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const q = { ...fresh(), stockStatus: ['instock'] };
    await expect(storeProducts(q)).rejects.toThrow('fetch failed');
    await expect(storeProducts(q)).rejects.toThrow(/failed a moment ago/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 11_000);
    fetchMock.mockImplementation(async () => products());
    expect((await storeProducts(q)).items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('still shares one request between concurrent identical stock-filtered queries', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (release = r)));
    const q = { ...fresh(), stockStatus: ['instock'] };
    const a = storeProducts(q);
    const b = storeProducts(q);
    release(products());
    await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('collectionCounts', () => {
  it('remembers a failed count request for a few seconds instead of re-sending it on every render', async () => {
    fetchMock.mockImplementation(async () => new Response('down', { status: 502, statusText: 'Bad Gateway' }));
    const q = fresh();
    expect(await collectionCounts(q, { stock: true })).toBeNull();
    expect(await collectionCounts(q, { stock: true })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 30_000);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ stock_status_counts: [{ status: 'instock', count: 4 }] }), { status: 200 }));
    expect((await collectionCounts(q, { stock: true }))?.stock.get('instock')).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Stock rule: a stock-filtered query's counts are never served from the cache, not even for a few seconds.
  it('reads the counts of a stock-filtered query again on each request', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ stock_status_counts: [{ status: 'instock', count: 4 }] }), { status: 200 }));
    const q = { ...fresh(), stockStatus: ['instock'] };
    expect((await collectionCounts(q, { stock: true }))?.stock.get('instock')).toBe(4);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ stock_status_counts: [{ status: 'instock', count: 3 }] }), { status: 200 }));
    expect((await collectionCounts(q, { stock: true }))?.stock.get('instock')).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Runs last: it uses up the stock-filtered grid budget for its minute (module-level, shared by the tests above).
describe('storeProducts budget', () => {
  // Owner rule 2: a crawler over stock-filtered pages makes at most a bounded number of WordPress requests a minute;
  // past the cap the grid is refused (the listing renders as unavailable) and nothing is sent.
  it('caps the stock-filtered grid reads per minute and refuses the rest without asking WordPress', async () => {
    fetchMock.mockImplementation(async () => products());
    vi.setSystemTime(1_000_000 + 61_000); // a fresh minute: the reads of the tests above are out of the window
    for (let i = 0; i < STOCK_GRIDS_PER_MINUTE; i++) await storeProducts({ ...fresh(), stockStatus: ['instock'] });
    expect(fetchMock).toHaveBeenCalledTimes(STOCK_GRIDS_PER_MINUTE);
    await expect(storeProducts({ ...fresh(), stockStatus: ['instock'] })).rejects.toThrow(/budget spent/);
    expect(fetchMock).toHaveBeenCalledTimes(STOCK_GRIDS_PER_MINUTE);
  });
});
