// The shell store's process-wide pieces: the build id, the one store, the run-time switches and the invalidation
// entry points the poke route calls. SERVER-ONLY. The pure parts live in shellPolicy.ts and shellStore.ts.
//
// Run-time switches (no rebuild, restart the app):
//   MOS_SHELL=off              the store is not used at all (every page is rendered, as before)
//   MOS_SHELL_DIR=<dir>        where pages are kept (default: the system temp directory's mos-shells)
//   MOS_SHELL_FRESH_MS=<ms>    overrides every page's lifetime (tests and a quick check of the refresh path)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, runtimeEnv } from './logger';
import { shellKey } from './shellPolicy';
import { createShellStore, type ShellStore } from './shellStore';

const started = Date.now();
let build: string | null = null;

/** The build this process serves. A page is rendered by the server build (its markup, JSON-LD, copy and island keys)
 *  and names the client build's hashed assets, so both identify it, and so does the server's island key (a stored
 *  page's island URLs are encrypted with it). Under `astro dev` there is no build: the process id and start time
 *  stand in, so a restart starts a new set of pages. */
export function shellBuildId(): string {
  build ??= computeBuildId() ?? `dev-${process.pid}-${started}`;
  return build;
}

/** Pure: the build id from the three signatures. The key is only ever hashed (never stored or logged). */
export function buildIdFrom(parts: { client: string; server: string; key: string | undefined }): string {
  const keyHash = parts.key ? createHash('sha1').update(parts.key).digest('hex') : 'no-key';
  return createHash('sha1').update(`${parts.client}\n--\n${parts.server}\n--\n${keyHash}`).digest('hex').slice(0, 16);
}

function computeBuildId(): string | null {
  const client = clientSignature();
  const server = serverSignature();
  if (client === null && server === null) return null;
  // Without ASTRO_KEY, Astro makes a new island key at every start, so the stored island URLs die with the process:
  // then the pages are a new set per start too.
  const key = runtimeEnv('ASTRO_KEY') || `unset-${started}-${process.pid}`;
  return buildIdFrom({ client: client ?? '', server: server ?? '', key });
}

/** Walks up from this module to the built directory that holds `dirName`. */
function builtDir(dirName: string, marker: (dir: string) => boolean): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 5; up++) {
    if (marker(join(dir, dirName))) return join(dir, dirName);
    dir = dirname(dir);
  }
  return null;
}

function clientSignature(): string | null {
  const assets = builtDir('client', (d) => existsSync(join(d, '_astro')));
  if (!assets) return null;
  try {
    const names = readdirSync(join(assets, '_astro')).sort();
    if (names.length === 0) return null;
    return names.map((n) => `${n}:${statSync(join(assets, '_astro', n)).size}`).join('\n');
  } catch {
    return null;
  }
}

/** The server build: the name and the content of every file under it, read once at start (a few MB). A release that
 *  changes only markup or copy changes a file's content, so the id changes with it. */
function serverSignature(): string | null {
  const server = builtDir('server', (d) => existsSync(join(d, 'entry.mjs')));
  if (!server) return null;
  try {
    const files = (readdirSync(server, { recursive: true }) as string[]).filter((f) => statSync(join(server, f)).isFile()).sort();
    const hash = createHash('sha1');
    for (const f of files) {
      hash.update(f);
      hash.update('\0');
      hash.update(readFileSync(join(server, f)));
      hash.update('\0');
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

export function shellEnabled(): boolean {
  return (runtimeEnv('MOS_SHELL') ?? '').trim().toLowerCase() !== 'off';
}

/** The lifetime override from MOS_SHELL_FRESH_MS, or null. */
export function shellFreshOverride(): number | null {
  const n = Number(runtimeEnv('MOS_SHELL_FRESH_MS'));
  return runtimeEnv('MOS_SHELL_FRESH_MS') && Number.isFinite(n) && n >= 0 ? n : null;
}

/** The folder the pages are kept in (MOS_SHELL_DIR, default: the system temp directory's mos-shells). */
export function shellDir(): string {
  return runtimeEnv('MOS_SHELL_DIR') || join(tmpdir(), 'mos-shells');
}

let storePromise: Promise<ShellStore> | null = null;

/** The store, initialised once (old builds removed); null when the store is switched off. Never throws. */
export async function getShell(): Promise<ShellStore | null> {
  if (!shellEnabled()) return null;
  storePromise ??= (async () => {
    const store = createShellStore({
      dir: shellDir(),
      build: shellBuildId(),
      pruneOtherBuilds: true,
    });
    await store.init();
    return store;
  })();
  try {
    return await storePromise;
  } catch (err) {
    log.warn('[shell] store not ready', { err });
    return null;
  }
}

/** Marks the given storefront paths stale (served until re-rendered). */
export async function invalidatePaths(paths: string[]): Promise<boolean> {
  const store = await getShell();
  if (!store) return false;
  await store.invalidate(paths);
  return true;
}

/** Marks every listing and filtered page stale. */
export async function invalidateListings(): Promise<boolean> {
  const store = await getShell();
  if (!store) return false;
  await store.invalidateListings();
  return true;
}

/** Marks every stored product page stale (a bulk change: more paths than one poke can name). */
export async function invalidateProducts(): Promise<boolean> {
  const store = await getShell();
  if (!store) return false;
  await store.invalidateProducts();
  return true;
}

/** Whether the store holds, or is waiting for, a page at this storefront path (false when the store is off). */
export async function knowsPath(path: string): Promise<boolean> {
  const store = await getShell();
  return store ? store.knowsPath(path) : false;
}

/** Drops a stored page without a query (a product that has been deleted or unpublished). */
export async function dropPage(pathname: string): Promise<boolean> {
  const store = await getShell();
  if (!store) return false;
  await store.remove(shellKey(shellBuildId(), pathname, new URLSearchParams()));
  return true;
}
