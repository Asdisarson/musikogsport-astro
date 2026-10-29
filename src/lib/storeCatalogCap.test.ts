// The cold collection-data fan-out cap: every filter combination is a new URL, so a crawler walking combinations
// would turn each render into up to 9 Store API calls. Past the per-process budget a listing renders without counts
// (the same path as a failed count request) instead of asking WordPress.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { collectionCounts, COLD_COUNTS_PER_MINUTE } = await import('./storeCatalog');

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn<typeof fetch>();
let n = 0;
const q = () => ({ categoryIds: [5000 + ++n] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(0);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ taxonomy_counts: [{ term: 1, count: 3 }] }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('collectionCounts cold-fetch cap', () => {
  it('is well above one render (≤ 9 count requests) and caps cold fetches per minute', async () => {
    expect(COLD_COUNTS_PER_MINUTE).toBeGreaterThanOrEqual(9 * 10);
    const warm = q();
    expect(await collectionCounts(warm, { taxonomies: ['product_cat'] })).not.toBeNull();
    for (let i = 1; i < COLD_COUNTS_PER_MINUTE; i++) expect(await collectionCounts(q(), { taxonomies: ['product_cat'] })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(COLD_COUNTS_PER_MINUTE);

    // Budget spent: a new combination renders without counts and WordPress is not asked.
    expect(await collectionCounts(q(), { taxonomies: ['product_cat'] })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(COLD_COUNTS_PER_MINUTE);

    // A cached combination is still answered (fresh hits cost nothing).
    expect((await collectionCounts(warm, { taxonomies: ['product_cat'] }))?.taxonomy.get(1)).toBe(3);

    // Stale beats none: past its 30 s TTL but within the cap's minute, the old counts come back without a fetch.
    vi.setSystemTime(45 * 1000);
    expect((await collectionCounts(warm, { taxonomies: ['product_cat'] }))?.taxonomy.get(1)).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(COLD_COUNTS_PER_MINUTE);

    // The next minute brings a fresh budget.
    vi.setSystemTime(61 * 1000);
    expect(await collectionCounts(q(), { taxonomies: ['product_cat'] })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(COLD_COUNTS_PER_MINUTE + 1);
  });
});
