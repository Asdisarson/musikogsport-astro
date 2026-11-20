// The body and the status of the admin endpoint (src/pages/api/shell-admin.ts), which the WordPress page "Síðugeymsla"
// (wp-mu-plugins/mos-shell-admin.php) reads and drives. Pure: the clock, the store and the walk are passed in, so the
// parsing, the shape of the status and the cache are tested without a server. SERVER-ONLY by use.
import { parseShellPoke } from './shellPoke';
import type { FailureEntry, RunView } from './nightlyRebuildState';
import type { ScheduleWhy } from './nightlyRebuild';
import { estimateMs, perPage, type NightlySettings, type RunRecord, type SavedSettings, type SettingKey, type SettingSource } from './nightlySettings';

export type ShellAdminAction =
  | { action: 'run' | 'stop' | 'clear' }
  | { action: 'refresh'; path: string }
  | { action: 'settings'; settings: unknown };

/** The POST body {action} (and {path} for "refresh", {settings} for "settings", where null drops the saved copy), or null
 *  when it is not one of this shape. The path takes the same rule as the poke route (src/lib/shellPoke.ts): a storefront
 *  product or category path, nothing else. The settings are checked by validateSettings, not here. */
export function parseShellAdminAction(body: unknown): ShellAdminAction | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const action = b.action;
  if (action === 'run' || action === 'stop' || action === 'clear') return { action };
  if (action === 'settings') {
    if (!('settings' in b)) return null;
    return { action: 'settings', settings: b.settings === undefined ? null : b.settings };
  }
  if (action === 'refresh') {
    if (typeof b.path !== 'string') return null;
    const poke = parseShellPoke({ stale: [b.path] });
    if (!poke || poke.stale.length !== 1) return null;
    return { action: 'refresh', path: poke.stale[0] };
  }
  return null;
}

/** The freshness settings the store works by (src/lib/shellPolicy.ts), in ms. */
export interface FreshSettings {
  productMs: number;
  contentMs: number;
  listingMs: number;
  filteredMs: number;
  hardMaxMs: number;
  /** MOS_SHELL_FRESH_MS when set, which overrides every lifetime above; null otherwise. */
  overrideMs: number | null;
}

export interface ShellAdminInput {
  now: number;
  store: {
    on: boolean;
    /** The full build id (only its first 8 characters are shown); null when the store is off. */
    build: string | null;
    folder: 'durable' | 'temp' | null;
    pagesInMemory: number;
    disk: { files: number; bytes: number; at: number } | null;
    fresh: FreshSettings;
  };
  scheduler: {
    why: ScheduleWhy | null;
    /** "HH:MM" of the nightly run, or null when it is off. */
    at: string | null;
    hasBase: boolean;
    /** The next scheduled start (ms) while the nightly rebuild is armed or waiting to be; null otherwise. */
    nextRunAt: number | null;
    /** The stamp of the last run that started, and of its end (null while it runs or the process died in it). */
    lastStart: number | null;
    lastEnd: number | null;
    /** The start of a run that never ended (the process stopped during it, and no run has started since): it is not
     *  in the run record, so the last run shown there may be an older one. Null otherwise. */
    unfinishedStart: number | null;
  };
  /** The effective settings, where each comes from, the saved copy (null when none), and the last runs (newest first). */
  settings: {
    effective: NightlySettings;
    source: Record<SettingKey, SettingSource>;
    saved: SavedSettings | null;
  };
  runs: RunRecord[];
  run: RunView;
  failures: FailureEntry[];
}

/** One finished run, as the status shows it: the tally, the way it ended and the measured per-page time. */
export interface RunStatus {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  total: number | null;
  visited: number;
  hits: number;
  rendered: number;
  gone: number;
  failures: number;
  stoppedEarly: boolean;
  stoppedWhy: string | null;
  concurrency: number | null;
  /** Measured average ms per visited page; null when the run visited none or took no time. */
  msPerPage: number | null;
  pagesPerMinute: number | null;
}

