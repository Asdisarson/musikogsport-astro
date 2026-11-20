// POST /api/shell-refresh (review 4, 5, 9): the cached product goes before any mark, the unkeyed route acts only on
// paths the store knows, and its budget counts path actions (a WordPress bulk edit is served, a stranger is not).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));

const m = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    known: new Set<string>(),
    cached: new Set<string>(),
    fns: {
      invalidatePaths: async (ps: string[]) => void calls.push(`stale:${ps.join(',')}`),
      dropPage: async (p: string) => void calls.push(`drop:${p}`),
      invalidateProducts: async () => void calls.push('products'),
      invalidateListings: async () => void calls.push('listings'),
      knowsPath: async (p: string) => m.known.has(p),
      forgetProduct: (slug: string) => void calls.push(`forget:${slug}`),
      forgetAllProducts: () => void calls.push('forgetAllProducts'),
      forgetAllGrids: () => void calls.push('grids'),
      productCached: (slug: string) => m.cached.has(slug),
      refreshCatalogTerms: async () => {
        m.terms.count += 1;
        return m.terms.changed;
      },
    },
    // Counted apart from `calls`: the term refreshes are not part of the path sequence the tests above assert.
    terms: { count: 0, changed: false },
  };
});

vi.mock('../lib/shellRuntime', () => ({
  invalidatePaths: m.fns.invalidatePaths,
  dropPage: m.fns.dropPage,
  invalidateProducts: m.fns.invalidateProducts,
  invalidateListings: m.fns.invalidateListings,
  knowsPath: m.fns.knowsPath,
}));
vi.mock('../lib/woo', () => ({
  forgetProduct: m.fns.forgetProduct,
  forgetAllProducts: m.fns.forgetAllProducts,
  productCached: m.fns.productCached,
}));
vi.mock('../lib/storeCatalog', () => ({ forgetAllGrids: m.fns.forgetAllGrids }));
vi.mock('../lib/catalogTerms', () => ({ refreshCatalogTerms: m.fns.refreshCatalogTerms }));

let POST: typeof import('../pages/api/shell-refresh').POST;
beforeEach(async () => {
  // A term reload that the previous test's poke left for "after the answer" runs now, not in the middle of this test.
  await new Promise((r) => setTimeout(r, 0));
  vi.resetModules(); // fresh budgets per test
  m.calls.length = 0;
  m.known.clear();
  m.cached.clear();
  m.terms.count = 0;
  m.terms.changed = false;
  delete process.env.MOS_SHELL_POKE_KEY;
  POST = (await import('../pages/api/shell-refresh')).POST;
});

/** Fifty stored paths under one prefix, so each call is a fresh batch the store knows. */
function known(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const p = `/vara/${prefix}${i}/`;
    m.known.add(p);
    return p;
  });
}

function poke(body: unknown, opts: { addr?: string; key?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.key) headers['x-mos-shell-key'] = opts.key;
  return POST({
    request: new Request('https://new.musikogsport.is/api/shell-refresh', { method: 'POST', headers, body: JSON.stringify(body) }),
    clientAddress: opts.addr ?? '10.0.0.1',
  } as never);
}

describe('POST /api/shell-refresh: the cache is forgotten before anything is marked (review 4)', () => {
  it('forgets the product and grids before the stale mark, the drop, and the bulk marks', async () => {
    process.env.MOS_SHELL_POKE_KEY = 'secret-key';
    m.known.add('/vara/a/');
    m.known.add('/vara/b/');
    const res = await poke({ stale: ['/vara/a/'], drop: ['/vara/b/'], listings: true, products: true }, { key: 'secret-key' });
    expect(res.status).toBe(204);
    const firstAction = m.calls.findIndex((c) => !c.startsWith('forget') && c !== 'grids');
    expect(firstAction).toBe(4);
    expect(m.calls.slice(0, 4).sort()).toEqual(['forget:a', 'forget:b', 'forgetAllProducts', 'grids'].sort());
    expect(m.calls.slice(4)).toEqual(['stale:/vara/a/', 'drop:/vara/b/', 'products', 'listings']);
  });
});

