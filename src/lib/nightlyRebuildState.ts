// The nightly rebuild's run state for the admin page: what the walk is doing now (workers in use, configured N), how the last run in this process
// went, the stop flag and the recent failures. In memory, per process (a restart forgets it; the stamp keeps the
// times). SERVER-ONLY by use; the walk reports into it (src/lib/nightlyRebuildRuntime.ts).

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
  running: boolean;
  startedAt: number | null;
  total: number | null;
  pauseMs: number | null;
  lastPath: string | null;
  stopRequested: boolean;
  /** Workers in effect now (1 while the walk is degraded); null when no run is going. */
  workers: number | null;
  /** The configured number of workers (MOS_SHELL_REBUILD_CONCURRENCY); null when no run is going. */
  concurrency: number | null;
}

export interface FinishedRun extends RunTally {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  stoppedEarly: boolean;
  stoppedWhy: StopWhy | null;
}

const ZERO: RunTally = { visited: 0, hits: 0, rendered: 0, gone: 0, failures: 0 };

const state = {
  running: false,
  startedAt: null as number | null,
  total: null as number | null,
  tally: { ...ZERO },
  pauseMs: null as number | null,
  lastPath: null as string | null,
  stopRequested: false,
  workers: null as number | null,
  concurrency: null as number | null,
  last: null as FinishedRun | null,
  /** Oldest first; at most FAILURE_RING entries. */
  failures: [] as FailureEntry[],
};

/** Starts a run. False (and no change) when one is already running. */
export function beginRun(startedAt: number): boolean {
  if (state.running) return false;
  state.running = true;
  state.startedAt = startedAt;
  state.total = null;
  state.tally = { ...ZERO };
  state.pauseMs = null;
  state.lastPath = null;
  state.stopRequested = false;
  state.workers = null;
  state.concurrency = null;
  return true;
}

/** The configured workers of the run going now; the walk starts with all of them. */
export function setRunConcurrency(n: number): void {
  if (!state.running) return;
  state.concurrency = n;
  state.workers = n;
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
  if (e.record && state.startedAt !== null) {
    const t = e.tally ?? state.tally;
    state.last = {
      ...t,
      startedAt: state.startedAt,
      endedAt: e.endedAt,
      durationMs: Math.max(0, e.endedAt - state.startedAt),
      stoppedEarly: e.stoppedEarly ?? false,
      stoppedWhy: e.stoppedWhy ?? null,
    };
  }
  state.running = false;
  state.stopRequested = false;
  state.pauseMs = null;
  state.workers = null;
  state.concurrency = null;
}

export function isRunning(): boolean {
  return state.running;
}

export function runView(): RunView {
  return {
    running: state.running,
    startedAt: state.startedAt,
    total: state.total,
    ...state.tally,
    pauseMs: state.pauseMs,
    lastPath: state.lastPath,
    stopRequested: state.stopRequested,
    workers: state.workers,
    concurrency: state.concurrency,
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
  state.startedAt = null;
  state.total = null;
  state.tally = { ...ZERO };
  state.pauseMs = null;
  state.lastPath = null;
  state.stopRequested = false;
  state.workers = null;
  state.concurrency = null;
  state.last = null;
  state.failures = [];
}
