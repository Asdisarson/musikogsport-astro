// The nightly rebuild's run state for the admin page: what the walk is doing now (workers in use, configured N), how the last run in this process
// went, the stop flag and the recent failures. In memory, per process (a restart forgets it; the stamp keeps the
// times). SERVER-ONLY by use; the walk reports into it (src/lib/nightlyRebuildRuntime.ts).
//
// One slot is shared by a walk and a clear of the page store (a clear must not run beside a walk that is filling it).
// The slot is held by one of them at a time: a walk is `running`, a clear is `clearing`, and a clear is not a run (no
// walk is stopped by a stop request, and no walk is shown for it).

export const FAILURE_RING = 20;

export type StopWhy = 'failures' | 'stopped' | 'error';

export interface RunTally {
  visited: number;
  hits: number;
  rendered: number;
  gone: number;
  failures: number;
}

export interface FailureEntry {
  path: string;
  /** The status of the answer (0 for no answer). */
  status: number;
  at: number;
}

export interface RunView extends RunTally {
  /** A walk is going. False while a clear holds the slot. */
  running: boolean;
  /** A clear of the page store holds the slot (no walk is going). */
  clearing: boolean;
  startedAt: number | null;
  total: number | null;
  pauseMs: number | null;
  lastPath: string | null;
  stopRequested: boolean;
  /** Workers in effect now (1 while the walk is degraded); null when no run is going. */
  workers: number | null;
  /** The configured number of workers (MOS_SHELL_REBUILD_CONCURRENCY); null when no run is going. */
  concurrency: number | null;
  /** This run prepares the photos its pages ask for (false when none is going: see photosConverted). */
  photos: boolean;
  /** The photos this run made, kept already, and could not make (0 when the run does no photos). */
  photosConverted: number;
  photosKept: number;
  photosFailed: number;
}

export interface FinishedRun extends RunTally {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  stoppedEarly: boolean;
  stoppedWhy: StopWhy | null;
  /** The run prepared its photos, and the counts it made (0 when it did none). */
  photos: boolean;
  photosConverted: number;
  photosKept: number;
  photosFailed: number;
}

const ZERO: RunTally = { visited: 0, hits: 0, rendered: 0, gone: 0, failures: 0 };

const state = {
  running: false,
  clearing: false,
  startedAt: null as number | null,
  total: null as number | null,
  tally: { ...ZERO },
  pauseMs: null as number | null,
  lastPath: null as string | null,
  stopRequested: false,
  workers: null as number | null,
  concurrency: null as number | null,
  photos: false,
  photosConverted: 0,
  photosKept: 0,
  photosFailed: 0,
  last: null as FinishedRun | null,
  /** Oldest first; at most FAILURE_RING entries. */
  failures: [] as FailureEntry[],
};

/** Starts a run. False (and no change) when a run is going or a clear holds the slot. */
export function beginRun(startedAt: number): boolean {
  if (state.running || state.clearing) return false;
  state.running = true;
  state.startedAt = startedAt;
  state.total = null;
  state.tally = { ...ZERO };
  state.pauseMs = null;
  state.lastPath = null;
  state.stopRequested = false;
  state.workers = null;
  state.concurrency = null;
  state.photos = false;
  state.photosConverted = 0;
  state.photosKept = 0;
  state.photosFailed = 0;
  return true;
}

/** Takes the slot for a clear of the page store. False (and no change) when a run is going or another clear holds it. */
export function beginClear(): boolean {
  if (state.running || state.clearing) return false;
  state.clearing = true;
  return true;
}

/** Gives the slot back after a clear. */
export function endClear(): void {
  state.clearing = false;
}

/** Whether a clear holds the slot now. */
export function isClearing(): boolean {
  return state.clearing;
}

/** The configured workers of the run going now; the walk starts with all of them. */
export function setRunConcurrency(n: number): void {
  if (!state.running) return;
  state.concurrency = n;
  state.workers = n;
}

