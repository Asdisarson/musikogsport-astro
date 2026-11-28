// The photo cache's process-wide pieces, as src/lib/shellRuntime.ts holds the page store's: the cache folder, the visitor's
// conversion gate, and a SEPARATE gate for the nightly warm-up, so a run can never fill the queue a visitor waits in. The
// /img/ route imports them; the pure parts live in imgConvert.ts and imgWarm.ts. SERVER-ONLY.
//
// Run-time switch: MOS_IMG_CACHE_DIR=<dir>  where converted photos are kept (default: the system temp directory's mos-img).
// The temp folder is emptied on a reboot, so a site that warms photos should set a durable folder (DEPLOY.md).
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { LIGHT_VERSION } from './img';
import { CONCURRENCY, MAX_WAITING, createGate, makeLight, type LightRequest } from './imgConvert';
import { NOT_ATTEMPTED, createSlots, warmPhotos, type WarmTally } from './imgWarm';
import { log, runtimeEnv } from './logger';
import { shellDir } from './shellRuntime';

/** The folder converted photos are kept in, the root (MOS_IMG_CACHE_DIR or the temp folder). */
export const IMG_ROOT = runtimeEnv('MOS_IMG_CACHE_DIR') || join(tmpdir(), 'mos-img');
/** One folder per LIGHT_VERSION, so pictures made the old way are never served under a new URL. */
export const IMG_DIR = join(IMG_ROOT, LIGHT_VERSION);

/** The two file system calls the overlap check makes (injected, so a test can stand in a volume). */
export interface PathFs {
  realpathSync(p: string): string;
  statSync(p: string): { dev: number; ino: number };
}

/** The real file system. */
const REAL_FS: PathFs = { realpathSync, statSync };

/** The path with symlinks resolved. A folder that does not exist yet is resolved through its nearest existing ancestor,
 *  and its missing tail is re-appended. Never throws: a path that cannot be resolved is taken as written. */
function realPathOf(p: string, fs: PathFs): string {
  const abs = resolve(p);
  let cur = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(fs.realpathSync(cur), ...tail);
    } catch {
      const up = dirname(cur);
      if (up === cur) return abs;
      tail.unshift(cur.slice(up.length).replace(/^[\\/]+/, ''));
      cur = up;
    }
  }
}

/** Whether the volume of `path` folds case: its nearest existing ancestor, with its letters flipped, names the same
 *  folder. A path with no letters proves nothing, so it does not fold. Never throws. */
function foldsCase(path: string, fs: PathFs): boolean {
  let cur = resolve(path);
  for (;;) {
    try {
      cur = fs.realpathSync(cur);
      break;
    } catch {
      const up = dirname(cur);
      if (up === cur) return false;
      cur = up;
    }
  }
  const flipped = cur.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  if (flipped === cur) return false;
  try {
    const a = fs.statSync(cur);
    const b = fs.statSync(flipped);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

/** True when `imgRoot` is `shellFolder` itself or inside it. Both are compared as the disk resolves them (symlinks followed,
 *  a missing folder through its existing ancestor), and case-only differences count as the same folder on a volume that
 *  folds case. The page store wipes every sibling folder under its own folder when it opens (shellStore pruneOtherBuilds),
 *  so photos kept there would be lost. `fs` is injected for tests. */
export function imgRootInShellFolder(imgRoot: string, shellFolder: string, fs: PathFs = REAL_FS): boolean {
  let root = realPathOf(imgRoot, fs);
  let shell = realPathOf(shellFolder, fs);
  if (foldsCase(shell, fs)) {
    root = root.toLowerCase();
    shell = shell.toLowerCase();
  }
  const rel = relative(shell, root);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The photo folder is where the page store would wipe it (see imgRootInShellFolder). Decided once, when this module
 *  loads (startup of the process that makes photos), and logged once as an error then. The warm-up makes nothing while it holds. */
export const PHOTO_FOLDER_IN_SHELL = imgRootInShellFolder(IMG_ROOT, shellDir());
if (PHOTO_FOLDER_IN_SHELL) {
  log.error('[photos] the photo folder is the page store folder or inside it; the page store would delete the photos. The warm-up makes none. Set MOS_IMG_CACHE_DIR to another folder.', {
    imgRoot: IMG_ROOT,
    shellDir: shellDir(),
  });
}

/** The warm-up's conversions in flight across every page at once: the warm gate's own width, so a conversion never waits in
 *  its gate (and so not inside makeLight's timeout), whichever pages are warming. */
const warmSlots = createSlots(CONCURRENCY);

/** Where the photos are kept, for the admin page: durable when MOS_IMG_CACHE_DIR is set, else temp. */
export function imgFolderKind(): 'durable' | 'temp' {
  return runtimeEnv('MOS_IMG_CACHE_DIR') ? 'durable' : 'temp';
}

/** The visitors' conversion queue (the /img/ route). */
export const visitorGate = createGate(CONCURRENCY, MAX_WAITING);
/** The nightly warm-up's queue: its own, so a run's photos never take a visitor's place in line. */
export const warmGate = createGate(CONCURRENCY, MAX_WAITING);

/** Makes the photos a rendered page asks for (the warm-up of one page), through the warm gate. Logs one line when some
 *  failed; never throws. `origin` is the WordPress origin the originals come from (WP_INTERNAL_URL). */
export async function warmPageHtml(
  requests: LightRequest[],
  origin: string,
  stop: () => boolean,
): Promise<WarmTally> {
  // A photo folder the page store would wipe is not filled: nothing is counted (the run says it made none).
  if (PHOTO_FOLDER_IN_SHELL) return { converted: 0, kept: 0, failed: 0 };
  const tally = await warmPhotos(requests, {
    dir: IMG_DIR,
    stat: async (file) => {
      try {
        return (await stat(file)).isFile();
      } catch {
        return false;
      }
    },
    // stop is checked again once the slot is held: a photo that waited for it is not started after a stop.
    convert: (req, stopped) => warmSlots(async () => (stopped() ? NOT_ATTEMPTED : makeLight(req, { origin, dir: IMG_DIR, gate: warmGate }))),
    stop,
    parallel: CONCURRENCY,
  });
  if (tally.failed > 0) log.warn('[photos] some photos were not made', { failed: tally.failed });
  return tally;
}
