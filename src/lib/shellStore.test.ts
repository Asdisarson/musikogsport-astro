import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createShellStore, type ShellEntry } from './shellStore';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mos-shell-test-'));
});
afterEach(async () => {
  // a test may end with a disk write still in flight: give it a moment before the directory goes
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const NOW = 10_000_000_000;
const base = (over: Partial<ShellEntry> = {}): ShellEntry => ({
  key: 'b1|/vara/x/',
  path: '/vara/x/',
  tier: 'product',
  at: NOW,
  freshMs: 24 * 3600_000,
  status: 200,
  headers: [['Content-Type', 'text/html; charset=utf-8']],
  body: '<html>x</html>',
  memoryOnly: false,
  ...over,
});

describe('shellStore', () => {
  it('returns what was put, from memory, and from disk in a new process', async () => {
    const a = createShellStore({ dir, build: 'b1', now: () => NOW });
    await a.put(base());
    expect((await a.get('b1|/vara/x/', NOW))?.entry.body).toBe('<html>x</html>');
    await a.flush();
    const b = createShellStore({ dir, build: 'b1', now: () => NOW });
    const hit = await b.get('b1|/vara/x/', NOW);
    expect(hit?.state).toBe('fresh');
    expect(hit?.entry.headers).toEqual([['Content-Type', 'text/html; charset=utf-8']]);
  });

  it('never reads or writes another build', async () => {
    const a = createShellStore({ dir, build: 'b1', now: () => NOW });
    await a.put(base());
    await a.flush();
    const b = createShellStore({ dir, build: 'b2', now: () => NOW });
    expect(await b.get('b1|/vara/x/', NOW)).toBeNull();
  });

  it('reports a page past its lifetime as stale, and past the hard age as gone', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.put(base({ tier: 'listing', freshMs: 5 * 60_000, key: 'b1|/', path: '/' }));
    expect((await s.get('b1|/', NOW + 6 * 60_000))?.state).toBe('stale');
    expect(await s.get('b1|/', NOW + 8 * 24 * 3600_000)).toBeNull();
  });

  it('marks paths and listings stale without deleting them', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW + 1000 });
    await s.put(base());
    await s.put(base({ key: 'b1|/', path: '/', tier: 'listing', freshMs: 300_000 }));
    await s.put(base({ key: 'b1|/content/', path: '/hafa-samband/', tier: 'content' }));
    await s.invalidate(['/vara/x/']);
    expect((await s.get('b1|/vara/x/', NOW + 1000))?.state).toBe('stale');
    await s.invalidateListings();
    expect((await s.get('b1|/', NOW + 1000))?.state).toBe('stale');
    expect((await s.get('b1|/content/', NOW + 1000))?.state).toBe('fresh');
  });

  it('drops an entry on remove, from memory and disk', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.put(base());
    await s.flush();
    await s.remove('b1|/vara/x/');
    await s.flush();
    const again = createShellStore({ dir, build: 'b1', now: () => NOW });
    expect(await again.get('b1|/vara/x/', NOW)).toBeNull();
  });

  it('keeps memory-only entries out of the directory', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.put(base({ key: 'b1|/verslun/?litur=a', path: '/verslun/', tier: 'filtered', freshMs: 120_000, memoryOnly: true }));
    await s.flush();
    expect((await s.get('b1|/verslun/?litur=a', NOW))?.state).toBe('fresh');
    const files = await readdir(join(dir, 'b1')).catch(() => [] as string[]);
    expect(files.filter((f) => f.endsWith('.json') && f !== 'invalidated.json')).toEqual([]);
  });

  it('caps the memory-only tier at 500 and evicts the least recently used', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    for (let i = 0; i < 501; i++) {
      await s.put(base({ key: `b1|/verslun/?verd=${i}`, path: '/verslun/', tier: 'filtered', freshMs: 120_000, memoryOnly: true }));
    }
    expect(await s.get('b1|/verslun/?verd=0', NOW)).toBeNull();
    expect(await s.get('b1|/verslun/?verd=500', NOW)).not.toBeNull();
  });

  it('prunes the oldest disk entries past the cap', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW, maxDisk: 3 });
    for (let i = 0; i < 5; i++) await s.put(base({ key: `b1|/vara/${i}/`, path: `/vara/${i}/` }));
    await s.flush();
    const names = (await readdir(join(dir, 'b1'))).filter((n) => n.endsWith('.json') && n !== 'invalidated.json');
    expect(names.length).toBe(5);
    await s.prune();
    const left = (await readdir(join(dir, 'b1'))).filter((n) => n.endsWith('.json') && n !== 'invalidated.json');
    expect(left.length).toBe(3);
  });

  it('removes other builds directories on init, and a failed write never throws into the caller', async () => {
    const old = createShellStore({ dir, build: 'old', now: () => NOW });
    await old.put(base({ key: 'old|/vara/x/' }));
    await old.flush();
    const s = createShellStore({ dir, build: 'b1', now: () => NOW, pruneOtherBuilds: true });
    await s.init();
    expect(await readdir(dir)).not.toContain('old');
    const broken = createShellStore({ dir: join(dir, 'file-not-dir'), build: 'b1', now: () => NOW });
    await writeFile(join(dir, 'file-not-dir'), 'x');
    // put now reports whether the page was accepted (review 20): a write that fails on disk is not a refused page
    await expect(broken.put(base())).resolves.toBe(true);
    await expect(broken.flush()).resolves.toBeUndefined();
  });
});

