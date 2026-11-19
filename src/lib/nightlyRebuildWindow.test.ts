// The catch-up window (src/lib/nightlyRebuild.ts): with catch-up on, a run missed by up to CATCH_UP_MS starts when a
// process wakes; with catch-up off, only the short on-time grace applies, so a late wake-up does not start the walk.
import { describe, expect, it } from 'vitest';
import { CATCH_UP_MS, ON_TIME_GRACE_MS, missedRun, runDue } from './nightlyRebuild';

const MIN = 60_000;
const FIVE_AM = 5 * 60;
const DAY = 24 * 60 * MIN;
const due = Math.floor(Date.UTC(2026, 10, 19) / DAY) * DAY + FIVE_AM * MIN;

describe('the catch-up window', () => {
  it('on: a run up to three hours late is due', () => {
    expect(runDue(due + CATCH_UP_MS, FIVE_AM, null, CATCH_UP_MS)).toBe(true);
    expect(runDue(due + CATCH_UP_MS + 1, FIVE_AM, null, CATCH_UP_MS)).toBe(false);
  });

  it('off: only the grace after the time is due, and a wake-up later than that is not', () => {
    expect(ON_TIME_GRACE_MS).toBeGreaterThan(0);
    expect(ON_TIME_GRACE_MS).toBeLessThan(CATCH_UP_MS);
    expect(runDue(due + ON_TIME_GRACE_MS, FIVE_AM, null, ON_TIME_GRACE_MS)).toBe(true);
    expect(runDue(due + ON_TIME_GRACE_MS + 1, FIVE_AM, null, ON_TIME_GRACE_MS)).toBe(false);
  });

  it('a missed run is reported against the same window', () => {
    expect(missedRun(due + ON_TIME_GRACE_MS + MIN, FIVE_AM, null, ON_TIME_GRACE_MS)).toBe(true);
    expect(missedRun(due + ON_TIME_GRACE_MS + MIN, FIVE_AM, null, CATCH_UP_MS)).toBe(false);
  });
});
