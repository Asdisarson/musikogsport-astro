// The admin endpoint's body and status: which actions are accepted, the path rule for "refresh", the status's shape
// (the contract the WordPress page reads), and the disk-count cache (once a minute, one load in flight).
import { describe, expect, it } from 'vitest';
import { buildShellAdminStatus, createTtlCache, parseShellAdminAction, type ShellAdminInput } from './shellAdmin';

describe('parseShellAdminAction', () => {
  it('takes the four actions, and refresh needs a product or category path', () => {
    expect(parseShellAdminAction({ action: 'run' })).toEqual({ action: 'run' });
    expect(parseShellAdminAction({ action: 'stop' })).toEqual({ action: 'stop' });
    expect(parseShellAdminAction({ action: 'clear' })).toEqual({ action: 'clear' });
    expect(parseShellAdminAction({ action: 'refresh', path: '/vara/treyja-1/' })).toEqual({ action: 'refresh', path: '/vara/treyja-1/' });
    expect(parseShellAdminAction({ action: 'refresh', path: '/verslun/skor/íþrótta-skór/' })).toEqual({ action: 'refresh', path: '/verslun/skor/íþrótta-skór/' });
  });

  it('refuses anything else', () => {
    expect(parseShellAdminAction(null)).toBeNull();
    expect(parseShellAdminAction([])).toBeNull();
    expect(parseShellAdminAction({ action: 'delete' })).toBeNull();
    expect(parseShellAdminAction({})).toBeNull();
    expect(parseShellAdminAction({ action: 'refresh' })).toBeNull();
    expect(parseShellAdminAction({ action: 'refresh', path: '/karfa/' })).toBeNull();
    expect(parseShellAdminAction({ action: 'refresh', path: 'https://musikogsport.is/vara/a/' })).toBeNull();
    expect(parseShellAdminAction({ action: 'refresh', path: '/vara/../karfa/' })).toBeNull();
    expect(parseShellAdminAction({ action: 'refresh', path: '/vara/' + 'a'.repeat(250) + '/' })).toBeNull();
    expect(parseShellAdminAction({ action: 'refresh', path: 42 })).toBeNull();
  });
});

const input = (over: Partial<ShellAdminInput> = {}): ShellAdminInput => ({
  now: 1_000_000,
  store: {
    on: true,
    build: 'abcdef0123456789',
    folder: 'temp',
    pagesInMemory: 3,
    disk: { files: 40, bytes: 2_000_000, at: 999_000 },
    fresh: { productMs: 86_400_000, contentMs: 86_400_000, listingMs: 300_000, filteredMs: 120_000, hardMaxMs: 604_800_000, overrideMs: null },
  },
  scheduler: { why: null, at: '05:00', hasBase: true, nextRunAt: 2_000_000, lastStart: 900_000, lastEnd: 905_000, unfinishedStart: null },
  run: { running: false, clearing: false, startedAt: null, total: null, visited: 0, hits: 0, rendered: 0, gone: 0, failures: 0, pauseMs: null, lastPath: null, stopRequested: false, workers: null, concurrency: null },
  settings: {
    effective: { enabled: true, at: '05:00', concurrency: 2, pauseMs: 100, catchUp: true },
    source: { enabled: 'env/default', at: 'env/default', concurrency: 'env/default', pauseMs: 'env/default', catchUp: 'env/default' },
    saved: null,
  },
  runs: [],
  failures: [],
  ...over,
});

