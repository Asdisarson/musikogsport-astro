// The nightly rebuild's process side: arms one timer per process (from the middleware's first production request), keeps
// the stamp file of the last run beside the store's files, keeps the saved settings and the last runs in one persisted
// file, and runs the walk (src/lib/nightlyRebuild.ts). Each path is invalidated just before the walk requests it, so the
// store never holds more stale pages than the walk is at. SERVER-ONLY.
//
// Settings (see DEPLOY.md, "Nightly rebuild"): the WordPress page saves them and sends them to POST /api/shell-admin
// (action "settings"). A saved field wins; a field not saved falls back to the environment, then to the default:
//   MOS_SHELL_REBUILD_AT=<HH:MM|off>     default 05:00 (Atlantic/Reykjavik); off disables the nightly rebuild
//   MOS_SHELL_REBUILD_BASE=<origin>      the origin the walk requests; default https://<first MOS_EXTRA_ALLOWED_HOSTS host>
//   MOS_SHELL_REBUILD_CONCURRENCY=<1..4> default 2: pages walked at once (one while the walk is degraded)
//   MOS_SHELL_REBUILD_PAUSE_MS=<0..30000> default 100: the base pause between renders
//   MOS_SHELL=off, or no origin, means nothing is armed.
//
// The timer lives in the process: a process that is not running at the time runs nothing until a request reaches it
// (within the catch-up window of the time, or the run is missed for the day; see DEPLOY.md).
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
  rebuildOrigin,
  runDue,
  CATCH_UP_MS,
  ON_TIME_GRACE_MS,
  walkStorefront,
  type WalkOptions,
  type WalkTally,
} from './nightlyRebuild';
import {
  envDefaults,
  mergeSettings,
  parseStored,
  RUNS_KEPT,
  validateSettings,
  type NightlySettings,
  type RunRecord,
  type SavedSettings,
  type SettingKey,
  type SettingSource,
} from './nightlySettings';
import { beginRun, endRun, isClearing, isRunning, lastRun, recordStep, requestStop, setRunConcurrency, setRunTotal, stopRequested, type StopWhy } from './nightlyRebuildState';
import { getShell, invalidatePaths, shellDir, shellEnabled } from './shellRuntime';

/** The origin a run walks, from the environment (MOS_SHELL_REBUILD_BASE, else the first MOS_EXTRA_ALLOWED_HOSTS host). */
export function rebuildBase(): { origin: string | null; problem: string | null } {
  return rebuildOrigin(runtimeEnv('MOS_SHELL_REBUILD_BASE'), runtimeEnv('MOS_EXTRA_ALLOWED_HOSTS') || (import.meta.env.MOS_BUILD_EXTRA_HOSTS as string | undefined));
}

const STAMP = 'nightly-rebuild.json';
const SETTINGS_FILE = 'nightly-settings.json';
const MAX_TIMER_MS = 2 ** 31 - 1;
/** A due walk that finds a clear holding the slot is tried again after this (a clear is short, and the walk is due
 *  until its window ends; moving it to tomorrow would lose the night). */
const CLEAR_RETRY_MS = 60 * 1000;
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

/** What a run touches outside the walk: the store, the stamp, the settings file and the network. Tests replace these. */
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
  /** The persisted settings file (the saved settings and the last runs). */
  settings: SettingsIo;
}

/** The persisted file: { settings, runs }. Written whole, through one writer (see persistStored). */
export interface SettingsIo {
  read(): Promise<unknown>;
  write(data: unknown): Promise<void>;
}

const stampFile = () => join(shellDir(), STAMP);
const settingsFile = () => join(shellDir(), SETTINGS_FILE);

