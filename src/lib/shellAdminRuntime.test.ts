// The admin status and store actions on a real store in a temporary folder (MOS_SHELL_DIR is set before the first use
// of the store, so the development server's pages are never touched): the shape the page reads, the scheduler's reason
// with no base, a refresh that marks a stored page, and a clear that removes every stored page.
import type { Dirent } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0, getSecret: () => undefined }));
vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.test' }));

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mos-admin-test-'));
  process.env.MOS_SHELL_DIR = dir;
  process.env.MOS_SHELL = 'on';
  delete process.env.MOS_SHELL_REBUILD_BASE;
  delete process.env.MOS_EXTRA_ALLOWED_HOSTS;
  process.env.MOS_SHELL_REBUILD_AT = '05:00'; // switched on: the rebuild is off by default
  // The photo cache is a sibling of the page store, not inside it: the store prunes the other folders of its own.
  process.env.MOS_IMG_CACHE_DIR = join(`${dir}-img`);
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  await rm(`${dir}-img`, { recursive: true, force: true, maxRetries: 5 });
});

const entry = async (path: string) => {
  const { shellBuildId } = await import('./shellRuntime');
  const { shellKey } = await import('./shellPolicy');
  return {
  key: shellKey(shellBuildId(), path, new URLSearchParams()),
  path,
  tier: 'product' as const,
  // A second ago: a mark made in the same millisecond as the render started does not make a page stale (shellPolicy
  // freshness), which a real render never meets but this test did about one run in six.
  at: Date.now() - 1000,
  freshMs: 24 * 3600_000,
  status: 200,
  headers: [['Content-Type', 'text/html; charset=utf-8']] as [string, string][],
  body: '<html>page</html>',
  memoryOnly: false,
  };
};

describe('shellAdminStatus and the store actions', () => {
  it('reports the store and why the nightly rebuild is not armed (no base), with the folder kind and no path', async () => {
    const { shellAdminStatus } = await import('./shellAdminRuntime');
    const s = await shellAdminStatus(1_000);
    expect(s.ok).toBe(true);
    expect(s.store).toMatchObject({ on: true, folder: 'durable', pagesInMemory: 0, pagesOnDisk: 0, diskBytes: 0 });
    expect(s.store.build).toHaveLength(8);
    expect(s.store.fresh.productMs).toBe(24 * 3600_000);
    expect(s.scheduler).toMatchObject({ armed: false, why: 'no-base', at: '05:00', hasBase: false, nextRunAt: null });
    expect(s.run).toMatchObject({ running: false, visited: 0 });
    expect(s.lastRun).toBeNull();
    expect(s.failures).toEqual([]);
    expect(JSON.stringify(s)).not.toContain(dir);
  });

  it('refresh marks a stored page; clear removes every stored page and the count follows', async () => {
    const { getShell } = await import('./shellRuntime');
    const { refreshShellPath, clearShellPages, shellAdminStatus } = await import('./shellAdminRuntime');
    const store = await getShell();
    expect(store).not.toBeNull();
    const a = await entry('/vara/a/');
    await store!.put(a);
    await store!.put(await entry('/vara/b/'));
    await store!.flush();
    // The disk count is cached for a minute: the status read before the writes still shows the old count.
    expect((await shellAdminStatus(1)).store.pagesOnDisk).toBe(0);

    expect(await refreshShellPath('/vara/a/')).toBe(true);
    expect(await store!.get(a.key, Date.now())).toMatchObject({ state: 'stale' });

    expect(await clearShellPages()).toEqual({ removed: 2, failed: 0 });
    const after = await shellAdminStatus(2);
    // The clear drops the cached count, so the next status counts again.
    expect(after.store).toMatchObject({ pagesInMemory: 0, pagesOnDisk: 0 });
    expect(await store!.get(a.key, Date.now())).toBeNull();
  });

  it('clear is refused while a run holds the run slot, and the slot is free again after it', async () => {
    const { beginRun, endRun, isRunning } = await import('./nightlyRebuildState');
    const { clearShellPages } = await import('./shellAdminRuntime');
    expect(beginRun(1)).toBe(true);
    expect(await clearShellPages()).toBe('running');
    expect(isRunning()).toBe(true);
    endRun({ endedAt: 2, record: false });
    expect(await clearShellPages()).not.toBe('running');
    expect(isRunning()).toBe(false);
  });

  it('a clear in progress shows as clearing and not as a running walk; another clear is refused as clearing', async () => {
    const { beginClear, endClear } = await import('./nightlyRebuildState');
    const { clearShellPages, shellAdminStatus } = await import('./shellAdminRuntime');
    expect(beginClear()).toBe(true);
    try {
      const during = await shellAdminStatus(2);
      expect(during.run).toMatchObject({ running: false, clearing: true });
      expect(await clearShellPages()).toBe('clearing');
    } finally {
      endClear();
    }
    expect((await shellAdminStatus(3)).run.clearing).toBe(false);
  });
});