describe('buildShellAdminStatus', () => {
  it('shows a clear as clearing and never as a running walk', () => {
    const s = buildShellAdminStatus(input({ run: { ...input().run, clearing: true } }));
    expect(s.run).toMatchObject({ running: false, clearing: true });
  });

  it('shows the start of an interrupted run, which has no end on record', () => {
    const s = buildShellAdminStatus(input({ scheduler: { ...input().scheduler, lastStart: 950_000, lastEnd: null, unfinishedStart: 950_000 } }));
    expect(s.scheduler).toMatchObject({ lastStart: 950_000, lastEnd: null, unfinishedStart: 950_000 });
  });

  it('has the fields the page reads, with a short build id and the folder kind only', () => {
    const s = buildShellAdminStatus(input());
    expect(s).toEqual({
      ok: true,
      at: 1_000_000,
      store: {
        on: true,
        build: 'abcdef01',
        folder: 'temp',
        pagesInMemory: 3,
        pagesOnDisk: 40,
        diskBytes: 2_000_000,
        diskAt: 999_000,
        fresh: { productMs: 86_400_000, contentMs: 86_400_000, listingMs: 300_000, filteredMs: 120_000, hardMaxMs: 604_800_000, overrideMs: null },
      },
      scheduler: { armed: true, why: null, at: '05:00', hasBase: true, nextRunAt: 2_000_000, lastStart: 900_000, lastEnd: 905_000, unfinishedStart: null },
      run: { running: false, clearing: false, startedAt: null, total: null, visited: 0, hits: 0, rendered: 0, gone: 0, failures: 0, pauseMs: null, lastPath: null, stopRequested: false, workers: null, concurrency: null },
      settings: {
        effective: { enabled: true, at: '05:00', concurrency: 2, pauseMs: 100, catchUp: true },
        source: { enabled: 'env/default', at: 'env/default', concurrency: 'env/default', pauseMs: 'env/default', catchUp: 'env/default' },
        saved: null,
        estimateMs: null,
      },
      lastRun: null,
      recentRuns: [],
      failures: [],
    });
  });

  it('a store that is off shows no build, no disk and no folder; the scheduler says why it is not armed', () => {
    const s = buildShellAdminStatus(
      input({
        store: { on: false, build: null, folder: null, pagesInMemory: 0, disk: null, fresh: input().store.fresh },
        scheduler: { why: 'store-off', at: '05:00', hasBase: true, nextRunAt: null, lastStart: null, lastEnd: null, unfinishedStart: null },
      }),
    );
    expect(s.store).toMatchObject({ on: false, build: null, folder: null, pagesOnDisk: null, diskBytes: null, diskAt: null });
    expect(s.scheduler).toMatchObject({ armed: false, why: 'store-off', nextRunAt: null });
  });

  it('carries the last run and the failures as they are given (newest first is the caller\'s order)', () => {
    const s = buildShellAdminStatus(
      input({
        runs: [
          { startedAt: 1, endedAt: 4001, durationMs: 4000, total: 10, visited: 5, hits: 2, rendered: 2, gone: 1, failures: 1, stoppedEarly: true, stoppedWhy: 'failures', concurrency: 2 },
        ],
        settings: {
          ...input().settings,
          effective: { enabled: true, at: '05:00', concurrency: 4, pauseMs: 100, catchUp: true },
        },
        failures: [{ path: '/vara/a/', status: 500, at: 7 }],
      }),
    );
    expect(s.lastRun).toMatchObject({ durationMs: 4000, visited: 5, stoppedWhy: 'failures', msPerPage: 800, pagesPerMinute: 75, concurrency: 2 });
    expect(s.recentRuns).toHaveLength(1);
    // 10 pages at 800 ms each, measured at 2 workers, estimated at 4 workers: 10 * 800 * 2 / 4 = 4000 ms.
    expect(s.settings.estimateMs).toBe(4000);
    expect(s.failures).toEqual([{ path: '/vara/a/', status: 500, at: 7 }]);
  });

  it('serialises to JSON without the store path or the key', () => {
    const text = JSON.stringify(buildShellAdminStatus(input()));
    expect(text).not.toMatch(/\/Users\//);
    expect(text).not.toMatch(/tmp/);
  });
});

describe('createTtlCache', () => {
  it('loads once per ttl, shares one load in flight, and keeps the old value when a load fails', async () => {
    let t = 0;
    let loads = 0;
    let fail = false;
    const cache = createTtlCache(async () => {
      loads += 1;
      if (fail) throw new Error('disk');
      return { n: loads };
    }, 60_000, () => t);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(loads).toBe(1);
    expect(a?.value).toEqual({ n: 1 });
    expect(b?.value).toEqual({ n: 1 });
    t = 59_999;
    expect((await cache.get())?.value).toEqual({ n: 1 });
    expect(loads).toBe(1);
    t = 60_000;
    fail = true;
    expect((await cache.get())?.value).toEqual({ n: 1 });
    expect(loads).toBe(2);
    cache.invalidate();
    fail = false;
    expect((await cache.get())?.value).toEqual({ n: 3 });
  });

  it('answers null when no load has ever succeeded', async () => {
    const cache = createTtlCache(async () => {
      throw new Error('off');
    }, 60_000);
    expect(await cache.get()).toBeNull();
  });
});

describe('createTtlCache and an invalidate during a load', () => {
  it('a load that was in flight at invalidate does not write its old value back; the next get loads again', async () => {
    const pending: ((n: number) => void)[] = [];
    const cache = createTtlCache(() => new Promise<number>((r) => pending.push(r)), 60_000, () => 0);
    const first = cache.get();
    cache.invalidate();
    pending[0](7);
    await first;
    const second = cache.get();
    expect(pending.length).toBe(2);
    pending[1](9);
    expect(await second).toMatchObject({ value: 9 });
  });
});
