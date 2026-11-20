// The nightly run's slot while a clear holds it (src/lib/nightlyRebuildRuntime.ts), and the interrupted run the stamp
// keeps (a stamp with no end). Timers are faked; no walk is started, so nothing reaches the network.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyNightlySettings,
  armForTests,
  armNightlyRebuild,
  nightlyClearing,
  nightlyRunning,
  nightlyUnfinishedStart,
  resetNightlyForTests,
  scheduleArmed,
  type SettingsIo,
} from './nightlyRebuildRuntime';
import { beginClear, endClear } from './nightlyRebuildState';

function memoryIo(): SettingsIo {
  let data: unknown = null;
  return {
    read: async () => data,
    write: async (d) => {
      data = JSON.parse(JSON.stringify(d));
    },
  };
}

let dir: string;
beforeEach(async () => {
  vi.useFakeTimers();
  // 06:40 UTC, which is 06:40 in Reykjavik all year.
  vi.setSystemTime(new Date('2026-11-19T06:40:00Z'));
  dir = await mkdtemp(join(tmpdir(), 'mos-slot-test-'));
  process.env.MOS_SHELL_DIR = dir;
  process.env.MOS_SHELL_REBUILD_BASE = 'https://storefront.test';
  process.env.MOS_SHELL_REBUILD_AT = '06:45'; // on: the nightly rebuild is off by default
  delete process.env.MOS_SHELL_REBUILD_CONCURRENCY;
  delete process.env.MOS_SHELL_REBUILD_PAUSE_MS;
  resetNightlyForTests();
});

afterEach(async () => {
  vi.useRealTimers();
  resetNightlyForTests();
  endClear();
  delete process.env.MOS_SHELL_DIR;
  delete process.env.MOS_SHELL_REBUILD_BASE;
  delete process.env.MOS_SHELL;
  delete process.env.MOS_SHELL_REBUILD_AT;
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('a due walk while a clear holds the slot', () => {
  it('is not started and not moved to tomorrow: it is tried again shortly after the clear, and starts then', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const text = () => logs.mock.calls.map((c) => String(c[0])).join('\n');
    armForTests();
    await applyNightlySettings({ at: '06:45' }, memoryIo()); // the walk is due in five minutes
    expect(beginClear()).toBe(true);

    await vi.advanceTimersByTimeAsync(5 * 60_000); // 06:45: due, but the slot is the clear's
    expect(nightlyRunning()).toBe(false);
    expect(nightlyClearing()).toBe(true);
    expect(text()).toContain('tried again shortly');
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // The clear ends. The store is then switched off for this test, so the retried walk stops at once, before any
    // request: what matters here is that the walk is tried (its log line), not that it runs.
    endClear();
    process.env.MOS_SHELL = 'off';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(text()).toContain('the shell store is not available');
    expect(text()).not.toContain('a run or a clear of the store holds the slot');
    logs.mockRestore();
  });
});

describe('an interrupted run', () => {
  it('a stamp with no end is reported as the unfinished start, until a later run starts', async () => {
    const start = Date.parse('2026-11-19T05:00:00Z');
    await writeFile(join(dir, 'nightly-rebuild.json'), JSON.stringify({ lastStart: start, lastEnd: null }));
    armNightlyRebuild();
    await vi.waitFor(() => expect(nightlyUnfinishedStart()).toBe(start));
  });

  it('a stamp with an end is a finished run: nothing is unfinished', async () => {
    const start = Date.parse('2026-11-19T05:00:00Z');
    await writeFile(join(dir, 'nightly-rebuild.json'), JSON.stringify({ lastStart: start, lastEnd: start + 60_000 }));
    armNightlyRebuild();
    await vi.waitFor(() => expect(scheduleArmed()).toBe(true)); // arm has read the stamp by now
    expect(nightlyUnfinishedStart()).toBeNull();
  });
});
