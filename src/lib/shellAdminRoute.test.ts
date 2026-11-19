// /api/shell-admin (src/pages/api/shell-admin.ts): the key gate (no key set means 403 for everything), the status, the
// four actions and their refusals, the body cap, and the limit. The store and the walk are mocked: nothing is run.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0 }));

const m = vi.hoisted(() => ({
  enabled: true,
  running: false,
  base: 'https://storefront.test' as string | null,
  stopOk: true,
  refreshOk: true,
  storeOk: true,
  clearBusy: false,
  removed: 3 as number | null,
  calls: [] as string[],
}));

vi.mock('../lib/shellRuntime', () => ({ shellEnabled: () => m.enabled }));
vi.mock('../lib/nightlyRebuildRuntime', () => ({
  nightlyRunning: () => m.running,
  rebuildBase: () => ({ origin: m.base, problem: null }),
  runNightlyRebuild: async (origin: string) => void m.calls.push(`run:${origin}`),
  stopNightlyRebuild: () => {
    m.calls.push('stop');
    return m.stopOk;
  },
}));
vi.mock('../lib/shellAdminRuntime', () => ({
  shellAdminStatus: async () => ({ ok: true, at: 1 }),
  refreshShellPath: async (p: string) => {
    m.calls.push(`refresh:${p}`);
    return m.refreshOk;
  },
  clearShellPages: async () => {
    if (m.clearBusy) return 'running';
    m.calls.push('clear');
    return m.removed;
  },
  storeOpens: async () => m.storeOk,
}));

const KEY = 'test-key-not-real';
let GET: typeof import('../pages/api/shell-admin').GET;
let POST: typeof import('../pages/api/shell-admin').POST;

beforeEach(async () => {
  vi.resetModules(); // a fresh rate limit per test
  m.enabled = true;
  m.running = false;
  m.base = 'https://storefront.test';
  m.stopOk = true;
  m.refreshOk = true;
  m.storeOk = true;
  m.clearBusy = false;
  m.removed = 3;
  m.calls.length = 0;
  process.env.MOS_SHELL_POKE_KEY = KEY;
  const mod = await import('../pages/api/shell-admin');
  GET = mod.GET;
  POST = mod.POST;
});

const get = (headers: Record<string, string> = {}) =>
  GET({ request: new Request('http://x.test/api/shell-admin', { headers }) } as never) as Promise<Response>;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST({
    request: new Request('http://x.test/api/shell-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mos-Shell-Key': KEY, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
const keyed = { 'X-Mos-Shell-Key': KEY };

describe('the key gate', () => {
  it('answers 403 to everything when MOS_SHELL_POKE_KEY is not set, even with a header', async () => {
    delete process.env.MOS_SHELL_POKE_KEY;
    expect((await get(keyed)).status).toBe(403);
    expect((await post({ action: 'stop' }, keyed)).status).toBe(403);
    expect(m.calls).toEqual([]);
  });

  it('answers 403 without the key or with another one, and 200 with it, no-store', async () => {
    expect((await get()).status).toBe(403);
    expect((await get({ 'X-Mos-Shell-Key': 'nope' })).status).toBe(403);
    const ok = await get(keyed);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(await ok.json()).toEqual({ ok: true, at: 1 });
    expect((await post({ action: 'stop' }, { 'X-Mos-Shell-Key': 'nope' })).status).toBe(403);
  });
});

describe('POST actions', () => {
  it('refuses a body that is not an action, and one over the cap', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post({ action: 'delete' })).status).toBe(400);
    expect((await post({ action: 'refresh', path: '/karfa/' })).status).toBe(400);
    expect((await post('{"action":"stop","pad":"' + 'x'.repeat(17_000) + '"}')).status).toBe(413);
    expect(m.calls).toEqual([]);
  });

  it('run: starts the walk on the base and answers 202; refused with no base, no store, or a run going', async () => {
    const started = await post({ action: 'run' });
    expect(started.status).toBe(202);
    expect(m.calls).toEqual(['run:https://storefront.test']);

    m.base = null;
    const nobase = await post({ action: 'run' });
    expect(nobase.status).toBe(409);
    expect((await nobase.json()).error).toBe('no-base');

    m.base = 'https://storefront.test';
    m.enabled = false;
    expect((await post({ action: 'run' })).status).toBe(409);

    m.enabled = true;
    m.running = true;
    const busy = await post({ action: 'run' });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toBe('running');
    expect(m.calls).toEqual(['run:https://storefront.test']);
  });

  it('run: a store that does not open answers 409 at once, and nothing is started', async () => {
    m.storeOk = false;
    const r = await post({ action: 'run' });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('store-off');
    expect(m.calls).toEqual([]);
  });

  it('stop: 202 while a run goes, 409 when none does', async () => {
    expect((await post({ action: 'stop' })).status).toBe(202);
    m.stopOk = false;
    const none = await post({ action: 'stop' });
    expect(none.status).toBe(409);
    expect((await none.json()).error).toBe('not-running');
  });

  it('refresh: one path of the storefront (a URL is WordPress\'s to turn into one, so refused here), marked; 409 when the store is off', async () => {
    expect((await post({ action: 'refresh', path: 'https://storefront.test/vara/treyja-1/' })).status).toBe(400);
    const ok = await post({ action: 'refresh', path: '/vara/treyja-1/' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, path: '/vara/treyja-1/' });
    expect(m.calls).toEqual(['refresh:/vara/treyja-1/']);
    m.refreshOk = false;
    expect((await post({ action: 'refresh', path: '/vara/a/' })).status).toBe(409);
  });

  it('clear: the count of removed pages; refused while a run goes or the store is off', async () => {
    const ok = await post({ action: 'clear' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, removed: 3 });
    m.clearBusy = true;
    const busy = await post({ action: 'clear' });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toBe('running');
    expect(m.calls).toEqual(['clear']);
    m.clearBusy = false;
    m.removed = null;
    expect((await post({ action: 'clear' })).status).toBe(409);
  });

  it('is limited per process: the 121st keyed request in a minute is 429', async () => {
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await get(keyed)).status;
    expect(last).toBe(429);
  });
});
