// The nightly rebuild's run: the order of its steps (the store is there, the stamp is written at the start and at the
// end, the sitemap is read, then each path is invalidated just before it is walked), and no two runs at once. The
// requests and the store are replaced; nothing here touches the network.
import { describe, expect, it } from 'vitest';
import { PROBE_TIMEOUT_MS, runNightlyRebuild, type RunIo } from './nightlyRebuildRuntime';
import { WALK_DEFAULTS } from './nightlyRebuild';

function fakeRunIo(order: string[]): Partial<RunIo> {
  let t = 0;
  return {
    now: () => (t += 1),
    sleep: async () => undefined,
    storeReady: async () => true,
    invalidatePath: async (path) => void order.push(`invalidate ${path}`),
    writeStamp: async (s) => void order.push(s.lastEnd === null ? 'stamp start' : 'stamp end'),
    fetchSitemap: async () => {
      order.push('sitemap');
      return '<urlset><url><loc>https://new.musikogsport.is/vara/a/</loc></url></urlset>';
    },
    probe: async (origin, path) => {
      order.push(`get ${origin}${path}`);
      return { status: 200, shell: 'hit', refreshing: false };
    },
  };
}

describe('runNightlyRebuild', () => {
  it('checks the store, stamps the start, reads the sitemap, invalidates each path just before its walk, then stamps the end', async () => {
    const order: string[] = [];
    const tally = await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0 }, fakeRunIo(order));
    expect(order).toEqual([
      'stamp start',
      'sitemap',
      'invalidate /vara/a/',
      'get http://127.0.0.1:10026/vara/a/',
      'stamp end',
    ]);
    expect(tally).toMatchObject({ visited: 1, hits: 1, failures: 0, stoppedEarly: false });
  });

  it('refuses to start while a run is in progress', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = fakeRunIo(order);
    const first = runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0 }, { ...slow, storeReady: () => gate.then(() => true) });
    const second = await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0 }, slow);
    expect(second).toBeNull();
    release();
    expect(await first).not.toBeNull();
  });

  it('stops with null, without reading the sitemap, when the store is not there', async () => {
    const order: string[] = [];
    const tally = await runNightlyRebuild('http://127.0.0.1:10026', {}, { ...fakeRunIo(order), storeReady: async () => false });
    expect(tally).toBeNull();
    expect(order).not.toContain('sitemap');
    expect(order.some((s) => s.startsWith('invalidate'))).toBe(false);
  });

  it('stamps the end even when the walk stops on an error, so the next start can tell the run did not finish', async () => {
    const order: string[] = [];
    const tally = await runNightlyRebuild('http://127.0.0.1:10026', {}, { ...fakeRunIo(order), fetchSitemap: async () => { throw new Error('down'); } });
    expect(tally).toBeNull();
    expect(order.at(-1)).toBe('stamp end');
  });
});

describe('the probe', () => {
  it('gives up no later than the walk waits for one page, so a hung render cannot hold the run for minutes', () => {
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(WALK_DEFAULTS.maxWaitMs);
  });
});