describe('shellStore: races, bounds and the epochs (review 2, 4, 8, 10, 19)', () => {
  it('a render that started before a drop loses against it, one that started after it is kept', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t });
    await s.put(base({ at: NOW }));
    t = NOW + 1000;
    await s.remove('b1|/vara/x/');
    await s.put(base({ at: NOW + 500 })); // rendered before the drop, finished after it
    expect(await s.get('b1|/vara/x/', NOW + 2000)).toBeNull();
    await s.put(base({ at: NOW + 1500 })); // rendered after the drop
    expect((await s.get('b1|/vara/x/', NOW + 2000))?.state).toBe('fresh');
  });

  it('a render that started before a poke is stale when it lands, even though it finished later', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t });
    t = NOW + 1000;
    await s.invalidate(['/vara/x/']);
    await s.put(base({ at: NOW + 500 }));
    expect((await s.get('b1|/vara/x/', NOW + 2000))?.state).toBe('stale');
    await s.flush();
  });

  it('keeps marks bounded: a flood of paths cannot grow the map past its cap', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    for (let i = 0; i < 60; i++) {
      await s.invalidate(Array.from({ length: 50 }, (_, j) => `/vara/p${i}-${j}/`));
    }
    expect(s.markCount()).toBeLessThanOrEqual(5000);
  });

  it('drops marks older than the hard maximum age on init', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.invalidate(['/vara/old/']);
    const later = createShellStore({ dir, build: 'b1', now: () => NOW + 8 * 24 * 3600_000 });
    await later.init();
    expect(later.markCount()).toBe(0);
  });

  it('writes the marks once at a time, with unique temporary files, and the last write holds every mark', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    for (let i = 0; i < 20; i++) await s.put(base({ key: `b1|/vara/q${i}/`, path: `/vara/q${i}/` }));
    await s.flush();
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.invalidate([`/vara/q${i}/`])));
    await s.flush();
    const files = await readdir(join(dir, 'b1'));
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const again = createShellStore({ dir, build: 'b1', now: () => NOW });
    await again.init();
    expect(again.markCount()).toBe(20);
  });

  it('a product epoch marks every stored product page stale in one step, and no listing', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW + 1000 });
    await s.put(base());
    await s.put(base({ key: 'b1|/', path: '/', tier: 'listing', freshMs: 300_000 }));
    await s.invalidateProducts();
    expect((await s.get('b1|/vara/x/', NOW + 1000))?.state).toBe('stale');
    expect((await s.get('b1|/', NOW + 1000))?.state).toBe('fresh');
  });

  it('invalidateAll marks every stored page of every tier stale, and a page rendered after it is fresh (content saves, review 24)', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW + 1000 });
    await s.put(base());
    await s.put(base({ key: 'b1|/', path: '/', tier: 'listing', freshMs: 300_000 }));
    await s.put(base({ key: 'b1|/um-okkur/', path: '/um-okkur/', tier: 'content' }));
    await s.put(base({ key: 'b1|/verslun/?verd=a', path: '/verslun/', tier: 'filtered', freshMs: 120_000, memoryOnly: true }));
    await s.invalidateAll();
    await s.flush();
    for (const key of ['b1|/vara/x/', 'b1|/', 'b1|/um-okkur/', 'b1|/verslun/?verd=a']) {
      expect((await s.get(key, NOW + 1000))?.state).toBe('stale');
    }
    // A render that starts after the mark is fresh again; the marks file keeps the one bulk mark, not one per page.
    await s.put(base({ at: NOW + 2000 }));
    expect((await s.get('b1|/vara/x/', NOW + 2000))?.state).toBe('fresh');
    const again = createShellStore({ dir, build: 'b1', now: () => NOW + 2000 });
    await again.init();
    expect((await again.get('b1|/um-okkur/', NOW + 2000))?.state).toBe('stale');
    expect(again.markCount()).toBe(1);
  });

  it('bounds the memory-only tier by bytes as well as by count', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW, filteredBytes: 100 });
    const body = 'x'.repeat(60);
    await s.put(base({ key: 'b1|/verslun/?verd=a', path: '/verslun/', tier: 'filtered', freshMs: 120_000, memoryOnly: true, body }));
    await s.put(base({ key: 'b1|/verslun/?verd=b', path: '/verslun/', tier: 'filtered', freshMs: 120_000, memoryOnly: true, body }));
    expect(await s.get('b1|/verslun/?verd=a', NOW)).toBeNull();
    expect(await s.get('b1|/verslun/?verd=b', NOW)).not.toBeNull();
  });
});

