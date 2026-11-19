// The nightly rebuild of the rendered-page store: when it is due, which origin it walks, and the walk itself. Pure:
// the clock, the requests and the waits are passed in, so the schedule and the walk are tested without a server.
// src/lib/nightlyRebuildRuntime.ts wires them into the process. SERVER-ONLY by use.
//
// Schedule: once a day at MOS_SHELL_REBUILD_AT (default 05:00) in Atlantic/Reykjavik, which is UTC all year, so the
// day and the clock are UTC arithmetic here.
//
// Walk: the product and category paths of the app's own sitemap, each requested on the app's own origin (only the path
// of each sitemap URL is taken). N workers (MOS_SHELL_REBUILD_CONCURRENCY, default 2) take paths from one queue. Each
// path is invalidated just before its first request (so the store holds stale pages only where the walk is). The
// middleware answers a stale page at once and renders it in the background (src/middleware.ts) and says with
// X-Mos-Refresh whether that render is still running: the worker polls (a cheap read, no render) until it is not, so
// a worker never has more than one render open (the one exception: a render the probe gave up on at PROBE_TIMEOUT_MS
// may still run on the server beside the next page; the bad answer that gave up has already dropped the walk to one
// worker, see runtime). A miss renders inside its own request, which the worker awaits, and
// is never asked again. A bad answer drops the walk to one worker (see walkStorefront). A render is "bad" as the prebuild script counts it:
// 5xx, a timeout, or over slowMs; a refresh past maxWaitMs, or one that ends stale, is bad too.
import { isBad, nextPause, sitemapPathsFrom } from '../../scripts/prebuild_shells.mjs';

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;
/** A run due but not started within this long after its time is skipped until the next one. */
export const CATCH_UP_MS = 3 * 60 * MIN_MS;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type RebuildAt = { kind: 'off' } | { kind: 'at'; minutes: number };

/** MOS_SHELL_REBUILD_AT: "HH:MM" (minutes after UTC midnight) or "off". Unset or empty is 05:00; a value that cannot
 *  be read is 05:00 too, with a problem to log. */
export function parseRebuildAt(raw: string | undefined): { at: RebuildAt; problem: string | null } {
  const v = (raw ?? '').trim().toLowerCase();
  const fivePm = { kind: 'at' as const, minutes: 5 * 60 };
  if (v === '') return { at: fivePm, problem: null };
  if (v === 'off') return { at: { kind: 'off' }, problem: null };
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return { at: { kind: 'at', minutes: Number(m[1]) * 60 + Number(m[2]) }, problem: null };
  return { at: fivePm, problem: `MOS_SHELL_REBUILD_AT "${raw}" is not HH:MM or off; using 05:00` };
}

