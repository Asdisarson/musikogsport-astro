// The nightly run state the admin page shows: one run at a time, the failure ring (at most 20, newest first), the stop
// flag, and the last finished run's tally and duration.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FAILURE_RING,
  addRunPhotos,
  beginClear,
  beginRun,
  endClear,
  endRun,
  isClearing,
  isRunning,
  lastRun,
  recentFailures,
  recordStep,
  requestStop,
  resetRunStateForTests,
  runView,
  setRunConcurrency,
  setRunPhotos,
  setRunTotal,
  stopRequested,
} from './nightlyRebuildState';

const zero = { visited: 0, hits: 0, rendered: 0, gone: 0, failures: 0 };

beforeEach(() => resetRunStateForTests());

describe('nightly run state', () => {
  it('keeps the photo counts in the finished run, and the run view is idle again after the run ends', () => {
    beginRun(1000);
    setRunPhotos(true);
    addRunPhotos({ converted: 2, kept: 1, failed: 1 });
    endRun({ endedAt: 2000, record: true, tally: { ...zero, visited: 4 } });
    expect(lastRun()).toMatchObject({ photos: true, photosConverted: 2, photosKept: 1, photosFailed: 1 });
    expect(runView()).toMatchObject({ running: false, photos: false, photosConverted: 0, photosKept: 0, photosFailed: 0 });
  });

  it('starts one run at a time', () => {
    expect(beginRun(1000)).toBe(true);
    expect(isRunning()).toBe(true);
    expect(beginRun(2000)).toBe(false);
    expect(runView()).toMatchObject({ running: true, startedAt: 1000 });
  });

  it('counts steps, keeps the last path and the pause, and the total', () => {
    beginRun(1000);
    setRunTotal(9);
    recordStep({ path: '/vara/a/', status: 200, bad: false, at: 1100, pauseMs: 1000, tally: { ...zero, visited: 1, hits: 1 } });
    expect(runView()).toMatchObject({ total: 9, visited: 1, hits: 1, lastPath: '/vara/a/', pauseMs: 1000, failures: 0 });
  });

  it('shows the configured workers and the workers in use', () => {
    beginRun(1000);
    setRunConcurrency(2);
    expect(runView()).toMatchObject({ workers: 2, concurrency: 2 });
    recordStep({ path: '/vara/a/', status: 500, bad: true, at: 1100, pauseMs: 200, workers: 1, tally: { ...zero, visited: 1, failures: 1 } });
    expect(runView()).toMatchObject({ workers: 1, concurrency: 2 });
    endRun({ endedAt: 1200, record: true });
    expect(runView()).toMatchObject({ running: false, workers: null, concurrency: null });
  });

  it('keeps the last 20 failures, newest first, and not the good pages', () => {
    beginRun(0);
    for (let i = 0; i < FAILURE_RING + 5; i++) {
      recordStep({ path: `/vara/p${i}/`, status: 500, bad: true, at: i, pauseMs: 1, tally: { ...zero, visited: i + 1, failures: i + 1 } });
    }
    recordStep({ path: '/vara/ok/', status: 200, bad: false, at: 99, pauseMs: 1, tally: { ...zero, visited: 26, failures: 25 } });
    const f = recentFailures();
    expect(f).toHaveLength(FAILURE_RING);
    expect(f[0]).toEqual({ path: '/vara/p24/', status: 500, at: 24 });
    expect(f[FAILURE_RING - 1].path).toBe('/vara/p5/');
  });

  it('a stop request is refused when nothing runs, and cleared when the run ends', () => {
    expect(requestStop()).toBe(false);
    beginRun(0);
    expect(requestStop()).toBe(true);
    expect(stopRequested()).toBe(true);
    endRun({ endedAt: 500, record: true, tally: { ...zero, visited: 3 }, stoppedEarly: true, stoppedWhy: 'stopped' });
    expect(stopRequested()).toBe(false);
    expect(isRunning()).toBe(false);
  });

  it('a clear holds the slot without being a run: running is false, clearing is true, and a run, another clear or a stop are refused', () => {
    expect(beginClear()).toBe(true);
    expect(isClearing()).toBe(true);
    expect(isRunning()).toBe(false);
    expect(runView()).toMatchObject({ running: false, clearing: true, startedAt: null, total: null, workers: null });
    expect(beginRun(2000)).toBe(false);
    expect(beginClear()).toBe(false);
    expect(requestStop()).toBe(false);
    endClear();
    expect(isClearing()).toBe(false);
    expect(runView()).toMatchObject({ running: false, clearing: false });
    expect(beginRun(4000)).toBe(true);
  });

  it('a walk holds the slot against a clear, and a clear records no run', () => {
    beginRun(1000);
    expect(beginClear()).toBe(false);
    expect(runView()).toMatchObject({ running: true, clearing: false });
    endRun({ endedAt: 3000, record: false });
    expect(beginClear()).toBe(true);
    endClear();
    expect(lastRun()).toBeNull();
  });

  it('records the finished run with its duration and why it stopped; a run that never began records nothing', () => {
    beginRun(1000);
    endRun({ endedAt: 4500, record: true, tally: { ...zero, visited: 4, rendered: 2, failures: 1 }, stoppedEarly: false, stoppedWhy: null });
    expect(lastRun()).toMatchObject({ startedAt: 1000, endedAt: 4500, durationMs: 3500, visited: 4, rendered: 2, failures: 1, stoppedEarly: false, stoppedWhy: null });

    beginRun(9000);
    endRun({ endedAt: 9001, record: false });
    expect(lastRun()?.startedAt).toBe(1000);
    expect(isRunning()).toBe(false);
  });
});
