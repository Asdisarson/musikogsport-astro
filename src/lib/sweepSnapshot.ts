// A sitemap sweep's last result, kept on disk. The sweep is cached in memory only, and Passenger starts a new
// server process after a restart or an idle spell: without this file the first sitemap request to a new process
// waits for a full sweep of the catalog (most of a minute). With it, the new process answers from the file and
// refreshes in the background. The file holds public data only (product slugs and dates).
import { readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from './logger';

/** A snapshot older than this is not used: by then the catalog has moved on too far to be worth listing. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Options {
  /** Where the file lives (the system temp directory). */
  dir?: string;
  now?: () => number;
}

function fileFor(name: string, dir: string): string {
  return join(dir, `mos-sweep-${name.replace(/[^a-z0-9-]/gi, '')}.json`);
}

/** The stored value and when it was swept, or null when there is no usable file. Never throws. */
export async function readSnapshot(name: string, opts: Options = {}): Promise<{ at: number; val: unknown } | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(fileFor(name, opts.dir ?? tmpdir()), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { at, val } = parsed as { at?: unknown; val?: unknown };
    if (typeof at !== 'number' || !Number.isFinite(at) || val === undefined) return null;
    if ((opts.now ?? Date.now)() - at > MAX_AGE_MS) return null;
    return { at, val };
  } catch (err) {
    // No file yet is the normal first run; anything else (unreadable, damaged) is worth a line. The caller sweeps.
    if ((err as { code?: string }).code !== 'ENOENT') log.warn('[sitemap] snapshot not read', { err });
    return null;
  }
}

/** Store a sweep's result. A failure is logged and otherwise ignored: the snapshot only saves time. */
export async function writeSnapshot(name: string, val: unknown, opts: Options = {}): Promise<void> {
  const file = fileFor(name, opts.dir ?? tmpdir());
  const partial = `${file}.${process.pid}.tmp`;
  try {
    // Written beside the target and renamed, so a reader never sees half a file.
    await writeFile(partial, JSON.stringify({ at: (opts.now ?? Date.now)(), val }));
    await rename(partial, file);
  } catch (err) {
    log.warn('[sitemap] snapshot not written', { err });
  }
}
