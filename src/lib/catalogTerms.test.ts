import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { attributeIdFor } = await import('./catalogTerms');

describe('attributeIdFor', () => {
  const attributes = [
    { id: 5, taxonomy: 'pa_felag-lid' },
    { id: 6, taxonomy: 'pa_ithrott' },
  ];
  it('finds the attribute id by its taxonomy name', () => {
    expect(attributeIdFor(attributes, 'pa_ithrott', 99)).toBe(6);
    expect(attributeIdFor([{ id: 12, taxonomy: 'pa_felag-lid' }], 'pa_felag-lid', 5)).toBe(12);
  });
  it('uses the known id when the attribute list could not be read', () => {
    expect(attributeIdFor(null, 'pa_felag-lid', 5)).toBe(5);
    expect(attributeIdFor(null, 'pa_ithrott', 6, true)).toBe(6);
  });
  it('when the list was read but lacks the attribute: the known id for team, nothing for an optional one', () => {
    expect(attributeIdFor([], 'pa_felag-lid', 5)).toBe(5);
    expect(attributeIdFor(attributes.slice(0, 1), 'pa_ithrott', 6, true)).toBeUndefined();
  });
});

describe('loadSizeTerms: plugin absent vs size list down (F-8)', () => {
  it('reports absent on a 404 (no mos/v1/sizes route) and down on any other failure', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.resetModules();
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'rest_no_route' }), { status: 404 }));
      const absent = await import('./catalogTerms');
      expect(await absent.loadSizeTerms()).toEqual({ sizes: undefined, status: 'absent' });

      vi.resetModules();
      fetchMock.mockResolvedValue(new Response('{}', { status: 502 }));
      const down = await import('./catalogTerms');
      expect(await down.loadSizeTerms()).toEqual({ sizes: undefined, status: 'down' });

      vi.resetModules();
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ sizes: [{ slug: '42', label: '42', group: 'shoe', sort: 42, count: 3 }] }), { status: 200 }));
      const ok = await import('./catalogTerms');
      expect(await ok.loadSizeTerms()).toEqual({ sizes: [{ slug: '42', label: '42', group: 'shoe', sort: 42 }], status: 'ok' });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

describe('loadCatalogTerms sweep', () => {
  type Handler = (path: string) => Response;
  const json = (body: unknown, status = 200, pages = 1) => new Response(JSON.stringify(body), { status, headers: { 'X-WP-TotalPages': String(pages) } });
  const terms = (prefix: string) => [{ id: prefix.length, name: `${prefix} &amp; co`, slug: prefix, parent: 0, count: 2 }];
  const base: Handler = (path) => {
    if (path.endsWith('/products/attributes')) return json([{ id: 5, taxonomy: 'pa_felag-lid' }, { id: 6, taxonomy: 'pa_ithrott' }]);
    if (path.includes('/products/attributes/5/terms')) return json(terms('fh'));
    if (path.includes('/products/attributes/6/terms')) return json(terms('golf'));
    if (path.includes('/products/categories')) return json(terms('skor'));
    if (path.includes('/products/brands')) return json(terms('nike'));
    if (path.includes('/products/tags')) return json(terms('nytt'));
    return json({}, 404);
  };
  async function sweepWith(handler: Handler) {
    vi.resetModules();
    const fetchMock = vi.fn(async (url: string) => handler(new URL(url).pathname));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('./catalogTerms');
    return { data: await mod.loadCatalogTerms(), fetchMock };
  }

  it('loads every group, entities decoded', async () => {
    try {
      const { data } = await sweepWith(base);
      expect(data.degraded).toBe(false);
      expect(data.teams).toEqual([{ id: 2, slug: 'fh', name: 'fh & co' }]);
      expect(data.sports.map((t) => t.slug)).toEqual(['golf']);
      expect(data.categories[0]).toMatchObject({ slug: 'skor', parent: 0 });
      expect(data.counts.get(4)).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('leaves Félag/Lið out, not the whole catalog, on a site whose attribute list lacks it (LC-09)', async () => {
    try {
      const { data, fetchMock } = await sweepWith((path) =>
        path.endsWith('/products/attributes') ? json([{ id: 6, taxonomy: 'pa_ithrott' }]) : base(path),
      );
      expect(data.degraded).toBe(false);
      expect(data.teams).toEqual([]);
      expect(data.categories).toHaveLength(1);
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/attributes/5/terms'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('still fails the sweep when the Félag/Lið terms themselves fail (a stale copy is served instead)', async () => {
    try {
      const { data } = await sweepWith((path) => (path.includes('/attributes/5/terms') ? json({}, 502) : base(path)));
      expect(data.degraded).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('says so in the log when a term list is cut at the page cap (LC-10)', async () => {
    try {
      const out: string[] = [];
      const { data, fetchMock } = await sweepWith((path) => (path.includes('/products/tags') ? json(Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, name: `t${i}`, slug: `t${i}` })), 200, 25) : base(path)));
      expect(data.tags).toHaveLength(2000);
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/products/tags'))).toHaveLength(20);
      // console.log carries the JSON logger's lines
      const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
      out.push(...logged);
      expect(out.some((l) => l.includes('page cap') && l.includes('/products/tags'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