describe('shellStore: junk paths cannot push out real marks (review 8, 19)', () => {
  it('a flood of unknown paths grows no durable mark, and a stored page keeps its mark', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW + 1000 });
    await s.put(base());
    await s.flush();
    await s.invalidate(['/vara/x/']);
    expect(s.markCount()).toBe(1);
    for (let i = 0; i < 60; i++) {
      await s.invalidate(Array.from({ length: 50 }, (_, j) => `/vara/junk${i}-${j}/`));
    }
    expect(s.markCount()).toBe(1);
    expect((await s.get('b1|/vara/x/', NOW + 1000))?.state).toBe('stale');
    await s.flush();
  });

  it('a render that was running when a path was poked (no page stored yet) lands stale', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t });
    t = NOW + 1000;
    await s.invalidate(['/vara/y/']); // nothing stored yet: pending
    expect(s.markCount()).toBe(0);
    await s.put(base({ key: 'b1|/vara/y/', path: '/vara/y/', at: NOW + 500 }));
    expect((await s.get('b1|/vara/y/', NOW + 2000))?.state).toBe('stale');
    await s.flush();
  });
});


const fileName = (key: string) => `${createHash('sha1').update(key).digest('hex')}.json`;

describe('shellStore: review 1, 2, 3 (bulk marks, drops against writes, partial files)', () => {
  it('the bulk product mark is never trimmed away by the cap, even when it is the oldest (review 1)', async () => {
    const marks: Record<string, number> = { '*products': NOW - 1000 };
    for (let i = 0; i < 5000; i++) marks[`/vara/m${i}/`] = NOW - 500 + i;
    await mkdir(join(dir, 'b1'), { recursive: true });
    await writeFile(join(dir, 'b1', 'invalidated.json'), JSON.stringify(marks));
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.init();
    await s.put(base({ at: NOW - 5000 }));
    expect((await s.get('b1|/vara/x/', NOW))?.state).toBe('stale');
  });

  it('a remove is not undone by a write still in flight for the same key (review 2)', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    void s.put(base()); // not awaited: its disk write is still running
    await s.remove('b1|/vara/x/');
    await s.flush();
    const again = createShellStore({ dir, build: 'b1', now: () => NOW });
    expect(await again.get('b1|/vara/x/', NOW)).toBeNull();
  });

  it('get does not serve a disk page rendered before a live drop, but does serve one rendered after it (review 2)', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW + 1000 });
    await s.remove('b1|/vara/x/');
    await mkdir(join(dir, 'b1'), { recursive: true });
    await writeFile(join(dir, 'b1', fileName('b1|/vara/x/')), JSON.stringify(base({ at: NOW })));
    expect(await s.get('b1|/vara/x/', NOW + 2000)).toBeNull();
    await writeFile(join(dir, 'b1', fileName('b1|/vara/x/')), JSON.stringify(base({ at: NOW + 1500 })));
    expect((await s.get('b1|/vara/x/', NOW + 2000))?.state).toBe('fresh');
  });

  it('a failed page write leaves no partial file behind (review 3)', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await mkdir(join(dir, 'b1', fileName('b1|/vara/x/')), { recursive: true }); // the rename onto it fails
    await s.put(base());
    await s.flush();
    expect((await readdir(join(dir, 'b1'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('prune removes a stale temporary file left by a crash and keeps one still being written (review 3)', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await mkdir(join(dir, 'b1'), { recursive: true });
    const old = join(dir, 'b1', 'x.json.1.abc.tmp');
    await writeFile(old, 'partial');
    await writeFile(join(dir, 'b1', 'y.json.2.def.tmp'), 'partial');
    const hourAgo = new Date(Date.now() - 3600_000);
    await utimes(old, hourAgo, hourAgo);
    await s.prune();
    expect(await readdir(join(dir, 'b1'))).toEqual(['y.json.2.def.tmp']);
  });
});

describe('shellStore: review 5 (an unkeyed poke acts only on known paths)', () => {
  it('knows a path with a stored page, or one already poked and waiting for a render, and not any other', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.put(base());
    await s.flush();
    expect(await s.knowsPath('/vara/x/')).toBe(true);
    expect(await s.knowsPath('/vara/junk/')).toBe(false);
    await s.invalidate(['/vara/waiting/']); // no page yet: pending
    expect(await s.knowsPath('/vara/waiting/')).toBe(true);
  });
});

describe('shellStore: a render in flight counts as known to the unkeyed poke (advisor review of review 5)', () => {
  it('a poke for a path whose render is running lands stale when that render stores its page', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t });
    const end = s.beginRender('/vara/x/');
    t = NOW + 1000;
    expect(await s.knowsPath('/vara/x/')).toBe(true);
    await s.invalidate(['/vara/x/']); // nothing stored yet: pending, so the render is marked on the way in
    await s.put(base({ at: NOW }));
    end();
    expect((await s.get('b1|/vara/x/', NOW + 2000))?.state).toBe('stale');
    await s.flush();
  });

  it('a drop for a path whose render is running wins over the page that render was making', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t });
    const end = s.beginRender('/vara/x/');
    t = NOW + 1000;
    expect(await s.knowsPath('/vara/x/')).toBe(true);
    await s.remove('b1|/vara/x/');
    await s.put(base({ at: NOW })); // rendered before the drop
    end();
    expect(await s.get('b1|/vara/x/', NOW + 2000)).toBeNull();
  });

  it('a path with no render running and no page is not known once its render has ended', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    const end = s.beginRender('/vara/y/');
    end();
    expect(await s.knowsPath('/vara/y/')).toBe(false);
  });

  it('counts the pages in memory and on disk (this build only, no marks file), and clears them all', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.put(base());
    await s.put(base({ key: 'b1|/vara/y/', path: '/vara/y/', body: '<html>yy</html>' }));
    await s.invalidate(['/vara/y/']);
    await s.flush();
    expect(s.memoryCount()).toBe(2);
    const disk = await s.diskStats();
    expect(disk.files).toBe(2);
    expect(disk.bytes).toBeGreaterThan(0);
    const other = createShellStore({ dir, build: 'b2', now: () => NOW });
    expect((await other.diskStats()).files).toBe(0);

    expect(await s.clear()).toEqual({ removed: 2, failed: 0 });
    expect(s.memoryCount()).toBe(0);
    expect(await s.diskStats()).toEqual({ files: 0, bytes: 0 });
    expect(await s.get('b1|/vara/x/', NOW)).toBeNull();
    const names = await readdir(join(dir, 'b1'));
    expect(names).toContain('invalidated.json');
  });

  it('a page file that cannot be removed is counted as failed, and the store still answers the count it removed', async () => {
    // A folder without write permission keeps its files readable but cannot unlink them. Root may unlink anything, so the
    // test does not apply there.
    if (process.getuid?.() === 0) return;
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.put(base());
    await s.put(base({ key: 'b1|/vara/y/', path: '/vara/y/', body: '<html>yy</html>' }));
    await s.flush();
    const buildDir = join(dir, 'b1');
    await chmod(buildDir, 0o555);
    try {
      expect(await s.clear()).toEqual({ removed: 0, failed: 2 });
    } finally {
      await chmod(buildDir, 0o755);
    }
    // The files that could not go are still on disk: the next visit may serve them while they are fresh.
    expect((await s.diskStats()).files).toBe(2);
  });
});