/** The status JSON (GET /api/shell-admin). Field names are the contract the WordPress page reads. */
export interface ShellAdminStatus {
  ok: true;
  at: number;
  store: {
    on: boolean;
    build: string | null;
    folder: 'durable' | 'temp' | null;
    pagesInMemory: number;
    pagesOnDisk: number | null;
    diskBytes: number | null;
    diskAt: number | null;
    fresh: FreshSettings;
  };
  scheduler: {
    armed: boolean;
    why: ScheduleWhy | null;
    at: string | null;
    hasBase: boolean;
    nextRunAt: number | null;
    lastStart: number | null;
    lastEnd: number | null;
    /** The start of an interrupted run (see ShellAdminInput); null otherwise. */
    unfinishedStart: number | null;
  };
  run: {
    /** A walk is going. False while a clear holds the slot. */
    running: boolean;
    /** A clear of the page store holds the run slot now (no walk is going). */
    clearing: boolean;
    startedAt: number | null;
    total: number | null;
    visited: number;
    hits: number;
    rendered: number;
    gone: number;
    failures: number;
    pauseMs: number | null;
    lastPath: string | null;
    stopRequested: boolean;
    /** Workers in use now (1 while the walk is degraded); null when no run is going. */
    workers: number | null;
    /** The configured workers (MOS_SHELL_REBUILD_CONCURRENCY); null when no run is going. */
    concurrency: number | null;
  };
  settings: {
    effective: NightlySettings;
    source: Record<SettingKey, SettingSource>;
    /** The saved copy, or null when none is saved (the WordPress page compares its option with this). */
    saved: SavedSettings | null;
    /** The estimated duration (ms) of a run of every page at the effective concurrency, from the last run's measured time
     *  per page; null when there is no last run to measure from. */
    estimateMs: number | null;
  };
  /** The last run (the newest of recentRuns), or null. */
  lastRun: RunStatus | null;
  /** The last 7 runs, newest first. */
  recentRuns: RunStatus[];
  failures: { path: string; status: number; at: number }[];
}

function runStatus(r: RunRecord): RunStatus {
  const p = perPage(r);
  return {
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    total: r.total,
    visited: r.visited,
    hits: r.hits,
    rendered: r.rendered,
    gone: r.gone,
    failures: r.failures,
    stoppedEarly: r.stoppedEarly,
    stoppedWhy: r.stoppedWhy,
    concurrency: r.concurrency,
    msPerPage: p.msPerPage,
    pagesPerMinute: p.pagesPerMinute,
  };
}

/** The status, as JSON-ready data. Pure. */
export function buildShellAdminStatus(i: ShellAdminInput): ShellAdminStatus {
  const r = i.run;
  return {
    ok: true,
    at: i.now,
    store: {
      on: i.store.on,
      build: i.store.build ? i.store.build.slice(0, 8) : null,
      folder: i.store.folder,
      pagesInMemory: i.store.pagesInMemory,
      pagesOnDisk: i.store.disk?.files ?? null,
      diskBytes: i.store.disk?.bytes ?? null,
      diskAt: i.store.disk?.at ?? null,
      fresh: { ...i.store.fresh },
    },
    scheduler: {
      armed: i.scheduler.why === null,
      why: i.scheduler.why,
      at: i.scheduler.at,
      hasBase: i.scheduler.hasBase,
      nextRunAt: i.scheduler.nextRunAt,
      lastStart: i.scheduler.lastStart,
      lastEnd: i.scheduler.lastEnd,
      unfinishedStart: i.scheduler.unfinishedStart,
    },
    settings: {
      effective: { ...i.settings.effective },
      source: { ...i.settings.source },
      saved: i.settings.saved ? { ...i.settings.saved } : null,
      estimateMs: estimateMs(i.runs[0] ?? null, i.settings.effective.concurrency),
    },
    run: {
      running: r.running,
      clearing: r.clearing,
      startedAt: r.startedAt,
      total: r.total,
      visited: r.visited,
      hits: r.hits,
      rendered: r.rendered,
      gone: r.gone,
      failures: r.failures,
      pauseMs: r.pauseMs,
      lastPath: r.lastPath,
      stopRequested: r.stopRequested,
      workers: r.workers,
      concurrency: r.concurrency,
    },
    lastRun: i.runs[0] ? runStatus(i.runs[0]) : null,
    recentRuns: i.runs.map(runStatus),
    failures: i.failures.map((f) => ({ path: f.path, status: f.status, at: f.at })),
  };
}

/** A value computed at most once per `ttlMs`, shared by concurrent callers (one load in flight at a time). A failed load
 *  keeps the previous value and is tried again at the next call. */
export interface TtlCache<T> {
  get(): Promise<{ value: T; at: number } | null>;
  invalidate(): void;
}

export function createTtlCache<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  let held: { value: T; at: number } | null = null;
  let inflight: Promise<{ value: T; at: number } | null> | null = null;
  // Bumped by invalidate: a load started before it may still resolve, but it must not fill the cache with its old value.
  let epoch = 0;
  return {
    get() {
      if (held && now() - held.at < ttlMs) return Promise.resolve(held);
      if (inflight) return inflight;
      const started = epoch;
      const p: Promise<{ value: T; at: number } | null> = load()
        .then((value) => {
          const entry = { value, at: now() };
          if (started === epoch) held = entry;
          return entry;
        })
        .catch(() => held)
        .finally(() => {
          if (inflight === p) inflight = null;
        });
      inflight = p;
      return p;
    },
    invalidate() {
      held = null;
      inflight = null;
      epoch += 1;
    },
  };
}
