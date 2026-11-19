// woo.ts forgetProduct: after a poke, the product page's next read of a product (and its variations) goes to
// WooCommerce, not to the 60 s stale-while-revalidate cache (review 6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const secrets: Record<string, string | undefined> = { WOOCOMMERCE_CONSUMER_KEY: 'ck_test', WOOCOMMERCE_CONSUMER_SECRET: 'cs_test' };
vi.mock('astro:env/server', () => ({
  WP_INTERNAL_URL: 'http://wp.test',
  getSecret: (name: string) => secrets[name],
}));

const title = { current: 'Gamalt' };
const fetchMock = vi.fn(async (url: string) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/variations')) return new Response(JSON.stringify([{ id: 9, menu_order: 0, price: '100' }]), { status: 200 });
  const slug = u.searchParams.get('slug');
  return new Response(JSON.stringify([{ id: 42, slug, name: title.current, status: 'publish' }]), { status: 200 });
});

describe('woo forget hook', () => {
  beforeEach(() => {
    title.current = 'Gamalt';
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a product read from the cache is read again after a forget, and shows the new data', async () => {
    const woo = await import('./woo');
    const slug = 'forget-titill-1';
    expect((await woo.getProductBySlug(slug))?.name).toBe('Gamalt');
    title.current = 'Nýtt';
    expect((await woo.getProductBySlug(slug))?.name).toBe('Gamalt'); // inside the minute: the cached copy
    woo.forgetProduct(slug);
    expect((await woo.getProductBySlug(slug))?.name).toBe('Nýtt');
  });

  it('forgets the variations of a product once its slug has been loaded', async () => {
    const woo = await import('./woo');
    const slug = 'forget-titill-2';
    await woo.getProductBySlug(slug);
    await woo.getVariations(42);
    const before = fetchMock.mock.calls.filter(([u]) => String(u).includes('/variations')).length;
    await woo.getVariations(42); // cached
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/variations')).length).toBe(before);
    woo.forgetProduct(slug);
    await woo.getVariations(42);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/variations')).length).toBe(before + 1);
  });

  it('treats an Icelandic slug the same in composed and decomposed form', async () => {
    const woo = await import('./woo');
    const composed = 'þjálfun-forget-3';
    const decomposed = composed.normalize('NFD');
    await woo.getProductBySlug(composed);
    woo.forgetProduct(decomposed);
    const calls = fetchMock.mock.calls.length;
    await woo.getProductBySlug(composed);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });

  it('forgetting a slug nobody loaded is harmless', async () => {
    const woo = await import('./woo');
    expect(() => woo.forgetProduct('aldrei-sott-4')).not.toThrow();
  });
});

describe('woo forget hook: bulk', () => {
  it('forgetAllProducts makes every product read go to WooCommerce again', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const woo = await import('./woo');
    await woo.getProductBySlug('bulk-titill-5');
    const calls = fetchMock.mock.calls.length;
    await woo.getProductBySlug('bulk-titill-5');
    expect(fetchMock.mock.calls.length).toBe(calls);
    woo.forgetAllProducts();
    await woo.getProductBySlug('bulk-titill-5');
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
    vi.unstubAllGlobals();
  });
});

describe('woo forget hook: generations never collide', () => {
  it('a bulk forget after a single forget still shows the newest data', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const woo = await import('./woo');
    const slug = 'kollun-titill-6';
    title.current = 'v1';
    await woo.getProductBySlug(slug);
    woo.forgetProduct(slug);
    title.current = 'v2';
    expect((await woo.getProductBySlug(slug))?.name).toBe('v2');
    title.current = 'v3';
    woo.forgetAllProducts();
    expect((await woo.getProductBySlug(slug))?.name).toBe('v3');
    vi.unstubAllGlobals();
  });
});