const defaultSettingsIo: SettingsIo = {
  async read() {
    try {
      return JSON.parse(await readFile(settingsFile(), 'utf8')) as unknown;
    } catch (err) {
      // A missing file is the first run's normal state; anything else (unreadable, not JSON) is logged, so the fall back
      // to the environment is not silent.
      if ((err as { code?: string }).code !== 'ENOENT') log.warn('[rebuild] settings file not read; the environment applies', { err });
      return null;
    }
  },
  async write(data) {
    await mkdir(shellDir(), { recursive: true });
    const partial = `${settingsFile()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(partial, JSON.stringify(data));
    await rename(partial, settingsFile());
  },
};

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
      return {
        status: res.status,
        shell: res.headers.get('x-mos-shell'),
        refreshing: res.headers.get('x-mos-refresh') === 'running',
        // The raw header: a 429 backs the walk off for as long as it asks (nightlyRebuild parseRetryAfter).
        retryAfter: res.headers.get('retry-after'),
      };
    } catch {
      return { status: 0, shell: null, refreshing: false, retryAfter: null };
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  settings: defaultSettingsIo,
};

// ---- the persisted settings and runs: one in-memory copy, loaded once, written through one serialized writer ----

let persisted: { saved: SavedSettings | null; runs: RunRecord[] } | null = null;
let loading: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();

/** Loads the persisted file once per process (the first caller's io). Problems in it are logged, and the bad values dropped. */
function loadStored(io: SettingsIo): Promise<void> {
  loading ??= (async () => {
    const p = parseStored(await io.read());
    for (const problem of p.problems) log.warn(`[rebuild] saved setting dropped: ${problem}`);
    persisted = { saved: p.saved, runs: p.runs };
  })();
  return loading;
}

/** Writes the whole persisted file. Writes are queued one after another, so two never overlap; true when this one landed. */
function persistStored(io: SettingsIo): Promise<boolean> {
  const snapshot = { settings: persisted?.saved ?? null, runs: persisted?.runs ?? [] };
  const job = writeChain.then(async () => {
    try {
      await io.write(snapshot);
      return true;
    } catch (err) {
      log.warn('[rebuild] settings not written', { err });
      return false;
    }
  });
  writeChain = job.then(() => undefined);
  return job;
}

/** The environment's values, with the saved ones over them (see src/lib/nightlySettings.ts). */
function nightlyEffective(): { values: NightlySettings; source: Record<SettingKey, SettingSource> } {
  const env = envDefaults({
    at: runtimeEnv('MOS_SHELL_REBUILD_AT'),
    concurrency: runtimeEnv('MOS_SHELL_REBUILD_CONCURRENCY'),
    pauseMs: runtimeEnv('MOS_SHELL_REBUILD_PAUSE_MS'),
  });
  return mergeSettings(env.values, persisted?.saved ?? null);
}

/** The settings as the status shows them: the effective values, where each comes from, the saved copy and the last runs. */
export async function nightlySettingsView(): Promise<{
  effective: NightlySettings;
  source: Record<SettingKey, SettingSource>;
  saved: SavedSettings | null;
  runs: RunRecord[];
}> {
  await loadStored(defaultSettingsIo);
  const e = nightlyEffective();
  return { effective: e.values, source: e.source, saved: persisted?.saved ?? null, runs: (persisted?.runs ?? []).map((r) => ({ ...r })) };
}

/** The walk's workers and base pause as they are now (saved, else environment, else default). */
function walkSettings(): { concurrency: number; pauseMs: number } {
  const e = nightlyEffective().values;
  return { concurrency: e.concurrency, pauseMs: e.pauseMs };
}

/** Saves the settings a request sent (null drops the saved copy, so the environment's values apply again). Validation is
 *  strict: a refused request changes nothing and returns the problems. The schedule follows at once, but a run is never
 *  started by a save: a new time only moves the next run. A walk already going keeps the settings it started with. */
export async function applyNightlySettings(
  input: unknown,
  io: SettingsIo = defaultSettingsIo,
): Promise<{ ok: true; settings: Awaited<ReturnType<typeof nightlySettingsView>>; persisted: boolean } | { ok: false; problems: string[]; stored?: false }> {
  let value: SavedSettings | null = null;
  if (input !== null) {
    const v = validateSettings(input);
    if (!v.ok) return { ok: false, problems: v.problems };
    value = Object.keys(v.value).length > 0 ? v.value : null;
  }
  await loadStored(io);
  const before = persisted?.saved ?? null;
  persisted = { saved: value, runs: persisted?.runs ?? [] };
  const landed = await persistStored(io);
  if (!landed) {
    // Not on disk: the save is refused and the copy in memory goes back to the one on disk, so the run and the page
    // follow what a restart would read.
    persisted = { saved: before, runs: persisted?.runs ?? [] };
    if (armed) reschedule(false);
    log.warn('[rebuild] settings save refused: not written to disk');
    return { ok: false, problems: ['Ekki tókst að skrifa stillingarnar á disk: þær eru ekki vistaðar.'], stored: false };
  }
  if (armed) reschedule(false);
  log.info('[rebuild] settings saved', { saved: value !== null, persisted: landed });
  return { ok: true, settings: await nightlySettingsView(), persisted: landed };
}

/** Marks the schedule as armed, as the first production request does, without the stamp read. Tests only. */
export function armForTests(): void {
  armed = true;
}

/** Clears the in-memory state of the settings and timer. Tests only. */
export function resetNightlyForTests(): void {
  persisted = null;
  loading = null;
  writeChain = Promise.resolve();
  if (timer) clearTimeout(timer);
  timer = null;
  schedule = null;
  lastStart = null;
  unfinishedStart = null;
  armed = false;
}

// ---- the walk ----

/** When the last run started (from the stamp at arm time, then from each run). */
let lastStart: number | null = null;
/** The start of an interrupted run (its stamp has no end), from the stamp at arm time; see nightlyUnfinishedStart. */
let unfinishedStart: number | null = null;
let armed = false;
let schedule: { minutes: number; origin: string; catchUp: boolean } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Whether a walk is running now (the admin page's "Keyra núna" is refused meanwhile). */
export function nightlyRunning(): boolean {
  return isRunning();
}

/** Asks the running walk to stop before its next path. False when none is running. */
export function stopNightlyRebuild(): boolean {
  return requestStop();
}

/** Whether a clear of the page store holds the run slot now (no walk can start meanwhile). */
export function nightlyClearing(): boolean {
  return isClearing();
}

/** The start of the run the stamp shows as never ended (the process stopped during it), until a run starts in this
 *  process; null otherwise. Such a run has no record, so the status reports it apart from the last record. */
export function nightlyUnfinishedStart(): number | null {
  return unfinishedStart;
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
 *  request), stamp the end, and keep the run for the status. Never throws. Returns null when it did not run (another run
 *  is in progress, or the store is not there) or stopped on an error. The concurrency and pause are read when the run
 *  starts: a later save does not change a run going. */
export async function runNightlyRebuild(origin: string, options: Partial<WalkOptions> = {}, io: Partial<RunIo> = {}): Promise<WalkTally | null> {
  const d: RunIo = { ...defaultIo, ...io };
  const started = d.now();
  // Synchronous up to here: a second call in the same tick is refused, not queued.
  if (!beginRun(started)) {
    log.warn('[rebuild] skipped: a run or a clear of the store holds the slot');
    return null;
  }
  let begun = false;
  let errored = false;
  let tally: WalkTally | null = null;
  let total: number | null = null;
  let concurrency: number | null = null;
  try {
    if (!(await d.storeReady())) {
      log.warn('[rebuild] skipped: the shell store is not available');
      return null;
    }
    await loadStored(d.settings);
    lastStart = started;
    unfinishedStart = null; // this run supersedes an interrupted one: it is in the record once it ends
    begun = true;
    await d.writeStamp({ lastStart: started, lastEnd: null });
    log.info('[rebuild] started', { base: origin });
    const paths = sitemapPathsFrom(await d.fetchSitemap(origin));
    total = paths.filter(isWalkablePath).length;
    setRunTotal(total);
    log.info('[rebuild] sitemap read', { pages: paths.length });
    const env = walkSettings();
    const walk: WalkOptions = { ...WALK_DEFAULTS, concurrency: env.concurrency, delayMs: env.pauseMs, ...options };
    concurrency = walk.concurrency;
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
    const endedAt = d.now();
    endRun({
      endedAt,
      record: begun,
      tally: tally ?? undefined,
      stoppedEarly: tally?.stoppedEarly ?? errored,
      stoppedWhy: begun ? why : null,
    });
    if (begun && persisted) {
      const t = tally ?? { visited: 0, hits: 0, rendered: 0, gone: 0, failures: 0 };
      const record: RunRecord = {
        startedAt: started,
        endedAt,
        durationMs: Math.max(0, endedAt - started),
        total,
        visited: t.visited,
        hits: t.hits,
        rendered: t.rendered,
        gone: t.gone,
        failures: t.failures,
        stoppedEarly: tally?.stoppedEarly ?? errored,
        stoppedWhy: why,
        concurrency,
      };
      persisted.runs = [record, ...persisted.runs].slice(0, RUNS_KEPT);
      await persistStored(d.settings);
    }
  }
}

// ---- the schedule ----

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

function minutesOf(at: string): number {
  const [h, m] = at.split(':').map(Number);
  return h * 60 + m;
}

/** The catch-up window of a schedule: CATCH_UP_MS, or the short on-time grace when catch-up is off. */
function windowOf(catchUp: boolean): number {
  return catchUp ? CATCH_UP_MS : ON_TIME_GRACE_MS;
}

async function arm(): Promise<void> {
  if (!shellEnabled()) return;
  await loadStored(defaultSettingsIo);
  for (const problem of envDefaults({
    at: runtimeEnv('MOS_SHELL_REBUILD_AT'),
    concurrency: runtimeEnv('MOS_SHELL_REBUILD_CONCURRENCY'),
    pauseMs: runtimeEnv('MOS_SHELL_REBUILD_PAUSE_MS'),
  }).problems) {
    log.warn(`[rebuild] ${problem}`);
  }
  const s = nightlyEffective().values;
  if (!s.enabled) {
    log.info('[rebuild] off: the settings or MOS_SHELL_REBUILD_AT turn it off');
    return;
  }
  const base = rebuildBase();
  if (base.problem) log.warn(`[rebuild] ${base.problem}`);
  if (!base.origin) return;
  const stamp = await defaultIo.readStamp();
  lastStart = stamp?.lastStart ?? null;
  // A stamp that never got its end: the process stopped during that run. It is not resumed; the walk starts again
  // only when it is due (the next run, or this one if still within the window).
  unfinishedStart = stamp && stamp.lastEnd === null && !isRunning() ? stamp.lastStart : null;
  if (unfinishedStart !== null) log.warn('[rebuild] the last run did not finish (the process stopped during it); it is not resumed', { lastStart: unfinishedStart });
  const minutes = minutesOf(s.at);
  if (missedRun(Date.now(), minutes, lastStart, windowOf(s.catchUp))) log.warn('[rebuild] the run due today was missed: no process was up within the catch-up window (see DEPLOY.md)', { at: formatAt(minutes) });
  log.info('[rebuild] armed', { at: s.at, base: base.origin, catchUp: s.catchUp });
  reschedule(true); // a run missed while the process was down (within the window of its time) starts now
}

/** Sets the timer from the current settings. `check` true also runs a due walk first (arm time); false only moves the next
 *  run (a save), so a new time that has already passed today does not start a walk. */
function reschedule(check: boolean): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  schedule = null;
  if (!shellEnabled()) return;
  const s = nightlyEffective().values;
  if (!s.enabled) return;
  const base = rebuildBase();
  if (!base.origin) return;
  schedule = { minutes: minutesOf(s.at), origin: base.origin, catchUp: s.catchUp };
  if (check) tick();
  else scheduleNext();
}

/** Starts the walk when one is due, then arms the timer for the next time. A due walk while one is still going is skipped
 *  with a log line. */
function tick(): void {
  timer = null;
  if (!schedule) return;
  if (runDue(Date.now(), schedule.minutes, lastStart, windowOf(schedule.catchUp))) {
    if (isClearing()) {
      // The walk is still due (lastStart has not moved): it is tried again shortly, not moved to tomorrow.
      log.warn('[rebuild] due while the store is being cleared: tried again shortly');
      timer = setTimeout(tick, CLEAR_RETRY_MS);
      timer.unref?.();
      return;
    }
    if (isRunning()) log.warn('[rebuild] due while the previous run is still in progress: skipped');
    else void runNightlyRebuild(schedule.origin);
  }
  scheduleNext();
}

function scheduleNext(): void {
  if (!schedule) return;
  if (timer) clearTimeout(timer);
  const wait = Math.min(MAX_TIMER_MS, msUntilNextRun(Date.now(), schedule.minutes));
  timer = setTimeout(tick, wait);
  timer.unref?.();
}

/** The current schedule, for the status: the next run (ms) when the timer is armed, and the state of the schedule. */
export function nightlySchedule(): { minutes: number | null; armed: boolean } {
  return { minutes: schedule?.minutes ?? null, armed: schedule !== null };
}
