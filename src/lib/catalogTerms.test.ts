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

// refreshCatalogTerms: a product save can bring a team, brand, size or colour the filter has no option for yet. The
// lists are reloaded at once (the previous ones keep answering meanwhile), and the caller is told whether the options
// changed, because pages rendered from the old lists then show the wrong options.
describe('refreshCatalogTerms', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'X-WP-TotalPages': '1' } });
  /** A WordPress whose lists can be changed between reads. */
  function wordpress() {
    const state = {
      teams: [{ id: 2, name: 'FH', slug: 'fh', parent: 0, count: 1 }],
      categories: [{ id: 9, name: 'Bolir', slug: 'bolir', parent: 0, count: 0 }],
      sizes: [{ slug: '42', label: '42', group: 'shoe', sort: 42, count: 1 }],
      down: false,
    };
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (state.down) return new Response('{}', { status: 502 });
      if (path.endsWith('/products/attributes')) return json([{ id: 5, taxonomy: 'pa_felag-lid' }]);
      if (path.includes('/products/attributes/5/terms')) return json(state.teams);
      if (path.includes('/products/categories')) return json(state.categories);
      if (path.includes('/mos/v1/sizes')) return json({ sizes: state.sizes });
      if (path.includes('/products/')) return json([]);
      return json({});
    });
    return { state, fetchMock };
  }
  async function withWordpress(run: (mod: typeof import('./catalogTerms'), wp: ReturnType<typeof wordpress>) => Promise<void>) {
    vi.resetModules();
    const wp = wordpress();
    vi.stubGlobal('fetch', wp.fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await run(await import('./catalogTerms'), wp);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  }

  it('a new team: the lists are reloaded and the options changed', async () => {
    await withWordpress(async (mod, { state }) => {
      expect((await mod.loadCatalogTerms()).teams.map((t) => t.slug)).toEqual(['fh']);
      state.teams = [...state.teams, { id: 3, name: 'Ísland', slug: 'island-iceland', parent: 0, count: 1 }];
      expect(await mod.refreshCatalogTerms()).toBe(true);
      expect((await mod.loadCatalogTerms()).teams.map((t) => t.slug)).toEqual(['fh', 'island-iceland']);
    });
  });

  it('nothing new in WordPress: reloaded, options unchanged', async () => {
    await withWordpress(async (mod, { fetchMock }) => {
      await mod.loadCatalogTerms();
      await mod.loadSizeTerms();
      const reads = fetchMock.mock.calls.length;
      expect(await mod.refreshCatalogTerms()).toBe(false);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it('a product count that only grows is not a changed option', async () => {
    await withWordpress(async (mod, { state }) => {
      await mod.loadCatalogTerms();
      state.teams = [{ ...state.teams[0], count: 7 }];
      expect(await mod.refreshCatalogTerms()).toBe(false);
    });
  });

  it('the same terms in another order are not a changed option (WordPress orders equal names either way)', async () => {
    await withWordpress(async (mod, { state }) => {
      state.teams = [{ id: 2, name: 'FH', slug: 'fh', parent: 0, count: 1 }, { id: 3, name: 'FH', slug: 'fh-2', parent: 0, count: 1 }];
      await mod.loadCatalogTerms();
      state.teams = [state.teams[1], state.teams[0]];
      expect(await mod.refreshCatalogTerms()).toBe(false);
    });
  });

  it('says so when the reload fails, since the new option then waits', async () => {
    await withWordpress(async (mod, { state }) => {
      await mod.loadCatalogTerms();
      const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
      state.down = true;
      await mod.refreshCatalogTerms();
      const lines = [...logged.mock.calls, ...warned.mock.calls].map((c) => c.map(String).join(' ')).join('\n');
      expect(lines).toContain('reload after a product change failed');
    });
  });

  it('a category that gets its first product is a changed option (the rail lists stocked categories only)', async () => {
    await withWordpress(async (mod, { state }) => {
      await mod.loadCatalogTerms();
      state.categories = [{ ...state.categories[0], count: 1 }];
      expect(await mod.refreshCatalogTerms()).toBe(true);
    });
  });

  it('a new size is a changed option', async () => {
    await withWordpress(async (mod, { state }) => {
      await mod.loadCatalogTerms();
      await mod.loadSizeTerms();
      state.sizes = [...state.sizes, { slug: '44', label: '44', group: 'shoe', sort: 44, count: 1 }];
      expect(await mod.refreshCatalogTerms()).toBe(true);
      expect((await mod.loadSizeTerms()).sizes?.map((s) => s.slug)).toEqual(['42', '44']);
    });
  });

  it('nothing was held before: loaded, and nothing rendered from it can be wrong', async () => {
    await withWordpress(async (mod) => {
      expect(await mod.refreshCatalogTerms()).toBe(false);
      expect((await mod.loadCatalogTerms()).teams.map((t) => t.slug)).toEqual(['fh']);
    });
  });

  it('WordPress down: the previous lists stay and nothing is reported changed', async () => {
    await withWordpress(async (mod, { state }) => {
      await mod.loadCatalogTerms();
      state.down = true;
      expect(await mod.refreshCatalogTerms()).toBe(false);
      expect((await mod.loadCatalogTerms()).teams.map((t) => t.slug)).toEqual(['fh']);
    });
  });
});

describe('peekCatalogTerms', () => {
  it('is null until the lists have loaded, then the lists, without reading WordPress itself', async () => {
    vi.resetModules();
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'X-WP-TotalPages': '1' } });
    const fetchMock = vi.fn(async (url: string) => (new URL(url).pathname.includes('/products/attributes/5/terms') ? json([{ id: 2, name: 'FH', slug: 'fh', parent: 0, count: 1 }]) : new URL(url).pathname.endsWith('/products/attributes') ? json([{ id: 5, taxonomy: 'pa_felag-lid' }]) : json([])));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const mod = await import('./catalogTerms');
      expect(mod.peekCatalogTerms()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      await mod.loadCatalogTerms();
      expect(mod.peekCatalogTerms()?.teams.map((t) => t.slug)).toEqual(['fh']);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