describe('shellStore: review 25 (a mark for a stored page is never lost at the cap)', () => {
  const listing = (over: Partial<ShellEntry> = {}): ShellEntry => base({ key: 'b1|/', path: '/', tier: 'listing', freshMs: 300_000, ...over });

  it('a product mark evicted at the cap leaves its page stale through the product bulk mark, also after a restart', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t, markLimit: 1 });
    await s.put(base({ key: 'b1|/vara/a/', path: '/vara/a/' }));
    await s.put(base({ key: 'b1|/vara/b/', path: '/vara/b/' }));
    await s.put(listing()); // stored and never marked: must stay fresh
    t = NOW + 1000;
    await s.invalidate(['/vara/a/']);
    t = NOW + 2000;
    await s.invalidate(['/vara/b/']); // two marks, cap of one: a's (the oldest) goes, and a is stored
    expect(s.markCount()).toBe(2); // b's mark and the product bulk mark
    expect((await s.get('b1|/vara/a/', NOW + 3000))?.state).toBe('stale');
    expect((await s.get('b1|/vara/b/', NOW + 3000))?.state).toBe('stale');
    expect((await s.get('b1|/', NOW + 3000))?.state).toBe('fresh');
    await s.flush();
    const again = createShellStore({ dir, build: 'b1', now: () => NOW + 3000 });
    await again.init();
    expect((await again.get('b1|/vara/a/', NOW + 3000))?.state).toBe('stale');
  });

  it('a content mark evicted at the cap falls back to the content bulk mark, which reaches every stored content page', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t, markLimit: 1 });
    await s.put(base({ key: 'b1|/um-okkur/', path: '/um-okkur/', tier: 'content' }));
    await s.put(base({ key: 'b1|/hafa-samband/', path: '/hafa-samband/', tier: 'content' })); // never marked
    await s.put(base());
    t = NOW + 1000;
    await s.invalidate(['/um-okkur/']);
    t = NOW + 2000;
    await s.invalidate(['/vara/x/']); // the content mark is the oldest and goes
    expect((await s.get('b1|/um-okkur/', NOW + 3000))?.state).toBe('stale');
    expect((await s.get('b1|/hafa-samband/', NOW + 3000))?.state).toBe('stale');
    expect((await s.get('b1|/vara/x/', NOW + 3000))?.state).toBe('stale');
    await s.flush();
  });

  it('a page rendered after the evicted mark is not made stale by the fallback', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t, markLimit: 1 });
    await s.put(base({ key: 'b1|/vara/a/', path: '/vara/a/', at: NOW + 1500 })); // rendered after a's poke
    await s.put(base({ key: 'b1|/vara/b/', path: '/vara/b/' }));
    t = NOW + 1000;
    await s.invalidate(['/vara/a/']);
    t = NOW + 2000;
    await s.invalidate(['/vara/b/']);
    expect((await s.get('b1|/vara/a/', NOW + 3000))?.state).toBe('fresh');
    await s.flush();
  });

  it('a mark for a path with no stored page is dropped at the cap, with no bulk mark', async () => {
    let t = NOW;
    const s = createShellStore({ dir, build: 'b1', now: () => t, markLimit: 1 });
    await s.put(base({ key: 'b1|/vara/x/', path: '/vara/x/' }));
    t = NOW + 1000;
    await s.invalidate(['/vara/x/']);
    await s.remove('b1|/vara/x/'); // the page is gone; its mark is not
    await s.put(base({ key: 'b1|/vara/y/', path: '/vara/y/' }));
    await s.put(base({ key: 'b1|/vara/z/', path: '/vara/z/' })); // unmarked
    t = NOW + 2000;
    await s.invalidate(['/vara/y/']);
    expect(s.markCount()).toBe(1);
    expect((await s.get('b1|/vara/z/', NOW + 3000))?.state).toBe('fresh');
    await s.flush();
  });
});

describe('shellStore.put reports whether it kept the page (review 20)', () => {
  it('is false for a render a drop overtook, and true for one that is kept', async () => {
    const s = createShellStore({ dir, build: 'b1', now: () => NOW });
    await s.remove('b1|/vara/x/');
    expect(await s.put(base({ at: NOW - 1 }))).toBe(false);
    expect(await s.put(base({ at: NOW + 1 }))).toBe(true);
    await s.flush();
  });
});
