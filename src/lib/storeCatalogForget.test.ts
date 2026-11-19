// storeCatalog forgetAllGrids: after a catalogue poke, the product grids are read again, not shown from the minute's
// cache (review 6, listings).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));

describe('storeCatalog grid forget', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { 'X-WP-Total': '0', 'X-WP-TotalPages': '0' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a grid is shown from the cache until the grids are forgotten', async () => {
    const cat = await import('./storeCatalog');
    await cat.storeProducts({ page: 1, per_page: 7 });
    const before = fetchMock.mock.calls.length;
    await cat.storeProducts({ page: 1, per_page: 7 });
    expect(fetchMock.mock.calls.length).toBe(before);
    cat.forgetAllGrids();
    await cat.storeProducts({ page: 1, per_page: 7 });
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });
});
