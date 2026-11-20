// A listing page shows 24 products (owner, 2026-11-20): the grid asks WooCommerce for that many unless told otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));

describe('storeCatalog page size', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { 'X-WP-Total': '0', 'X-WP-TotalPages': '0' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for 24 products a page by default', async () => {
    const cat = await import('./storeCatalog');
    expect(cat.CATALOG_PER_PAGE).toBe(24);
    await cat.storeProducts({ page: 2 });
    const asked = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname.endsWith('/products'));
    expect(asked?.searchParams.get('per_page')).toBe('24');
    expect(asked?.searchParams.get('page')).toBe('2');
  });
});