describe('POST /api/shell-refresh: without the key (review 5, 9)', () => {
  it('serves a WordPress bulk edit from its one address: no per-request cut at 30', async () => {
    for (let i = 0; i < 40; i++) {
      m.known.add(`/vara/p${i}/`);
      const res = await poke({ stale: [`/vara/p${i}/`] }, { addr: '10.0.0.9' });
      expect(res.status, `save ${i}`).toBe(204);
    }
    expect(m.calls.filter((c) => c.startsWith('stale:'))).toHaveLength(40);
  });

  it('acts only on paths the store knows: an unknown path is not marked or dropped', async () => {
    m.known.add('/vara/known/');
    const res = await poke({ stale: ['/vara/known/', '/vara/junk/'], drop: ['/vara/junk2/'] });
    expect(res.status).toBe(204);
    expect(m.calls.filter((c) => c.startsWith('stale') || c.startsWith('drop'))).toEqual(['stale:/vara/known/']);
  });

  it('a stranger cannot drop more than his address share of path actions a minute', async () => {
    const paths = Array.from({ length: 50 }, (_, i) => `/vara/d${i}/`);
    paths.forEach((p) => m.known.add(p));
    const statuses: number[] = [];
    for (let round = 0; round < 7; round++) statuses.push((await poke({ drop: paths }, { addr: '203.0.113.7' })).status);
    expect(statuses.slice(0, 6)).toEqual([204, 204, 204, 204, 204, 204]);
    expect(statuses[6]).toBe(429);
    expect(m.calls.filter((c) => c.startsWith('drop:'))).toHaveLength(300);
  });

  // One address is held to its own 300 a minute while the shared pool still has room, and its share does not cost another
  // address anything. A regression to the shared pool alone (600, no per-address share) lets the seventh round through,
  // which this test catches; the earlier version passed under that regression because two addresses fill 600 anyway.
  it('an address is held to its own share, and that does not cost another address its share', async () => {
    const a = known('e', 50);
    for (let round = 0; round < 6; round++) expect((await poke({ drop: a }, { addr: '203.0.113.8' })).status, `a round ${round}`).toBe(204);
    expect((await poke({ drop: known('e7-', 50) }, { addr: '203.0.113.8' })).status, 'a seventh round').toBe(429);
    const b = known('f', 50);
    for (let round = 0; round < 6; round++) expect((await poke({ drop: b }, { addr: '203.0.113.9' })).status, `b round ${round}`).toBe(204);
    expect(m.calls.filter((c) => c.startsWith('drop:'))).toHaveLength(600);
  });

  // Finding 26: a path the store does not hold costs its address's share but nothing of the shared pool, so strangers
  // flooding junk cannot starve a real poke. (Known paths from several addresses can still share the pool; only the key
  // closes that, and production sets it.)
  it('junk paths spend no shared budget: two strangers flooding unknown paths cannot starve a real poke', async () => {
    for (const addr of ['203.0.113.60', '203.0.113.61']) {
      for (let round = 0; round < 6; round++) {
        const junk = Array.from({ length: 50 }, (_, i) => `/vara/junk${round}-${i}/`);
        expect((await poke({ stale: junk }, { addr })).status, `${addr} round ${round}`).toBe(204);
      }
    }
    const real = known('real', 50);
    expect((await poke({ drop: real }, { addr: '203.0.113.62' })).status).toBe(204);
    expect(m.calls.filter((c) => c.startsWith('drop:'))).toHaveLength(50);
  });

  // Finding 27: paths the budget cut are answered with 429 and their list, so the sender can resend exactly those; the
  // paths that fit are applied.
  it('answers 429 with the paths it did not apply, and applies the rest', async () => {
    for (let r = 0; r < 5; r++) expect((await poke({ stale: known(`w${r}-`, 50) }, { addr: '203.0.113.70' })).status).toBe(204);
    const stale = known('s', 50);
    const drop = known('d', 50);
    const res = await poke({ stale, drop }, { addr: '203.0.113.70' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect((await res.json()).untaken).toEqual(drop);
    expect(m.calls).toContain(`stale:${stale.join(',')}`);
    expect(m.calls.some((c) => c.startsWith('drop:'))).toBe(false);
  });

  // Finding 28: the cached product is forgotten only for a path the store holds, and before its mark.
  it('forgets the cached product only for a path the store knows, and before the mark', async () => {
    m.known.add('/vara/known/');
    expect((await poke({ stale: ['/vara/known/', '/vara/junk/'], drop: ['/vara/junk2/'] })).status).toBe(204);
    expect(m.calls.filter((c) => c.startsWith('forget:'))).toEqual(['forget:known']);
    expect(m.calls.indexOf('forget:known')).toBeLessThan(m.calls.indexOf('stale:/vara/known/'));
  });

  // Finding 29: a listings-only poke the budget refuses must not use up the five-minute window. Time is faked (Date only)
  // and the module is re-imported, because the limiters read Date.now when they are created. (Confirmed 2 changed the
  // other case: a listings mark on a poke whose paths are refused is applied, see the test below.)
  it('a listings mark refused for lack of budget does not use up the five-minute window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
      vi.resetModules();
      POST = (await import('../pages/api/shell-refresh')).POST;
      for (let r = 0; r < 6; r++) await poke({ drop: known(`y${r}-`, 50) }, { addr: '203.0.113.82' });
      expect((await poke({ listings: true }, { addr: '203.0.113.82' })).status).toBe(429);
      expect(m.calls).not.toContain('listings');
      expect((await poke({ listings: true }, { addr: '203.0.113.83' })).status).toBe(204);
      expect(m.calls.filter((c) => c === 'listings')).toHaveLength(1);
      vi.setSystemTime(Date.now() + 60_000); // still inside the five minutes: a second mark is refused as before
      await poke({ listings: true }, { addr: '203.0.113.84' });
      expect(m.calls.filter((c) => c === 'listings')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Confirmed 2: a listings mark is applied when the budget refuses every path of the same poke. Before, the early 429
  // return came first, so the mark was lost and the sender's resend (paths only) never carried it.
  it('applies a listings mark even when the budget refuses every path of the same poke', async () => {
    for (const addr of ['203.0.113.90', '203.0.113.91']) {
      for (let r = 0; r < 6; r++) await poke({ drop: known(`q${addr.slice(-2)}r${r}-`, 50) }, { addr });
    }
    const late = known('late', 2);
    const res = await poke({ stale: late, listings: true }, { addr: '203.0.113.92' });
    expect(res.status).toBe(429);
    expect((await res.json()).untaken).toEqual(late);
    expect(m.calls).toContain('listings');
    expect(m.calls.some((c) => c.startsWith('stale:'))).toBe(false);
  });

  // Confirmed 4 and 8: a path the store does not hold, whose product is cached, forgets that product (a cached product
  // read before a save would otherwise be stored for 24 h). Junk slugs are never cached, so they still cost nothing.
  it('forgets the cached product of an unknown path, and marks nothing for it', async () => {
    m.cached.add('cachedonly');
    expect((await poke({ stale: ['/vara/cachedonly/'] })).status).toBe(204);
    expect(m.calls).toEqual(['forget:cachedonly']);
  });

  it('an unknown path whose product is not cached is forgotten and marked for nothing', async () => {
    expect((await poke({ stale: ['/vara/nowhere/'] })).status).toBe(204);
    expect(m.calls).toEqual([]);
  });

  it('a request with no paths still costs one action, so an empty flood is bounded too', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) statuses.push((await poke({}, { addr: '203.0.113.20' })).status);
    expect(statuses.slice(0, 300).every((s) => s === 204)).toBe(true);
    expect(statuses[300]).toBe(429);
  });

  it('still refuses the every-product mark without the key', async () => {
    await poke({ products: true });
    expect(m.calls).not.toContain('products');
  });
});

describe('POST /api/shell-refresh: with the key, nothing changes (keyed pin)', () => {
  it('forgets and marks a path the store does not hold, with no budget applied', async () => {
    process.env.MOS_SHELL_POKE_KEY = 'secret-key';
    const res = await poke({ stale: ['/vara/unknown/'] }, { key: 'secret-key' });
    expect(res.status).toBe(204);
    expect(m.calls).toEqual(['forget:unknown', 'stale:/vara/unknown/']);
  });
});

// The term lists (categories, brands, teams, sizes) are reloaded when WordPress says a product changed, so a new team or
// brand becomes an option in the filter without waiting out the lists' ten minutes. Only a poke that is applied does it;
// at most once per 30 seconds per process, with the last save of a burst still read; and when the options did change,
// the listings are marked once more, since pages rendered meanwhile were built from the old lists.
describe('POST /api/shell-refresh: the term lists are reloaded (sibling of the listings mark)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    vi.resetModules(); // the limiters read Date.now when created: re-import under the fake clock
    POST = (await import('../pages/api/shell-refresh')).POST;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.MOS_SHELL_POKE_KEY;
  });
  const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  it('an applied poke reloads the term lists, after the answer has gone', async () => {
    m.known.add('/vara/a/');
    expect((await poke({ stale: ['/vara/a/'] }, { addr: '198.51.100.1' })).status).toBe(204);
    expect(m.terms.count).toBe(0);
    await settle();
    expect(m.terms.count).toBe(1);
  });

  it('a burst of pokes is one reload now and one at the end of the 30 seconds, which reads the last save too', async () => {
    for (let i = 0; i < 20; i++) expect((await poke({ listings: true }, { addr: `198.51.100.${10 + i}` })).status).toBe(204);
    await settle();
    expect(m.terms.count).toBe(1);
    await settle(10_000);
    expect((await poke({ listings: true }, { addr: '198.51.100.40' })).status).toBe(204); // a save 10 s after the reload
    await settle(19_000);
    expect(m.terms.count).toBe(1); // not yet: 29 s
    await settle(1_000);
    expect(m.terms.count).toBe(2); // at 30 s, with no further poke
    await settle(60_000);
    expect(m.terms.count).toBe(2); // and nothing more until another save
  });

  it('a clock that steps back does not hold the next reload longer than the 30 seconds', async () => {
    expect((await poke({ listings: true }, { addr: '198.51.100.50' })).status).toBe(204);
    await settle();
    expect(m.terms.count).toBe(1);
    vi.setSystemTime(Date.now() - 6 * 60 * 60_000); // the system clock is corrected six hours back
    expect((await poke({ listings: true }, { addr: '198.51.100.51' })).status).toBe(204);
    await settle(30_000);
    expect(m.terms.count).toBe(2);
  });

  it('changed options mark the listings once more; unchanged ones do not', async () => {
    process.env.MOS_SHELL_POKE_KEY = 'secret-key';
    m.terms.changed = true;
    expect((await poke({ stale: ['/vara/a/'] }, { key: 'secret-key' })).status).toBe(204);
    expect(m.calls).not.toContain('listings');
    await settle();
    expect(m.calls.filter((c) => c === 'listings')).toHaveLength(1);
    m.terms.changed = false;
    await settle(30_000);
    expect((await poke({ stale: ['/vara/a/'] }, { key: 'secret-key' })).status).toBe(204);
    await settle();
    expect(m.terms.count).toBe(2);
    expect(m.calls.filter((c) => c === 'listings')).toHaveLength(1);
  });

  it('an unauthorised poke does not reload them', async () => {
    process.env.MOS_SHELL_POKE_KEY = 'secret-key';
    expect((await poke({ products: true }, { key: 'wrong-key' })).status).toBe(403);
    await settle(60_000);
    expect(m.terms.count).toBe(0);
  });

  it('an invalid poke does not reload them', async () => {
    expect((await poke({ stale: 'not-a-list' }, { addr: '198.51.100.3' })).status).toBe(400);
    await settle(60_000);
    expect(m.terms.count).toBe(0);
  });

  it('a poke that names nothing (no path, no listings) does not reload them', async () => {
    expect((await poke({}, { addr: '198.51.100.7' })).status).toBe(204);
    await settle(60_000);
    expect(m.terms.count).toBe(0);
  });

  it('a poke the budget refuses whole (nothing applied) does not reload them', async () => {
    for (let r = 0; r < 6; r++) await poke({ drop: known(`t${r}-`, 50) }, { addr: '198.51.100.4' });
    await settle(31_000); // past the 30 s terms window, still inside the address's minute
    const before = m.terms.count;
    const res = await poke({ drop: known('late-', 2) }, { addr: '198.51.100.4' });
    expect(res.status).toBe(429);
    await settle(31_000);
    expect(m.terms.count).toBe(before);
  });

  it('a poke whose listings mark the five-minute window refuses still reloads them', async () => {
    expect((await poke({ listings: true }, { addr: '198.51.100.5' })).status).toBe(204);
    await settle(60_000); // inside the five minutes: the next listings mark is refused
    expect((await poke({ listings: true }, { addr: '198.51.100.6' })).status).toBe(204);
    await settle();
    expect(m.calls.filter((c) => c === 'listings')).toHaveLength(1);
    expect(m.terms.count).toBe(2);
  });
});
