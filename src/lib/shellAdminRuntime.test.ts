// The admin status and store actions on a real store in a temporary folder (MOS_SHELL_DIR is set before the first use
// of the store, so the development server's pages are never touched): the shape the page reads, the scheduler's reason
// with no base, a refresh that marks a stored page, and a clear that removes every stored page.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', MOS_CLIENT_IP_HEADER: undefined, MOS_TRUSTED_PROXY_HOPS: 0, getSecret: () => undefined }));

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mos-admin-test-'));
  process.env.MOS_SHELL_DIR = dir;
  process.env.MOS_SHELL = 'on';
  delete process.env.MOS_SHELL_REBUILD_BASE;
  delete process.env.MOS_EXTRA_ALLOWED_HOSTS;
  process.env.MOS_SHELL_REBUILD_AT = '05:00'; // switched on: the rebuild is off by default
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const entry = async (path: string) => {
  const { shellBuildId } = await import('./shellRuntime');
  const { shellKey } = await import('./shellPolicy');
  return {
  key: shellKey(shellBuildId(), path, new URLSearchParams()),
  path,
  tier: 'product' as const,
  at: Date.now(),
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

    expect(await clearShellPages()).toBe(2);
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
});
