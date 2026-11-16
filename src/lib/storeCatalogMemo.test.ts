// LC-03: while WordPress is failing, the catalog must not send (and wait on) the same Store API request for every
// render. Concurrent identical grid requests share one call; a failed grid or count request is remembered briefly.
// A grid that loaded is held for a minute (stale-while-revalidate).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { storeProducts, collectionCounts } = await import('./storeCatalog');

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
});
