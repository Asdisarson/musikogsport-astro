// loadArchive (LC-14): how every archive (shop, category, brand, tag, search) turns its URL and scope into the grid
// query, which outages answer 503, and how the facet groups come out. Store API and term loaders are faked; the
// filter and facet rules (liveFilters, facets, categoryTree) are the real ones.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreQuery } from './storeCatalog';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));

const cat = (id: number, slug: string, parent = 0) => ({ id, slug, name: slug.toUpperCase(), parent });
const terms = {
  categories: [cat(1, 'skor'), cat(2, 'hlaupaskor', 1), cat(3, 'fatnadur'), cat(10, 'kyn'), cat(11, 'konur', 10), cat(12, 'karlar', 10)],
  brands: [{ id: 50, slug: 'nike', name: 'Nike' }, { id: 51, slug: 'hoka', name: 'Hoka' }],
  teams: [],
  sports: [],
  colours: [{ id: 364, slug: 'svartur', name: 'Svartur' }, { id: 363, slug: 'blar', name: 'Blár' }, { id: 900, slug: 'mynstrad', name: 'Mynstrað' }],
  tags: [],
  counts: new Map([[1, 5], [2, 3], [3, 4], [10, 9], [11, 4], [12, 5], [50, 6], [51, 2]]),
  degraded: false,
};
let currentTerms: typeof terms = terms;
let sizeIndex: { sizes: undefined | { slug: string; label: string; group: string; sort: number }[]; status: 'ok' | 'absent' | 'down' } = { sizes: undefined, status: 'absent' };
vi.mock('./catalogTerms', () => ({
  loadCatalogTerms: vi.fn(async () => currentTerms),
  loadSizeTerms: vi.fn(async () => sizeIndex),
}));

const products = vi.fn<(q: StoreQuery) => Promise<unknown>>();
const counts = vi.fn<(q: StoreQuery, req: unknown) => Promise<unknown>>();
vi.mock('./storeCatalog', () => ({
  COUNT_TAXONOMIES: { category: 'product_cat', brand: 'product_brand', team: 'pa_felag-lid', sport: 'pa_ithrott', colour: 'pa_litur' },
  currencyMinorUnit: () => 0,
  storeProducts: (q: StoreQuery) => products(q),
  collectionCounts: (q: StoreQuery, req: unknown) => counts(q, req),
  matchCount: vi.fn(async () => 1),
}));

const { loadArchive } = await import('./archive');
const P = (qs = '') => new URLSearchParams(qs);
const result = { items: [{ id: 9 }], total: 7, totalPages: 1, page: 1 };
const mainCounts = {
  taxonomy: new Map([[1, 5], [2, 3], [3, 4], [11, 4], [12, 3], [50, 6], [51, 1]]),
  attribute: new Map(),
  stock: new Map([['instock', 6]]),
  sizes: null,
  extra: null,
};

beforeEach(() => {
  currentTerms = terms;
  sizeIndex = { sizes: undefined, status: 'absent' };
  products.mockReset().mockResolvedValue(result);
  counts.mockReset().mockResolvedValue(mainCounts);
});

