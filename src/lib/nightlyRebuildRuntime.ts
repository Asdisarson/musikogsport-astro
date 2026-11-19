// The nightly rebuild's process side: arms one timer per process (from the middleware's first request), keeps the
// stamp file of the last run beside the store's files, and runs the walk (src/lib/nightlyRebuild.ts). Each path is
// invalidated just before the walk requests it, so the store never holds more stale pages than the walk is at.
// SERVER-ONLY.
//
// Run-time switches (see DEPLOY.md, "Nightly rebuild"):
//   MOS_SHELL_REBUILD_AT=<HH:MM|off>     default 05:00 (Atlantic/Reykjavik); off disables the nightly rebuild
//   MOS_SHELL_REBUILD_BASE=<origin>      the origin the walk requests; default https://<first MOS_EXTRA_ALLOWED_HOSTS host>
//   MOS_SHELL_REBUILD_CONCURRENCY=<1..4> default 2: pages walked at once (one while the walk is degraded)
//   MOS_SHELL_REBUILD_PAUSE_MS=<0..30000> default 100: the base pause between renders
//   MOS_SHELL=off, or no origin, means nothing is armed.
//
// The timer lives in the process: a process that is not running at 05:00 runs nothing until a request reaches it
// (within CATCH_UP_MS of 05:00, or the run is missed for the day; see DEPLOY.md).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sitemapPathsFrom } from '../../scripts/prebuild_shells.mjs';
import { log, runtimeEnv } from './logger';
import {
  WALK_DEFAULTS,
  formatAt,
  isWalkablePath,
  missedRun,
  msUntilNextRun,
  parseConcurrency,
  parsePauseMs,
  parseRebuildAt,
  rebuildOrigin,
  runDue,
  walkStorefront,
  type WalkOptions,
  type WalkTally,
} from './nightlyRebuild';
import { beginRun, endRun, isRunning, lastRun, recordStep, requestStop, setRunConcurrency, setRunTotal, stopRequested, type StopWhy } from './nightlyRebuildState';
import { getShell, invalidatePaths, shellDir, shellEnabled } from './shellRuntime';

const STAMP = 'nightly-rebuild.json';
const MAX_TIMER_MS = 2 ** 31 - 1;
const SITEMAP_TIMEOUT_MS = 20_000;
/** A probe gives up after this long (no headers, or a render that never ends): the walk gives up on a page at the same
 *  point (WALK_DEFAULTS.maxWaitMs), so one hung render delays a stop by this much at most, not Node's five minutes. */
export const PROBE_TIMEOUT_MS = 90_000;

/** The stamp of the last run: when it started, and when it ended (null while it runs, or when the process died in it;
 *  absent in a stamp written before lastEnd existed, which is not read as unfinished). */
export interface RebuildStamp {
  lastStart: number;
  lastEnd?: number | null;
}

