// The admin endpoint's process side: gathers the status from the store, the nightly rebuild, the photo cache and the
// environment, and runs the store actions (refresh one path, clear every page, clear the photos). SERVER-ONLY.
import { readdir, rm, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { msUntilNextRun, scheduleWhy } from './nightlyRebuild';
import { lastNightlyEnd, lastNightlyStart, nightlySettingsView, nightlyUnfinishedStart, rebuildBase, scheduleArmed } from './nightlyRebuildRuntime';
import { beginClear, endClear, isClearing, recentFailures, runView } from './nightlyRebuildState';
import { buildShellAdminStatus, createTtlCache, type ShellAdminStatus } from './shellAdmin';
import { IMG_DIR, imgFolderKind } from './imgRuntime';
import { FRESH_MS, HARD_MAX_AGE_MS } from './shellPolicy';
import { getShell, invalidatePaths, shellBuildId, shellEnabled, shellFreshOverride } from './shellRuntime';
import { forgetProduct } from './woo';
import { log, runtimeEnv } from './logger';

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
  const p = await photoCount.get();
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
    photos: { files: p?.value.files ?? null, bytes: p?.value.bytes ?? null, at: p?.at ?? null, folder: imgFolderKind() },
  });
}

/** The photo count is a directory walk too: once a minute at most, like the page count. */
const photoCount = createTtlCache(() => countPhotos(IMG_DIR), DISK_TTL_MS);

/** The file system calls the photo walk makes (injected, so a test can stand in a failing folder). */
export interface PhotoFs {
  readdir(dir: string): Promise<Dirent[]>;
  stat(file: string): Promise<{ size: number }>;
}
const NODE_PHOTO_FS: PhotoFs = {
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  stat: (file) => stat(file),
};

const errorCode = (err: unknown): string | undefined => (err as { code?: string }).code;

/** The kept photos under `dir`, recursively, with their bytes. A temporary file (a photo still being written) is not a
 *  photo. A folder that is not there is no photos. Any other error (a folder that cannot be read) makes the count unknown
 *  (null), and is logged once. */
export async function countPhotos(dir: string, fsx: PhotoFs = NODE_PHOTO_FS): Promise<{ files: number | null; bytes: number | null }> {
  const unknown = { files: null, bytes: null };
  let files: string[];
  try {
    files = await listPhotos(dir, fsx);
  } catch (err) {
    log.warn('[photos] the photo folder cannot be read; its count is not known', { dir, code: errorCode(err) });
    return unknown;
  }
  const out = { files: 0, bytes: 0 };
  for (const file of files) {
    let size: number;
    try {
      size = (await fsx.stat(file)).size;
    } catch (err) {
      // a file removed since the walk is not a photo any more
      if (errorCode(err) === 'ENOENT') continue;
      log.warn('[photos] a photo file cannot be read; its count is not known', { file, code: errorCode(err) });
      return unknown;
    }
    out.files += 1;
    out.bytes += size;
  }
  return out;
}

/** The full paths of the photo files under `dir` (recursive, temporary files left out). Empty when there is no folder;
 *  any other error reading a folder is thrown (a folder that cannot be read is not an empty one). */
export async function listPhotos(dir: string, fsx: PhotoFs = NODE_PHOTO_FS): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsx.readdir(dir);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listPhotos(p, fsx)));
    else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(p);
  }
  return out;
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

/** Removes every kept photo of this version (the folder of LIGHT_VERSION only: an older version's folder is left alone).
 *  The photos a visitor or a run makes after the clear are made again on demand. Returns how many files were removed and
 *  how many could not be (failed > 0: some may still be served). 'running' when a walk holds the run slot, 'clearing'
 *  when another clear does. It holds the slot itself, so a run cannot start while the files are removed. */
export async function clearPhotos(): Promise<{ removed: number; failed: number } | 'running' | 'clearing'> {
  if (!beginClear()) return isClearing() ? 'clearing' : 'running';
  try {
    const out = { removed: 0, failed: 0 };
    let files: string[] = [];
    try {
      files = await listPhotos(IMG_DIR);
    } catch (err) {
      // A folder that cannot be read is a failure: the photos in it may still be served, so no success is reported.
      log.warn('[photos] the photo folder cannot be read; nothing is removed', { dir: IMG_DIR, code: errorCode(err) });
      out.failed = 1;
    }
    for (const file of files) {
      try {
        await rm(file);
        out.removed += 1;
      } catch (err) {
        // A file that is already gone is not a failure; any other error is one.
        if (errorCode(err) !== 'ENOENT') out.failed += 1;
      }
    }
    photoCount.invalidate();
    return out;
  } finally {
    endClear();
  }
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