describe('loadArchive', () => {
  it('queries the shop with page and sort, and returns the grid', async () => {
    const a = await loadArchive(P('orderby=price'), 2);
    expect(a.unavailable).toBe(false);
    expect(a.result).toBe(result);
    expect(products).toHaveBeenCalledTimes(1);
    expect(products.mock.calls[0][0]).toMatchObject({ page: 2, orderby: 'price', order: 'asc' });
  });

  it("scopes a category, brand or tag archive to its own term", async () => {
    await loadArchive(P(), 1, { categoryId: 1 });
    expect(products.mock.calls[0][0].categoryIds).toEqual([1]);
    await loadArchive(P(), 1, { brandId: 51 });
    expect(products.mock.calls[1][0].brandIds).toEqual([51]);
    await loadArchive(P(), 1, { tagId: 77 });
    expect(products.mock.calls[2][0].tagIds).toEqual([77]);
  });

  it('maps filter slugs to ids (kyn as the AND clause), drops unknown ones, and labels the active filters', async () => {
    const a = await loadArchive(P('brand=nike,nosuch&kyn=konur'), 1);
    const q = products.mock.calls[0][0];
    expect(q.brandIds).toEqual([50]);
    expect(q.andCategoryIds).toEqual([11]);
    expect(a.activeCount).toBe(2);
    expect(a.activeLabels).toEqual(expect.arrayContaining(['Nike', 'KONUR']));
    // an active OR-within group gets a companion count request without its own selection
    expect(counts.mock.calls.some(([cq]) => cq.brandIds === undefined)).toBe(true);
  });

  it('answers unavailable without asking for products when the terms are down and the URL filters by a term', async () => {
    currentTerms = { ...terms, categories: [], brands: [], counts: new Map(), degraded: true };
    const a = await loadArchive(P('brand=nike'), 1);
    expect(a.unavailable).toBe(true);
    expect(products).not.toHaveBeenCalled();
    // the plain shop and a search still work without the terms
    expect((await loadArchive(P('s=skor'), 1)).unavailable).toBe(false);
  });

  it('answers unavailable for a size filter while the size list is down, and ignores it when the plugin is absent', async () => {
    sizeIndex = { sizes: undefined, status: 'down' };
    expect((await loadArchive(P('staerd=42'), 1)).unavailable).toBe(true);
    sizeIndex = { sizes: undefined, status: 'absent' };
    const a = await loadArchive(P('staerd=42'), 1);
    expect(a.unavailable).toBe(false);
    expect(products.mock.calls.at(-1)![0].sizeSlugs).toBeUndefined();
  });

  it('is unavailable when the grid request fails, with an empty result for the page', async () => {
    products.mockRejectedValue(new Error('down'));
    const a = await loadArchive(P(), 3);
    expect(a.unavailable).toBe(true);
    expect(a.result).toEqual({ items: [], total: 0, totalPages: 0, page: 3 });
  });

  it('builds the rail: brands with products, counts shown, empty groups left out', async () => {
    const a = await loadArchive(P(), 1);
    const brand = a.groups.find((g) => g.key === 'brand')!;
    expect(brand.showCounts).toBe(true);
    expect(brand.options.map((o) => [o.slug, o.count])).toEqual([['nike', 6], ['hoka', 1]]);
    expect(a.groups.find((g) => g.key === 'team')).toBeUndefined(); // no Félag/Lið terms
    const kyn = a.groups.find((g) => g.key === 'kyn')!;
    expect(kyn.options.map((o) => o.slug)).toEqual(['konur', 'karlar']);
  });

  it('builds Litur: commonest colour first, a swatch per known colour, colours without products hidden', async () => {
    counts.mockResolvedValue({ ...mainCounts, attribute: new Map([[364, 4], [363, 9], [900, 0]]) });
    const a = await loadArchive(P(), 1);
    expect(counts.mock.calls[0][1]).toMatchObject({ attributes: ['pa_felag-lid', 'pa_ithrott', 'pa_litur'] });
    const litur = a.groups.find((g) => g.key === 'litur')!;
    expect(litur.options.map((o) => [o.slug, o.count, o.swatch])).toEqual([
      ['blar', 9, ['#2f6fed']],
      ['svartur', 4, ['#1b1b1b']],
    ]);
    const keys = a.groups.map((g) => g.key);
    expect(keys.indexOf('litur')).toBe(keys.indexOf('brand') + 1);
  });

  it('keeps an active colour (and its chip) even with no products left', async () => {
    counts.mockResolvedValue({ ...mainCounts, attribute: new Map([[363, 9]]) });
    const a = await loadArchive(P('litur=svartur'), 1);
    expect(products.mock.calls[0][0].attributes).toEqual([{ taxonomy: 'pa_litur', termIds: [364] }]);
    expect(a.groups.find((g) => g.key === 'litur')!.options.find((o) => o.slug === 'svartur')).toMatchObject({ active: true });
    expect(a.activeFilters.map((f) => f.label)).toEqual(['Svartur']);
  });

  it('lists every option without counts when the count request failed', async () => {
    counts.mockResolvedValue(null);
    const a = await loadArchive(P(), 1);
    const brand = a.groups.find((g) => g.key === 'brand')!;
    expect(brand.showCounts).toBe(false);
    expect(brand.options.map((o) => o.slug)).toEqual(['nike', 'hoka']);
    expect(a.unavailable).toBe(false);
  });
});

describe('loadArchive: degraded catalogue terms (review 23)', () => {
  it('a plain shop still loads with its terms degraded, and reports them, so its page can mark itself degraded', async () => {
    currentTerms = { ...terms, degraded: true };
    const a = await loadArchive(P(), 1);
    expect(a.unavailable).toBe(false);
    expect(a.terms.degraded).toBe(true);
  });
});

describe('loadArchive: the picking caps (review 33)', () => {
  const brands = Array.from({ length: 8 }, (_, i) => ({ id: 60 + i, slug: `b${i}`, name: `B${i}` }));
  const group = (a: Awaited<ReturnType<typeof loadArchive>>, key: string) => a.groups.find((g) => g.key === key)!;
  beforeEach(() => {
    currentTerms = { ...terms, brands };
    counts.mockResolvedValue({
      ...mainCounts,
      taxonomy: new Map<number, number>([...brands.map((b): [number, number] => [b.id, 2]), [1, 5], [2, 3], [3, 4], [10, 9], [11, 4], [12, 3]]),
      attribute: new Map<number, number>([[364, 2], [363, 2]]),
    });
  });

  it('a brand group with 6 picks offers no more: its other brands are unavailable, with the reason', async () => {
    const a = await loadArchive(P('brand=b0,b1,b2,b3,b4,b5'), 1);
    const g = group(a, 'brand');
    expect(g.note).toMatch(/^Mest er hægt að velja 6 í þessum flokki/);
    expect(g.options.filter((o) => o.active).every((o) => o.blocked === undefined)).toBe(true);
    expect(g.options.filter((o) => !o.active).map((o) => [o.slug, o.blocked !== undefined])).toEqual([
      ['b6', true],
      ['b7', true],
    ]);
  });

  it('a group with room is not blocked and has no note', async () => {
    const a = await loadArchive(P('brand=b0,b1'), 1);
    const g = group(a, 'brand');
    expect(g.note).toBeUndefined();
    expect(g.options.every((o) => o.blocked === undefined)).toBe(true);
  });

  it('twelve picks in all block every other option of every capped filter, and say so', async () => {
    const a = await loadArchive(P('brand=b0,b1,b2,b3,b4,b5&kyn=konur,karlar&product-category=skor,fatnadur,hlaupaskor&litur=svartur'), 1);
    expect(group(a, 'litur').options.find((o) => o.slug === 'svartur')?.blocked).toBeUndefined();
    expect(group(a, 'litur').options.find((o) => o.slug === 'blar')?.blocked).toMatch(/^Mest er hægt að velja 12 síur í einu/);
    expect(group(a, 'brand').note).toMatch(/^Mest er hægt að velja 12 síur í einu/);
    expect(group(a, 'product-category').note).toMatch(/^Mest er hægt að velja 12 síur í einu/);
  });
});
