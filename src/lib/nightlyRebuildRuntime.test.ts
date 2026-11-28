// The nightly rebuild's run: the order of its steps (the store is there, the stamp is written at the start and at the
// end, the sitemap is read, then each path is invalidated just before it is walked), and no two runs at once. The
// requests and the store are replaced; nothing here touches the network.
import { describe, expect, it } from 'vitest';
import { PROBE_TIMEOUT_MS, applyNightlySettings, nightlySettingsView, resetNightlyForTests, runNightlyRebuild, type RunIo, type SettingsIo } from './nightlyRebuildRuntime';
import { resetRunStateForTests, runView } from './nightlyRebuildState';
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

function memSettings(): SettingsIo {
  let data: unknown = null;
  return {
    read: async () => data,
    write: async (d) => {
      data = d;
    },
  };
}

/** A walk over one page whose answer carries a body; records what the probe was asked to keep and what the photo
 *  step was asked to warm. */
function photoIo(photoResult = { converted: 2, kept: 1, failed: 0 }) {
  const keep: boolean[] = [];
  const warmed: string[] = [];
  const io: Partial<RunIo> = {
    now: () => Date.now(),
    sleep: async () => undefined,
    storeReady: async () => true,
    invalidatePath: async () => undefined,
    writeStamp: async () => undefined,
    fetchSitemap: async () => '<urlset><url><loc>https://new.musikogsport.is/vara/a/</loc></url></urlset>',
    probe: async (_origin, _path, keepBody) => {
      keep.push(keepBody);
      return { status: 200, shell: 'hit', refreshing: false, html: keepBody ? '<img src="/img/360/webp/v2/2026/04/a.jpg">' : null };
    },
    warmPhotos: async (html) => {
      warmed.push(html);
      return photoResult;
    },
    photosBlocked: async () => false,
    settings: memSettings(),
  };
  return { io, keep, warmed };
}

describe('photos in a run', () => {
  it('keeps the body of an answer only when the run does photos', async () => {
    resetNightlyForTests();
    resetRunStateForTests();
    const off = photoIo();
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0, photos: false }, off.io);
    expect(off.keep).toEqual([false]);
    expect(off.warmed).toEqual([]);

    const on = photoIo();
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0, photos: true }, on.io);
    expect(on.keep).toEqual([true]);
    expect(on.warmed).toHaveLength(1);
  });

  it('the per-run flag wins over the saved setting, and the saved setting applies when the run does not say', async () => {
    resetNightlyForTests();
    resetRunStateForTests();
    const shared = memSettings();
    await applyNightlySettings({ photos: true }, shared);

    const overridden = photoIo();
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0, photos: false }, { ...overridden.io, settings: shared });
    expect(overridden.warmed).toEqual([]);

    const saved = photoIo();
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0 }, { ...saved.io, settings: shared });
    expect(saved.warmed).toHaveLength(1);
  });

  it('makes no photos, and the run says so, when the photo folder is the page store folder or inside it', async () => {
    resetNightlyForTests();
    resetRunStateForTests();
    const { io, keep, warmed } = photoIo();
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0, photos: true }, { ...io, photosBlocked: async () => true });
    expect(warmed).toEqual([]);
    expect(keep).toEqual([false]);
    expect(runView()).toMatchObject({ photos: false, photosConverted: 0, photosKept: 0, photosFailed: 0 });
  });

  it('the counts flow into the run view and the finished run record; a run without photos records none', async () => {
    resetNightlyForTests();
    resetRunStateForTests();
    const { io } = photoIo({ converted: 2, kept: 1, failed: 0 });
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0, photos: true }, io);
    // once the run has ended the view is idle again; its counts are in the finished run's record
    expect(runView()).toMatchObject({ running: false, photos: false, photosConverted: 0, photosKept: 0, photosFailed: 0 });
    const last = (await nightlySettingsView()).runs[0];
    expect(last).toMatchObject({ photos: true, photosConverted: 2, photosKept: 1, photosFailed: 0 });

    resetNightlyForTests();
    resetRunStateForTests();
    const plain = photoIo();
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 0, photos: false }, plain.io);
    expect(runView()).toMatchObject({ photos: false, photosConverted: 0, photosKept: 0, photosFailed: 0 });
  });

  it('a finished run records the base pause it walked with, its own when it has one', async () => {
    resetNightlyForTests();
    resetRunStateForTests();
    await runNightlyRebuild('http://127.0.0.1:10026', { delayMs: 250 }, photoIo().io);
    expect((await nightlySettingsView()).runs[0]).toMatchObject({ pauseMs: 250 });
  });
});