describe('the photo cache: count and clear', () => {
  it('counts the kept photos of this version recursively, skipping temporary files, and clears only this version', async () => {
    vi.resetModules(); // a fresh count cache, and a photo folder read from the environment set above
    const { IMG_DIR, IMG_ROOT } = await import('./imgRuntime');
    const { clearPhotos, shellAdminStatus } = await import('./shellAdminRuntime');
    await mkdir(join(IMG_DIR, '360-webp'), { recursive: true });
    await writeFile(join(IMG_DIR, '360-webp', 'a.webp'), Buffer.alloc(10));
    await writeFile(join(IMG_DIR, '360-webp', 'b.webp.123.tmp'), Buffer.alloc(99)); // half-written: not a photo
    await mkdir(join(IMG_ROOT, 'v1', '720-avif'), { recursive: true });
    await writeFile(join(IMG_ROOT, 'v1', '720-avif', 'old.avif'), Buffer.alloc(5)); // an older version: not counted, not cleared

    const first = await shellAdminStatus(1);
    expect(first.photos).toMatchObject({ files: 1, bytes: 10, folder: 'durable' });
    expect(typeof first.photos.at === 'number').toBe(true);

    expect(await clearPhotos()).toEqual({ removed: 1, failed: 0 });
    const after = await shellAdminStatus(2);
    expect(after.photos).toMatchObject({ files: 0, bytes: 0 });
    await expect(stat(join(IMG_ROOT, 'v1', '720-avif', 'old.avif'))).resolves.toBeTruthy();
  });

  it('a photo clear is refused while a run holds the slot, and while another clear does', async () => {
    vi.resetModules();
    const { clearPhotos } = await import('./shellAdminRuntime');
    const { beginRun, endRun, beginClear, endClear } = await import('./nightlyRebuildState');
    expect(beginRun(1)).toBe(true);
    expect(await clearPhotos()).toBe('running');
    endRun({ endedAt: 2, record: false });
    expect(beginClear()).toBe(true);
    try {
      expect(await clearPhotos()).toBe('clearing');
    } finally {
      endClear();
    }
  });
});

describe('the photo folder: only a folder that is not there means no photos', () => {
  const failing = (code: string) => Object.assign(new Error(code), { code });
  const dirent = (name: string) => ({ name, isDirectory: () => false, isFile: () => true }) as unknown as Dirent;

  it('a folder that is not there is no photos, and is not logged', async () => {
    const { countPhotos } = await import('./shellAdminRuntime');
    const { log } = await import('./logger'); // the module instance the photo walk uses (after vi.resetModules)
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const fsx = { readdir: async () => { throw failing('ENOENT'); }, stat: async () => ({ size: 0 }) };
    expect(await countPhotos('/no/such/folder', fsx)).toEqual({ files: 0, bytes: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('any other error reading the folder: the count is not known (null), logged once', async () => {
    const { countPhotos } = await import('./shellAdminRuntime');
    const { log } = await import('./logger'); // the module instance the photo walk uses (after vi.resetModules)
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const fsx = { readdir: async () => { throw failing('EACCES'); }, stat: async () => ({ size: 0 }) };
    expect(await countPhotos('/locked', fsx)).toEqual({ files: null, bytes: null });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a file that vanished between the walk and its stat is not counted; another stat error makes the count unknown', async () => {
    const { countPhotos } = await import('./shellAdminRuntime');
    const { log } = await import('./logger'); // the module instance the photo walk uses (after vi.resetModules)
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const readdir = async () => [dirent('a.webp')];
    expect(await countPhotos('/d', { readdir, stat: async () => { throw failing('ENOENT'); } })).toEqual({ files: 0, bytes: 0 });
    expect(await countPhotos('/d', { readdir, stat: async () => { throw failing('EIO'); } })).toEqual({ files: null, bytes: null });
    warn.mockRestore();
  });

  it.skipIf(process.getuid?.() === 0)('a subfolder that cannot be read makes the count unknown, not zero', async () => {
    const { countPhotos } = await import('./shellAdminRuntime');
    const root = await mkdtemp(join(tmpdir(), 'mos-count-'));
    const locked = join(root, '360-webp');
    try {
      await mkdir(locked);
      await writeFile(join(locked, 'a.webp'), Buffer.alloc(3));
      await chmod(locked, 0o000);
      expect(await countPhotos(root)).toEqual({ files: null, bytes: null });
    } finally {
      await chmod(locked, 0o755);
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.getuid?.() === 0)('a photo clear that cannot list the folder counts a failure and does not report success', async () => {
    vi.resetModules();
    const { IMG_DIR } = await import('./imgRuntime');
    const { clearPhotos } = await import('./shellAdminRuntime');
    const locked = join(IMG_DIR, 'locked-webp');
    await mkdir(locked, { recursive: true });
    await writeFile(join(locked, 'a.webp'), Buffer.alloc(3));
    await chmod(locked, 0o000);
    try {
      expect(await clearPhotos()).toEqual({ removed: 0, failed: 1 });
    } finally {
      await chmod(locked, 0o755);
      await rm(join(IMG_DIR, 'locked-webp'), { recursive: true, force: true });
    }
  });
});

