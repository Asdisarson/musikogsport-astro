// The rendered-page store (plan phase 3): whole HTML pages kept on disk and in memory, keyed by build and URL.
// A stored page is served at once; past its lifetime it is served and re-rendered in the background
// (src/middleware.ts). SERVER-ONLY.
//
// Disk: <dir>/<build>/<sha1(key)>.json, written beside the target and renamed (a reader never sees half a file),
// like lib/sweepSnapshot. A failed write or read is logged and otherwise ignored: the store only saves time.
// Memory: an LRU of pages in front of the disk, and a separate LRU for the memory-only (filtered) URLs.
// Invalidation marks entries stale and keeps them: a stale page is still served while it refreshes.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILTERED_LIMIT, HARD_MAX_AGE_MS, freshness, normalPath, shellKey, type Freshness, type ShellTier } from './shellPolicy';
import { log } from './logger';

export interface ShellEntry {
  key: string;
  path: string;
  tier: ShellTier;
  /** When the page was rendered (ms). */
  at: number;
  freshMs: number;
  status: number;
  headers: [string, string][];
  body: string;
  memoryOnly: boolean;
}

export interface Found {
  entry: ShellEntry;
  state: Exclude<Freshness, 'expired'>;
}

export interface ShellStoreOptions {
  dir: string;
  /** The build this process serves; every key starts with it and only this build's directory is used. */
  build: string;
  now?: () => number;
  /** Disk entries kept per build; the oldest (by file time) go first. */
  maxDisk?: number;
  /** Remove every other build's directory on init() (a deploy leaves the old builds behind otherwise). */
  pruneOtherBuilds?: boolean;
  pageLimit?: number;
  /** Bytes of memory-only (filtered) pages kept, in all. */
  filteredBytes?: number;
}

export interface ShellStore {
  init(): Promise<void>;
  get(key: string, now?: number): Promise<Found | null>;
  put(entry: ShellEntry): Promise<void>;
  remove(key: string): Promise<void>;
  invalidate(paths: string[]): Promise<void>;
  /** Whether a path has a stored page, was marked while none was stored, or has a render running now. */
  knowsPath(path: string): Promise<boolean>;
  /** A render of this path has started. The returned function ends it: call it once the render's page is stored or
   *  refused, so a poke that arrives meanwhile is applied to it (see put, and drops). */
  beginRender(path: string): () => void;
  invalidateListings(): Promise<void>;
  /** Every stored product page is stale (one step, for a bulk change). */
  invalidateProducts(): Promise<void>;
  prune(): Promise<void>;
  /** Resolves once every disk write started so far has finished (tests and the prebuild script). */
  flush(): Promise<void>;
  /** How many paths are marked stale (tests and the poke's log line). */
  markCount(): number;
  /** Pages held in memory (not the filtered ones). */
  memoryCount(): number;
  /** Stored pages of this build on disk, and their bytes (a directory walk: callers cache it). */
  diskStats(): Promise<{ files: number; bytes: number }>;
  /** Drops every stored page of this build, in memory and on disk; returns how many files were removed. */
  clear(): Promise<number>;
}

const PAGE_LIMIT = 120; // a product page is about 0.5 MB: 120 of them is about 60 MB at most
const PRUNE_EVERY = 500;
const LISTINGS = '*listings';
const PRODUCTS = '*products';
/** Marks kept at most, for paths with a stored page: a stranger can name any path of the right shape, so the map is
 *  bounded (oldest go first), and marks for paths with no stored page are kept apart (see `pending`). */
const MARK_LIMIT = 5000;
const PENDING_LIMIT = 2000;
/** The bulk marks: never trimmed (one of them stands for every page of its kind, so the cap cannot be allowed to drop it). */
const isBulk = (k: string) => k === LISTINGS || k === PRODUCTS;
/** A partial file older than this is from a crashed or failed write: prune removes it. A live write takes milliseconds. */
const TMP_MAX_AGE_MS = 10 * 60 * 1000;
/** How long a drop is remembered, so a render that started before it cannot store the page back. Longer than any
 *  page render. */
const DROP_MEMORY_MS = 15 * 60 * 1000;
const FILTERED_BYTES = 64 * 1024 * 1024;

