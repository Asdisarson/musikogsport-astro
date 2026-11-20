// The admin endpoint's process side: gathers the status from the store, the nightly rebuild and the environment, and
// runs the store actions (refresh one path, clear every page). SERVER-ONLY.
import { msUntilNextRun, scheduleWhy } from './nightlyRebuild';
import { lastNightlyEnd, lastNightlyStart, nightlySettingsView, nightlyUnfinishedStart, rebuildBase, scheduleArmed } from './nightlyRebuildRuntime';
import { beginClear, endClear, isClearing, recentFailures, runView } from './nightlyRebuildState';
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
  // The effective settings: saved over the environment (src/lib/nightlySettings.ts). The schedule follows them.
  const settings = await nightlySettingsView();
  const eff = settings.effective;
  const minutes = eff.enabled ? Number(eff.at.slice(0, 2)) * 60 + Number(eff.at.slice(3, 5)) : null;
  const hasBase = rebuildBase().origin !== null;
  const why = scheduleWhy({ storeOn: store !== null, atOff: !eff.enabled, hasBase, armed: scheduleArmed() });
  const d = store ? await disk.get() : null;
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
      at: minutes === null ? null : eff.at,
      hasBase,
      nextRunAt: minutes !== null && (why === null || why === 'waiting') ? now + msUntilNextRun(now, minutes) : null,
      lastStart: lastNightlyStart(),
      lastEnd: lastNightlyEnd(),
      unfinishedStart: nightlyUnfinishedStart(),
    },
    settings: { effective: settings.effective, source: settings.source, saved: settings.saved },
    runs: settings.runs,
    run: runView(),
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

/** Drops every stored page of this build; the pages are rendered again on their visits. The result is how many page files
 *  were removed and how many could not be (failed > 0 means some may still be served). Null when the store is off;
 *  'running' when a walk holds the run slot, 'clearing' when another clear does. The clear takes the slot itself, so no
 *  walk can start while it removes files; it is not a run, so it is not recorded as one. */
export async function clearShellPages(): Promise<{ removed: number; failed: number } | null | 'running' | 'clearing'> {
  if (!beginClear()) return isClearing() ? 'clearing' : 'running';
  try {
    const store = await getShell();
    if (!store) return null;
    const cleared = await store.clear();
    disk.invalidate();
    return cleared;
  } finally {
    endClear();
  }
}