/** Whether the run going now prepares the photos (decided when it starts, from the run's own value or the saved setting). */
export function setRunPhotos(on: boolean): void {
  if (state.running) state.photos = on;
}

/** Adds the photos one page's warm-up made. */
export function addRunPhotos(t: { converted: number; kept: number; failed: number }): void {
  if (!state.running) return;
  state.photosConverted += t.converted;
  state.photosKept += t.kept;
  state.photosFailed += t.failed;
}

export function setRunTotal(total: number): void {
  if (state.running) state.total = total;
}

/** One path counted by the walk. A bad one is also kept in the failure ring. */
export function recordStep(s: { path: string; status: number; bad: boolean; at: number; pauseMs: number; workers?: number; tally: RunTally }): void {
  if (!state.running) return;
  state.tally = { ...s.tally };
  state.lastPath = s.path;
  state.pauseMs = s.pauseMs;
  if (s.workers !== undefined) state.workers = s.workers;
  if (s.bad) {
    state.failures.push({ path: s.path, status: s.status, at: s.at });
    if (state.failures.length > FAILURE_RING) state.failures.splice(0, state.failures.length - FAILURE_RING);
  }
}

/** Asks the running walk to stop before its next path. False when no run is going. */
export function requestStop(): boolean {
  if (!state.running) return false;
  state.stopRequested = true;
  return true;
}

export function stopRequested(): boolean {
  return state.stopRequested;
}

/** Ends the run. `record` false (the run never really started, e.g. the store was not there) keeps the last run as it was. */
export function endRun(e: { endedAt: number; record: boolean; tally?: RunTally; stoppedEarly?: boolean; stoppedWhy?: StopWhy | null }): void {
  if (!state.running) return;
  // The record is built first, with this run's photo counts; the photo fields are reset after it (runView is idle).
  if (e.record && state.startedAt !== null) {
    const t = e.tally ?? state.tally;
    state.last = {
      ...t,
      startedAt: state.startedAt,
      endedAt: e.endedAt,
      durationMs: Math.max(0, e.endedAt - state.startedAt),
      stoppedEarly: e.stoppedEarly ?? false,
      stoppedWhy: e.stoppedWhy ?? null,
      photos: state.photos,
      photosConverted: state.photosConverted,
      photosKept: state.photosKept,
      photosFailed: state.photosFailed,
    };
  }
  state.running = false;
  state.stopRequested = false;
  state.pauseMs = null;
  state.workers = null;
  state.concurrency = null;
  state.photos = false;
  state.photosConverted = 0;
  state.photosKept = 0;
  state.photosFailed = 0;
}

export function isRunning(): boolean {
  return state.running;
}

export function runView(): RunView {
  return {
    running: state.running,
    clearing: state.clearing,
    startedAt: state.startedAt,
    total: state.total,
    ...state.tally,
    pauseMs: state.pauseMs,
    lastPath: state.lastPath,
    stopRequested: state.stopRequested,
    workers: state.workers,
    concurrency: state.concurrency,
    photos: state.photos,
    photosConverted: state.photosConverted,
    photosKept: state.photosKept,
    photosFailed: state.photosFailed,
  };
}

export function lastRun(): FinishedRun | null {
  return state.last ? { ...state.last } : null;
}

/** Newest first. */
export function recentFailures(): FailureEntry[] {
  return state.failures.slice().reverse().map((f) => ({ ...f }));
}

/** Tests only. */
export function resetRunStateForTests(): void {
  state.running = false;
  state.clearing = false;
  state.startedAt = null;
  state.total = null;
  state.tally = { ...ZERO };
  state.pauseMs = null;
  state.lastPath = null;
  state.stopRequested = false;
  state.workers = null;
  state.concurrency = null;
  state.photos = false;
  state.photosConverted = 0;
  state.photosKept = 0;
  state.photosFailed = 0;
  state.last = null;
  state.failures = [];
}
