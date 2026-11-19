// The admin endpoint's process side: gathers the status from the store, the nightly rebuild and the environment, and
// runs the store actions (refresh one path, clear every page). SERVER-ONLY.
import { msUntilNextRun, parseRebuildAt, scheduleWhy } from './nightlyRebuild';
import { lastNightlyEnd, lastNightlyStart, rebuildBase, scheduleArmed } from './nightlyRebuildRuntime';
import { beginRun, endRun, lastRun, recentFailures, runView } from './nightlyRebuildState';
import { buildShellAdminStatus, createTtlCache, type ShellAdminStatus } from './shellAdmin';
import { FRESH_MS, HARD_MAX_AGE_MS } from './shellPolicy';
import { getShell, invalidatePaths, shellBuildId, shellEnabled, shellFreshOverride } from './shellRuntime';
import { forgetProduct } from './woo';
import { runtimeEnv } from './logger';

/** The disk count is a directory walk: once a minute at most, whatever the number of requests. */
const DISK_TTL_MS = 60_000;
const disk = createTtlCache(async () => {
  const store = await getShell();
  if (!store) throw new Error('the shell store is not available');
  return store.diskStats();
}, DISK_TTL_MS);

/** The status the WordPress page reads (GET /api/shell-admin). */
export async function shellAdminStatus(now: number = Date.now()): Promise<ShellAdminStatus> {
  const store = shellEnabled() ? await getShell() : null;
  const at = parseRebuildAt(runtimeEnv('MOS_SHELL_REBUILD_AT')).at;
  const minutes = at.kind === 'at' ? at.minutes : null;
  const hasBase = rebuildBase().origin !== null;
  const why = scheduleWhy({ storeOn: store !== null, atOff: at.kind === 'off', hasBase, armed: scheduleArmed() });
  const d = store ? await disk.get() : null;
  const last = lastRun();
  return buildShellAdminStatus({
    now,
    store: {
      on: store !== null,
      build: store ? shellBuildId() : null,
      folder: store ? (runtimeEnv('MOS_SHELL_DIR') ? 'durable' : 'temp') : null,
      pagesInMemory: store?.memoryCount() ?? 0,
      disk: d ? { files: d.value.files, bytes: d.value.bytes, at: d.at } : null,
      fresh: {
        productMs: FRESH_MS.product,
        contentMs: FRESH_MS.content,
        listingMs: FRESH_MS.listing,
        filteredMs: FRESH_MS.filtered,
        hardMaxMs: HARD_MAX_AGE_MS,
        overrideMs: shellFreshOverride(),
      },
    },
    scheduler: {
      why,
      at: minutes === null ? null : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      hasBase,
      nextRunAt: minutes !== null && (why === null || why === 'waiting') ? now + msUntilNextRun(now, minutes) : null,
      lastStart: lastNightlyStart(),
      lastEnd: lastNightlyEnd(),
    },
    run: runView(),
    lastRun: last,
    failures: recentFailures(),
  });
}

/** Marks one stored page stale (the next visit renders it) and forgets its cached product, as the poke route does. */
export async function refreshShellPath(path: string): Promise<boolean> {
  forgetProduct(path.split('/').filter(Boolean).pop() ?? '');
  return invalidatePaths([path]);
}

/** Whether the store opens (it is on and can be created). The run answers 202 only when it does. */
export async function storeOpens(): Promise<boolean> {
  return (await getShell()) !== null;
}

/** Drops every stored page of this build; the pages are rendered again on their visits. Null when the store is off;
 *  'running' when a run holds the run slot (a walk or another clear). The clear takes the slot itself, so no walk can
 *  start while it removes files. */
export async function clearShellPages(): Promise<number | null | 'running'> {
  if (!beginRun(Date.now())) return 'running';
  try {
    const store = await getShell();
    if (!store) return null;
    const removed = await store.clear();
    disk.invalidate();
    return removed;
  } finally {
    endRun({ endedAt: Date.now(), record: false });
  }
}