export function formatAt(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The latest scheduled instant (ms) at or before `now`. */
export function scheduledAtOrBefore(now: number, minutes: number): number {
  const today = Math.floor(now / DAY_MS) * DAY_MS + minutes * MIN_MS;
  return today <= now ? today : today - DAY_MS;
}

/** Ms from `now` until the next scheduled instant (a day after `now` when `now` is exactly on one). */
export function msUntilNextRun(now: number, minutes: number): number {
  return scheduledAtOrBefore(now, minutes) + DAY_MS - now;
}

/** Whether a run should start now: the latest scheduled instant has no run since it, and it is within CATCH_UP_MS.
 *  `lastStart` is when the last run started (null when there is none on record). */
export function runDue(now: number, minutes: number, lastStart: number | null): boolean {
  const due = scheduledAtOrBefore(now, minutes);
  if (lastStart !== null && lastStart >= due) return false;
  return now - due <= CATCH_UP_MS;
}

/** Whether the latest scheduled run was missed: no run has started since it, and it is past CATCH_UP_MS (so runDue
 *  is false for a reason other than the run being done). The runtime logs it when the process first arms. */
export function missedRun(now: number, minutes: number, lastStart: number | null): boolean {
  const due = scheduledAtOrBefore(now, minutes);
  return (lastStart === null || lastStart < due) && now - due > CATCH_UP_MS;
}

/** The origin the walk requests: MOS_SHELL_REBUILD_BASE (its origin; the path is ignored) when set, otherwise the first
 *  host of MOS_EXTRA_ALLOWED_HOSTS as https. The apex is behind the CDN and is never used. `origin` is null when
 *  neither is set (the nightly rebuild does nothing); `problem` says what is wrong with a value that was set. */
export function rebuildOrigin(explicit: string | undefined, extraHosts: string | undefined): { origin: string | null; problem: string | null } {
  const e = (explicit ?? '').trim();
  if (e !== '') {
    try {
      const u = new URL(e);
      if (u.protocol === 'http:' || u.protocol === 'https:') return { origin: u.origin, problem: null };
    } catch {
      // reported below
    }
    return { origin: null, problem: 'MOS_SHELL_REBUILD_BASE is not an http(s) URL: the nightly rebuild is off' };
  }
  const host = (extraHosts ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .find((h) => h !== '');
  if (!host) return { origin: null, problem: null };
  if (!HOSTNAME.test(host)) return { origin: null, problem: 'the first MOS_EXTRA_ALLOWED_HOSTS entry is not a hostname: the nightly rebuild is off' };
  return { origin: `https://${host}`, problem: null };
}

/** A sitemap path the walk may request: one absolute path on the origin (never protocol-relative, never a backslash). */
export function isWalkablePath(p: string): boolean {
  return /^\/(?!\/)[^\\\s]*$/.test(p);
}

/** MOS_SHELL_REBUILD_CONCURRENCY: an integer 1..4 (the workers walking at once). Unset or empty is 2; anything else is 2
 *  with a problem to log. */
export function parseConcurrency(raw: string | undefined): { value: number; problem: string | null } {
  const v = (raw ?? '').trim();
  if (v === '') return { value: 2, problem: null };
  const n = Number(v);
  if (/^\d+$/.test(v) && n >= 1 && n <= 4) return { value: n, problem: null };
  return { value: 2, problem: `MOS_SHELL_REBUILD_CONCURRENCY "${raw}" is not an integer 1..4; using 2` };
}

/** MOS_SHELL_REBUILD_PAUSE_MS: an integer 0..30000 (the base pause between renders). Unset or empty is 100; anything
 *  else is 100 with a problem to log. */
export function parsePauseMs(raw: string | undefined): { value: number; problem: string | null } {
  const v = (raw ?? '').trim();
  if (v === '') return { value: 100, problem: null };
  const n = Number(v);
  if (/^\d+$/.test(v) && n >= 0 && n <= 30_000) return { value: n, problem: null };
  return { value: 100, problem: `MOS_SHELL_REBUILD_PAUSE_MS "${raw}" is not an integer 0..30000; using 100` };
}

export interface WalkOptions {
  /** The configured number of workers (1..4): how many pages render at once while the walk is healthy. */
  concurrency: number;
  /** Base pause between renders (ms), the start of the adaptive pause. */
  delayMs: number;
  /** A render slower than this (ms) counts as bad. */
  slowMs: number;
  /** Stop after this many bad answers in a row. */
  maxFailures: number;
  /** Visit at most this many paths. */
  limit: number;
  /** How often a stale page is read while its refresh runs (ms). */
  pollMs: number;
  /** Longest wait for one page's refresh (ms); past it the page counts as a failure. */
  maxWaitMs: number;
  /** A progress line every this many visited pages. */
  progressEvery: number;
}

export const WALK_DEFAULTS: WalkOptions = {
  concurrency: 2,
  delayMs: 100,
  slowMs: 3000,
  maxFailures: 5,
  limit: Infinity,
  pollMs: 500,
  maxWaitMs: 90_000,
  progressEvery: 500,
};

/** Good answers in a row, with the pause back at the base, before a degraded walk returns to its configured workers. */
export const RECOVER_AFTER = 20;
/** How long a worker waits before it looks again for a free slot (ms). */
const SLOT_WAIT_MS = 25;

export interface WalkTally {
  visited: number;
  /** Pages answered from the store, fresh. */
  hits: number;
  /** Pages the walk rendered (or waited for a render of). */
  rendered: number;
  /** Pages that answer 404, 410 or a redirect now (the store drops them). */
  gone: number;
  failures: number;
  stoppedEarly: boolean;
  /** Why the walk stopped early: too many failures in a row, or the stop flag (null when it ran to the end). */
  stoppedBy: 'failures' | 'stopped' | null;
}

export interface WalkStep {
  path: string;
  /** The answer the walk settled on (the last poll of a refresh). */
  status: number;
  shell: string | null;
  bad: boolean;
  /** The pause the walk will take before the next path. */
  pauseMs: number;
  /** Workers in effect after this answer (1 while degraded). */
  workers: number;
  at: number;
  tally: WalkTally;
}

export interface WalkIo {
  /** One request on the origin: status 0 for a network failure or a timeout; shell is the X-Mos-Shell value and
   *  refreshing is true while the server runs a background refresh of a stale page (X-Mos-Refresh: running). */
  get(path: string): Promise<{ status: number; shell: string | null; refreshing?: boolean }>;
  /** Called once per path, before its first request (the runtime invalidates the path here). */
  before?(path: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  progress(tally: WalkTally): void;
  /** Checked before each path: true stops the walk (the admin page's stop button). */
  stop?(): boolean;
  /** Called after each path is counted (the admin page's last path, pause and failure list). */
  step?(s: WalkStep): void;
}

/** The schedule's state for the admin page: why the nightly rebuild is not armed, or null when it is. Pure. */
export type ScheduleWhy = 'store-off' | 'off' | 'no-base' | 'waiting';
export function scheduleWhy(p: { storeOn: boolean; atOff: boolean; hasBase: boolean; armed: boolean }): ScheduleWhy | null {
  if (!p.storeOn) return 'store-off';
  if (p.atOff) return 'off';
  if (!p.hasBase) return 'no-base';
  return p.armed ? null : 'waiting';
}

type Answer = { status: number; shell: string | null; refreshing?: boolean };
type Unit = { first: Answer; last: Answer; started: number; timedOut: boolean; stuck: boolean } | 'stopped' | 'abandoned';

/** Walks the paths with `opts.concurrency` workers sharing one queue (see the header). A bad answer drops the walk to one
 *  worker and doubles the pause; RECOVER_AFTER good answers in a row with the pause back at the base restore the
 *  configured workers. Never throws on a bad answer: it counts it. */
export async function walkStorefront(paths: string[], opts: WalkOptions, io: WalkIo): Promise<WalkTally> {
  const list = paths.filter(isWalkablePath).slice(0, opts.limit);
  const configured = Math.max(1, Math.min(4, opts.concurrency));
  const tally: WalkTally = { visited: 0, hits: 0, rendered: 0, gone: 0, failures: 0, stoppedEarly: false, stoppedBy: null };
  let pause = opts.delayMs;
  let workers = configured;
  let busy = 0;
  let next = 0;
  let inARow = 0;
  let goodInARow = 0;
  let halted = false;
  // The first error a worker threw: it halts every worker, and is rethrown once all of them have stopped.
  let thrown: { err: unknown } | null = null;

  // Sleeps `ms` in slices of pollMs, and ends early on a stop request or a halt (a pause can be up to 30 s).
  async function sleepPause(ms: number): Promise<void> {
    const slice = Math.max(1, opts.pollMs);
    let left = ms;
    while (left > 0 && !halted && !io.stop?.()) {
      const d = Math.min(left, slice);
      await io.sleep(d);
      left -= d;
    }
  }

  // One page, start to end: invalidated just before its first request, then polled while its refresh runs.
  async function unit(path: string): Promise<Unit> {
    if (io.before) await io.before(path);
    const started = io.now();
    const first = await io.get(path);
    let last = first;
    let timedOut = false;
    let stuck = false;
    // A stale page: its refresh runs now. The worker polls (a cheap read, no render) until the server reports the refresh
    // has ended. Past maxWaitMs the page counts as a failure; past twice maxWaitMs the refresh is taken as stuck. A stop
    // request ends the wait at once: the page is not counted. A stale answer with no refresh running failed (backoff).
    if (first.status === 200 && first.shell === 'stale') {
      const deadline = started + opts.maxWaitMs;
      const giveUp = started + 2 * opts.maxWaitMs;
      while (last.status === 200 && last.shell === 'stale' && last.refreshing) {
        if (io.stop?.()) return 'stopped';
        if (halted) return 'abandoned';
        if (io.now() >= giveUp) {
          stuck = true;
          break;
        }
        if (io.now() >= deadline) timedOut = true;
        await io.sleep(opts.pollMs);
        last = await io.get(path);
      }
    }
    return { first, last, started, timedOut, stuck };
  }

  // Counts one finished page: the tally, the degrade or recover rule, the stop after a run of failures, the step.
  function count(path: string, u: Exclude<Unit, 'stopped' | 'abandoned'>): { goOn: boolean; storedAndGood: boolean } {
    const { first, last, started, timedOut, stuck } = u;
    const ms = io.now() - started;
    const staleAfter = last.status === 200 && last.shell === 'stale';
    const bad = timedOut || staleAfter || isBad({ status: last.status, shell: last.shell ?? '-', ms }, opts.slowMs);
    const gone = !bad && (last.status === 404 || last.status === 410 || (last.status >= 300 && last.status < 400));

    tally.visited += 1;
    if (bad) {
      tally.failures += 1;
      inARow += 1;
    } else {
      inARow = 0;
      if (gone) tally.gone += 1;
      else if (first.status === 200 && first.shell === 'hit') tally.hits += 1;
    }
    if (first.status === 200 && first.shell !== 'hit') tally.rendered += 1;

    // Degrade on any bad answer; recover after RECOVER_AFTER good ones in a row, once the pause is back at the base.
    pause = nextPause(pause, bad, opts.delayMs);
    if (bad) {
      workers = 1;
      goodInARow = 0;
    } else {
      goodInARow += 1;
      if (workers < configured && goodInARow >= RECOVER_AFTER && pause === opts.delayMs) workers = configured;
    }
    if (tally.visited % opts.progressEvery === 0) io.progress({ ...tally });
    io.step?.({ path, status: last.status, shell: last.shell ?? null, bad, pauseMs: pause, workers, at: io.now(), tally: { ...tally } });
    const storedAndGood = first.status === 200 && first.shell === 'hit' && !bad;
    if (stuck || inARow >= opts.maxFailures) {
      halted = true;
      tally.stoppedEarly = next < list.length;
      tally.stoppedBy = tally.stoppedEarly ? 'failures' : null;
      return { goOn: false, storedAndGood };
    }
    return { goOn: true, storedAndGood };
  }

  async function loop(): Promise<void> {
    while (!halted) {
      if (io.stop?.()) {
        if (next < list.length) {
          halted = true;
          tally.stoppedEarly = true;
          tally.stoppedBy = 'stopped';
        }
        return;
      }
      if (next >= list.length) return;
      if (busy >= workers) {
        await io.sleep(SLOT_WAIT_MS);
        continue;
      }
      const path = list[next];
      next += 1;
      let u: Unit;
      busy += 1;
      try {
        u = await unit(path);
      } finally {
        busy -= 1;
      }
      if (u === 'abandoned') return; // a sibling halted the walk: this page is not counted
      if (u === 'stopped') {
        halted = true;
        tally.stoppedEarly = true;
        tally.stoppedBy = 'stopped';
        return;
      }
      const c = count(path, u);
      if (!c.goOn) return;
      if (!c.storedAndGood && next < list.length && !halted) await sleepPause(pause);
    }
  }

  // A throw (the store went away, a callback failed) halts the walk; the other workers stop at their next check, so
  // the walk never ends while one of them still has a request open.
  async function worker(): Promise<void> {
    try {
      await loop();
    } catch (err) {
      if (!thrown) thrown = { err };
      halted = true;
    }
  }

  await Promise.all(Array.from({ length: configured }, () => worker()));
  if (thrown) throw (thrown as { err: unknown }).err;
  return tally;
}

// sitemapPathsFrom is the prebuild script's parser; the walk takes the same list (re-exported for the runtime).
export { sitemapPathsFrom };