const isListingTier = (tier: ShellTier) => tier === 'listing' || tier === 'filtered';
const weigh = (e: ShellEntry) => Buffer.byteLength(e.body);

function fileFor(key: string): string {
  return `${createHash('sha1').update(key).digest('hex')}.json`;
}

function validEntry(v: unknown): v is ShellEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.key === 'string' &&
    typeof e.path === 'string' &&
    typeof e.at === 'number' &&
    typeof e.freshMs === 'number' &&
    typeof e.status === 'number' &&
    typeof e.body === 'string' &&
    Array.isArray(e.headers) &&
    typeof e.tier === 'string'
  );
}

export function createShellStore(opts: ShellStoreOptions): ShellStore {
  const now = opts.now ?? Date.now;
  const maxDisk = opts.maxDisk ?? 20_000;
  const pageLimit = opts.pageLimit ?? PAGE_LIMIT;
  const buildDir = join(opts.dir, opts.build);
  const filteredBytesLimit = opts.filteredBytes ?? FILTERED_BYTES;
  const pages = new Map<string, ShellEntry>();
  const filtered = new Map<string, ShellEntry>();
  let filteredBytes = 0;
  /** path (or LISTINGS / PRODUCTS) -> when it was marked stale. */
  let marks: Record<string, number> = {};
  /** key -> when it was dropped (kept DROP_MEMORY_MS). */
  const drops = new Map<string, number>();
  /** path -> when it was marked, for paths with no stored page at that time (kept DROP_MEMORY_MS): a render that was
   *  already running when the poke came is marked stale when it is stored (see put). */
  const pending = new Map<string, number>();
  /** path -> renders running now. */
  const rendering = new Map<string, number>();
  const writes = new Set<Promise<unknown>>();
  /** key -> its last disk write (writes of one key run in order; remove waits for them). */
  const inflight = new Map<string, Promise<void>>();
  let writeCount = 0;

  const remember = (map: Map<string, ShellEntry>, limit: number, entry: ShellEntry) => {
    map.delete(entry.key);
    map.set(entry.key, entry);
    while (map.size > limit) map.delete(map.keys().next().value as string);
  };

  const rememberFiltered = (entry: ShellEntry) => {
    const old = filtered.get(entry.key);
    if (old) {
      filtered.delete(entry.key);
      filteredBytes -= weigh(old);
    }
    filtered.set(entry.key, entry);
    filteredBytes += weigh(entry);
    while (filtered.size > FILTERED_LIMIT || filteredBytes > filteredBytesLimit) {
      const k = filtered.keys().next().value as string;
      const gone = filtered.get(k)!;
      filtered.delete(k);
      filteredBytes -= weigh(gone);
    }
  };

  const forgetFiltered = (key: string) => {
    const old = filtered.get(key);
    if (!old) return;
    filtered.delete(key);
    filteredBytes -= weigh(old);
  };

  /** Keeps the marks map bounded: entries past the hard maximum age go, then the oldest past the cap. The bulk marks
   *  are never among them. */
  const trimMarks = (t: number) => {
    for (const [k, v] of Object.entries(marks)) if (!isBulk(k) && t - v > HARD_MAX_AGE_MS) delete marks[k];
    const keys = Object.keys(marks).filter((k) => !isBulk(k));
    if (keys.length > MARK_LIMIT) {
      keys.sort((a, b) => marks[a] - marks[b]);
      for (const k of keys.slice(0, keys.length - MARK_LIMIT)) delete marks[k];
    }
  };

  const writeMarks = async () => {
    try {
      await mkdir(buildDir, { recursive: true });
      const partial = join(buildDir, `invalidated.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
      await writeFile(partial, JSON.stringify(marks));
      await rename(partial, join(buildDir, 'invalidated.json'));
    } catch (err) {
      log.warn('[shell] marks not written', { err });
    }
  };

  // One write running and at most one queued behind it: a flood of pokes costs two writes, not one each.
  let markQueued: Promise<void> | null = null;
  let markChain: Promise<void> = Promise.resolve();
  const saveMarks = (): Promise<void> => {
    if (markQueued) return markQueued;
    const p = markChain.then(async () => {
      markQueued = null; // from here a new save queues behind this one and sees every mark set so far
      await writeMarks();
    });
    markQueued = p;
    markChain = p.catch(() => undefined);
    track(p);
    return p;
  };

  /** Whether a page without a query is stored for this path (in memory or on disk). */
  const hasStoredPage = async (path: string): Promise<boolean> => {
    const key = shellKey(opts.build, path, new URLSearchParams());
    if (pages.has(key)) return true;
    try {
      await access(join(buildDir, fileFor(key)));
      return true;
    } catch {
      return false;
    }
  };

  const withMark = (e: ShellEntry): ShellEntry & { invalidatedAt?: number } => {
    const at = Math.max(
      marks[e.path] ?? -Infinity,
      isListingTier(e.tier) ? (marks[LISTINGS] ?? -Infinity) : -Infinity,
      e.tier === 'product' ? (marks[PRODUCTS] ?? -Infinity) : -Infinity,
    );
    return at === -Infinity ? e : { ...e, invalidatedAt: at };
  };

  const readDisk = async (key: string): Promise<ShellEntry | null> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(buildDir, fileFor(key)), 'utf8'));
      return validEntry(parsed) && parsed.key === key ? parsed : null;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') log.warn('[shell] page not read', { err });
      return null;
    }
  };

  const track = (p: Promise<unknown>) => {
    writes.add(p);
    p.finally(() => writes.delete(p)).catch(() => undefined);
  };

  const store: ShellStore = {
    async init() {
      try {
        await mkdir(buildDir, { recursive: true });
        marks = JSON.parse(await readFile(join(buildDir, 'invalidated.json'), 'utf8')) as Record<string, number>;
      } catch {
        marks = {};
      }
      trimMarks(now());
      if (opts.pruneOtherBuilds) {
        try {
          for (const d of await readdir(opts.dir, { withFileTypes: true })) {
            if (d.isDirectory() && d.name !== opts.build) await rm(join(opts.dir, d.name), { recursive: true, force: true });
          }
        } catch (err) {
          log.warn('[shell] old builds not removed', { err });
        }
      }
    },

    async get(key, at = now()) {
      let entry = pages.get(key) ?? filtered.get(key) ?? null;
      if (!entry) {
        const disk = await readDisk(key);
        // A page rendered before a live drop is the dropped one: not served (the drop's delete may have missed it).
        const dropped = drops.get(key);
        if (!disk || (dropped !== undefined && dropped >= disk.at)) return null;
        entry = disk;
      }
      const state = freshness(withMark(entry), at);
      if (state === 'expired') {
        await store.remove(key);
        return null;
      }
      if (!pages.has(key) && !filtered.has(key)) remember(pages, pageLimit, entry);
      return { entry, state };
    },

    async put(entry) {
      // A drop after this render started wins: the page it rendered may be the one that was dropped.
      const dropped = drops.get(entry.key);
      if (dropped !== undefined && dropped >= entry.at) return;
      if (entry.memoryOnly) {
        rememberFiltered(entry);
        return;
      }
      // Marked after this render started, while no page was stored for the path: the render is stale.
      const np = normalPath(entry.path);
      const poked = pending.get(np);
      if (poked !== undefined && poked >= entry.at) {
        marks[np] = Math.max(marks[np] ?? -Infinity, poked);
        track(saveMarks());
      }
      remember(pages, pageLimit, entry);
      // Writes of one key run one after another. A drop that lands while the write is queued or running wins: the page
      // is not renamed into place, and its partial file is removed.
      const file = join(buildDir, fileFor(entry.key));
      const partial = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      const write = async () => {
        try {
          await mkdir(buildDir, { recursive: true });
          await writeFile(partial, JSON.stringify(entry));
          const dropped = drops.get(entry.key);
          if (dropped !== undefined && dropped >= entry.at) return rm(partial, { force: true });
          await rename(partial, file);
        } catch (err) {
          await rm(partial, { force: true }).catch(() => undefined);
          log.warn('[shell] page not written', { err });
        }
      };
      const p = (inflight.get(entry.key) ?? Promise.resolve()).then(write);
      inflight.set(entry.key, p);
      p.finally(() => {
        if (inflight.get(entry.key) === p) inflight.delete(entry.key);
      }).catch(() => undefined);
      track(p);
      if (++writeCount % PRUNE_EVERY === 0) track(store.prune());
    },

    async remove(key) {
      const t = now();
      drops.set(key, t);
      for (const [k, at] of drops) if (t - at > DROP_MEMORY_MS) drops.delete(k);
      pages.delete(key);
      forgetFiltered(key);
      // A write already queued or running for this key finishes first (it sees the drop and does not rename), so the
      // rm below is the last word on the file.
      await inflight.get(key)?.catch(() => undefined);
      try {
        await rm(join(buildDir, fileFor(key)), { force: true });
      } catch (err) {
        log.warn('[shell] page not removed', { err });
      }
    },

    async invalidate(paths) {
      const t = now();
      for (const raw of paths) {
        const p = normalPath(raw);
        if (await hasStoredPage(p)) {
          marks[p] = t;
        } else {
          pending.delete(p);
          pending.set(p, t);
          while (pending.size > PENDING_LIMIT) pending.delete(pending.keys().next().value as string);
        }
      }
      for (const [k, at] of pending) if (t - at > DROP_MEMORY_MS) pending.delete(k);
      trimMarks(t);
      await saveMarks();
    },

    async knowsPath(path) {
      const p = normalPath(path);
      if (rendering.has(p)) return true;
      const waiting = pending.get(p);
      return (waiting !== undefined && now() - waiting <= DROP_MEMORY_MS) || (await hasStoredPage(p));
    },

    beginRender(path) {
      const p = normalPath(path);
      rendering.set(p, (rendering.get(p) ?? 0) + 1);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        const left = (rendering.get(p) ?? 1) - 1;
        if (left > 0) rendering.set(p, left);
        else rendering.delete(p);
      };
    },

    async invalidateListings() {
      marks[LISTINGS] = now();
      await saveMarks();
    },

    async invalidateProducts() {
      marks[PRODUCTS] = now();
      await saveMarks();
    },

    markCount() {
      return Object.keys(marks).length;
    },

    memoryCount() {
      return pages.size;
    },

    async diskStats() {
      let files = 0;
      let bytes = 0;
      try {
        for (const n of await readdir(buildDir)) {
          if (!n.endsWith('.json') || n === 'invalidated.json') continue;
          const at = await stat(join(buildDir, n)).catch(() => null);
          if (at) {
            files += 1;
            bytes += at.size;
          }
        }
      } catch {
        // no folder yet: nothing is stored
      }
      return { files, bytes };
    },

    async clear() {
      // Writes already queued finish first, so none of them lands after the removal below.
      await store.flush();
      pages.clear();
      filtered.clear();
      filteredBytes = 0;
      pending.clear();
      let removed = 0;
      let names: string[] = [];
      try {
        names = await readdir(buildDir);
      } catch {
        return 0;
      }
      for (const n of names) {
        if (!n.endsWith('.json') || n === 'invalidated.json') continue;
        try {
          await rm(join(buildDir, n), { force: true });
          removed += 1;
        } catch (err) {
          log.warn('[shell] page not removed', { err });
        }
      }
      return removed;
    },

    async prune() {
      try {
        const cutoff = Date.now() - TMP_MAX_AGE_MS;
        for (const n of (await readdir(buildDir)).filter((f) => f.endsWith('.tmp'))) {
          const at = await stat(join(buildDir, n)).catch(() => null);
          if (at && at.mtimeMs < cutoff) await rm(join(buildDir, n), { force: true });
        }
        const names = (await readdir(buildDir)).filter((n) => n.endsWith('.json') && n !== 'invalidated.json');
        if (names.length <= maxDisk) return;
        const dated = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(buildDir, n))).mtimeMs })));
        dated.sort((a, b) => a.t - b.t);
        for (const { n } of dated.slice(0, names.length - maxDisk)) await rm(join(buildDir, n), { force: true });
      } catch (err) {
        log.warn('[shell] prune failed', { err });
      }
    },

    async flush() {
      while (writes.size) await Promise.allSettled([...writes]);
    },
  };
  return store;
}
