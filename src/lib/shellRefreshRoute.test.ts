// POST /api/shell-refresh (review 4, 5, 9): the cached product goes before any mark, the unkeyed route acts only on
// paths the store knows, and its budget counts path actions (a WordPress bulk edit is served, a stranger is not).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));

const m = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    known: new Set<string>(),
    fns: {
      invalidatePaths: async (ps: string[]) => void calls.push(`stale:${ps.join(',')}`),
      dropPage: async (p: string) => void calls.push(`drop:${p}`),
      invalidateProducts: async () => void calls.push('products'),
      invalidateListings: async () => void calls.push('listings'),
      knowsPath: async (p: string) => m.known.has(p),
      forgetProduct: (slug: string) => void calls.push(`forget:${slug}`),
      forgetAllProducts: () => void calls.push('forgetAllProducts'),
      forgetAllGrids: () => void calls.push('grids'),
    },
  };
});

vi.mock('../lib/shellRuntime', () => ({
  invalidatePaths: m.fns.invalidatePaths,
  dropPage: m.fns.dropPage,
  invalidateProducts: m.fns.invalidateProducts,
  invalidateListings: m.fns.invalidateListings,
  knowsPath: m.fns.knowsPath,
}));
vi.mock('../lib/woo', () => ({ forgetProduct: m.fns.forgetProduct, forgetAllProducts: m.fns.forgetAllProducts }));
vi.mock('../lib/storeCatalog', () => ({ forgetAllGrids: m.fns.forgetAllGrids }));

let POST: typeof import('../pages/api/shell-refresh').POST;
beforeEach(async () => {
  vi.resetModules(); // fresh budgets per test
  m.calls.length = 0;
  m.known.clear();
  delete process.env.MOS_SHELL_POKE_KEY;
  POST = (await import('../pages/api/shell-refresh')).POST;
});

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

  it('another address has its own share', async () => {
    const paths = Array.from({ length: 50 }, (_, i) => `/vara/e${i}/`);
    paths.forEach((p) => m.known.add(p));
    for (let round = 0; round < 6; round++) await poke({ drop: paths }, { addr: '203.0.113.8' });
    expect((await poke({ drop: paths }, { addr: '203.0.113.9' })).status).toBe(204);
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