/** What a run touches outside the walk: the store, the stamp and the network. Tests replace these. */
export interface RunIo {
  /** Whether the shell store is there to walk (false when it is off or cannot be opened). */
  storeReady(): Promise<boolean>;
  /** Marks one path stale; throws when the store is not there. */
  invalidatePath(path: string): Promise<void>;
  readStamp(): Promise<RebuildStamp | null>;
  writeStamp(stamp: RebuildStamp): Promise<void>;
  fetchSitemap(origin: string): Promise<string>;
  probe(origin: string, path: string): Promise<{ status: number; shell: string | null; refreshing: boolean }>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const stampFile = () => join(shellDir(), STAMP);

const defaultIo: RunIo = {
  async storeReady() {
    return (await getShell()) !== null;
  },
  async invalidatePath(path) {
    if (!(await invalidatePaths([path]))) throw new Error('the shell store is not available');
  },
  async readStamp() {
    try {
      const v = JSON.parse(await readFile(stampFile(), 'utf8')) as { lastStart?: unknown; lastEnd?: unknown };
      if (typeof v.lastStart !== 'number') return null;
      return { lastStart: v.lastStart, lastEnd: v.lastEnd === undefined ? undefined : typeof v.lastEnd === 'number' ? v.lastEnd : null };
    } catch {
      return null;
    }
  },
  async writeStamp(stamp) {
    try {
      await mkdir(shellDir(), { recursive: true });
      const partial = `${stampFile()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(partial, JSON.stringify(stamp));
      await rename(partial, stampFile());
    } catch (err) {
      log.warn('[rebuild] stamp not written', { err });
    }
  },
  async fetchSitemap(origin) {
    const res = await fetch(`${origin}/sitemap.xml`, { redirect: 'manual', signal: AbortSignal.timeout(SITEMAP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`sitemap answered ${res.status}`);
    return res.text();
  },
  async probe(origin, path) {
    try {
      // The path only: the origin is the one this run was given, and a redirect is not followed. A probe the walk has
      // given up on may still be rendering on the server beside the next path; PROBE_TIMEOUT_MS keeps that window short.
      const res = await fetch(origin + path, {
        redirect: 'manual',
        headers: { 'User-Agent': 'mos-nightly-rebuild' },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await res.arrayBuffer();
      return { status: res.status, shell: res.headers.get('x-mos-shell'), refreshing: res.headers.get('x-mos-refresh') === 'running' };
    } catch {
      return { status: 0, shell: null, refreshing: false };
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** When the last run started (from the stamp at arm time, then from each run). */
let lastStart: number | null = null;
let armed = false;
let schedule: { minutes: number; origin: string } | null = null;

/** The walk's workers and base pause from the environment, with a problem line for each value that could not be read. */
export function walkEnv(): { concurrency: number; pauseMs: number; problems: string[] } {
  const c = parseConcurrency(runtimeEnv('MOS_SHELL_REBUILD_CONCURRENCY'));
  const p = parsePauseMs(runtimeEnv('MOS_SHELL_REBUILD_PAUSE_MS'));
  return { concurrency: c.value, pauseMs: p.value, problems: [c.problem, p.problem].filter((x): x is string => x !== null) };
}

/** Whether a walk is running now (the admin page's "Keyra núna" is refused meanwhile). */
export function nightlyRunning(): boolean {
  return isRunning();
}

/** Asks the running walk to stop before its next path. False when none is running. */
export function stopNightlyRebuild(): boolean {
  return requestStop();
}

/** When the last run started (from the stamp at arm time, then from each run); null when there is none on record. */
export function lastNightlyStart(): number | null {
  return lastStart;
}

/** When the last run in this process ended; null while one runs, or none has ended here. */
export function lastNightlyEnd(): number | null {
  return lastRun()?.endedAt ?? null;
}

/** One walk: check the store, stamp the start, read the sitemap, walk it (each path invalidated just before its
 *  request), stamp the end. Never throws; the end is logged with its tally and kept for the admin page. Returns null
 *  when it did not run (another run is in progress, or the store is not there) or stopped on an error. */
export async function runNightlyRebuild(origin: string, options: Partial<WalkOptions> = {}, io: Partial<RunIo> = {}): Promise<WalkTally | null> {
  const d: RunIo = { ...defaultIo, ...io };
  const env = walkEnv();
  const started = d.now();
  // Synchronous up to here: a second call in the same tick is refused, not queued.
  if (!beginRun(started)) {
    log.warn('[rebuild] skipped: the previous run is still in progress');
    return null;
  }
  let begun = false;
  let errored = false;
  let tally: WalkTally | null = null;
  try {
    if (!(await d.storeReady())) {
      log.warn('[rebuild] skipped: the shell store is not available');
      return null;
    }
    lastStart = started;
    begun = true;
    await d.writeStamp({ lastStart: started, lastEnd: null });
    log.info('[rebuild] started', { base: origin });
    const paths = sitemapPathsFrom(await d.fetchSitemap(origin));
    setRunTotal(paths.filter(isWalkablePath).length);
    log.info('[rebuild] sitemap read', { pages: paths.length });
    const walk: WalkOptions = { ...WALK_DEFAULTS, concurrency: env.concurrency, delayMs: env.pauseMs, ...options };
    setRunConcurrency(walk.concurrency);
    tally = await walkStorefront(paths, walk, {
      before: (path) => d.invalidatePath(path),
      get: (path) => d.probe(origin, path),
      sleep: d.sleep,
      now: d.now,
      progress: (t) => log.info('[rebuild] progress', { ...t }),
      stop: stopRequested,
      step: (s) => recordStep({ path: s.path, status: s.status, bad: s.bad, at: s.at, pauseMs: s.pauseMs, workers: s.workers, tally: s.tally }),
    });
    const fields = { ...tally, ms: d.now() - started };
    if (tally.failures > 0 || tally.stoppedEarly) log.warn('[rebuild] finished', fields);
    else log.info('[rebuild] finished', fields);
    return tally;
  } catch (err) {
    errored = true;
    log.warn('[rebuild] stopped', { err, ms: d.now() - started });
    return null;
  } finally {
    if (begun) await d.writeStamp({ lastStart: started, lastEnd: d.now() });
    const why: StopWhy | null = errored ? 'error' : tally?.stoppedBy ?? null;
    endRun({
      endedAt: d.now(),
      record: begun,
      tally: tally ?? undefined,
      stoppedEarly: tally?.stoppedEarly ?? errored,
      stoppedWhy: begun ? why : null,
    });
  }
}

/** The origin a run walks, from the environment (MOS_SHELL_REBUILD_BASE, else the first MOS_EXTRA_ALLOWED_HOSTS host). */
export function rebuildBase(): { origin: string | null; problem: string | null } {
  return rebuildOrigin(runtimeEnv('MOS_SHELL_REBUILD_BASE'), runtimeEnv('MOS_EXTRA_ALLOWED_HOSTS') || (import.meta.env.MOS_BUILD_EXTRA_HOSTS as string | undefined));
}

/** Whether the timer is armed in this process (it arms on the first request; see armNightlyRebuild). */
export function scheduleArmed(): boolean {
  return schedule !== null;
}

/** Arms the nightly rebuild once per process. Safe to call on every request; only the first call does anything. */
export function armNightlyRebuild(): void {
  if (armed) return;
  armed = true;
  void arm().catch((err) => log.warn('[rebuild] not armed', { err }));
}

async function arm(): Promise<void> {
  if (!shellEnabled()) return;
  const at = parseRebuildAt(runtimeEnv('MOS_SHELL_REBUILD_AT'));
  if (at.problem) log.warn(`[rebuild] ${at.problem}`);
  for (const problem of walkEnv().problems) log.warn(`[rebuild] ${problem}`);
  if (at.at.kind === 'off') return;
  const base = rebuildBase();
  if (base.problem) log.warn(`[rebuild] ${base.problem}`);
  if (!base.origin) return;
  schedule = { minutes: at.at.minutes, origin: base.origin };
  const stamp = await defaultIo.readStamp();
  lastStart = stamp?.lastStart ?? null;
  // A stamp that never got its end: the process stopped during that run. It is not resumed; the walk starts again
  // only when it is due (the next run, or this one if still within CATCH_UP_MS).
  if (stamp && stamp.lastEnd === null) log.warn('[rebuild] the last run did not finish (the process stopped during it); it is not resumed', { lastStart: stamp.lastStart });
  const now = Date.now();
  if (missedRun(now, at.at.minutes, lastStart)) log.warn('[rebuild] the run due today was missed: no process was up within the catch-up window (see DEPLOY.md)', { at: formatAt(at.at.minutes) });
  log.info('[rebuild] armed', { at: formatAt(at.at.minutes), base: base.origin });
  tick(); // a run missed while the process was down (within CATCH_UP_MS of its time) starts now
}

/** Starts the run when one is due, then arms the timer for the next time. A due run while one is still going is
 *  skipped with a log line. */
function tick(): void {
  if (!schedule) return;
  const now = Date.now();
  if (runDue(now, schedule.minutes, lastStart)) {
    if (isRunning()) log.warn('[rebuild] due while the previous run is still in progress: skipped');
    else void runNightlyRebuild(schedule.origin);
  }
  const wait = Math.min(MAX_TIMER_MS, msUntilNextRun(now, schedule.minutes));
  setTimeout(tick, wait).unref();
}
