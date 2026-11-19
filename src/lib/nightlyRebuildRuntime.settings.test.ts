// The nightly rebuild's saved settings at run time (src/lib/nightlyRebuildRuntime.ts): a refused save changes nothing,
// a saved field beats the environment, an empty or null save drops the copy, the file is written whole, and a save
// moves the next run without starting one. The settings file is an injected io: nothing is written to disk.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyNightlySettings, armForTests, nightlyRunning, nightlySchedule, nightlySettingsView, resetNightlyForTests, type SettingsIo } from './nightlyRebuildRuntime';

function memoryIo(): { io: SettingsIo; writes: unknown[] } {
  let data: unknown = null;
  const writes: unknown[] = [];
  return {
    writes,
    io: {
      read: async () => data,
      write: async (d) => {
        writes.push(JSON.parse(JSON.stringify(d)));
        data = d;
      },
    },
  };
}

const ENV = ['MOS_SHELL_REBUILD_AT', 'MOS_SHELL_REBUILD_CONCURRENCY', 'MOS_SHELL_REBUILD_PAUSE_MS'] as const;

beforeEach(() => {
  vi.useFakeTimers();
  // 06:40 UTC, which is 06:40 in Reykjavik all year.
  vi.setSystemTime(new Date('2026-11-19T06:40:00Z'));
  process.env.MOS_SHELL_REBUILD_BASE = 'https://storefront.test';
  for (const k of ENV) delete process.env[k];
  resetNightlyForTests();
});

afterEach(() => {
  vi.useRealTimers();
  resetNightlyForTests();
  delete process.env.MOS_SHELL_REBUILD_BASE;
  for (const k of ENV) delete process.env[k];
});

describe('applyNightlySettings', () => {
  it('refuses an out-of-range value with the problem lines, and writes nothing', async () => {
    const m = memoryIo();
    const r = await applyNightlySettings({ concurrency: 9, pauseMs: 40000 }, m.io);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(2);
    expect(m.writes).toEqual([]);
  });

  it('applies the saved values at once and writes the whole file: the settings and the runs (none yet)', async () => {
    const m = memoryIo();
    const r = await applyNightlySettings({ concurrency: 3, at: '06:30' }, m.io);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.persisted).toBe(true);
    expect(r.settings.effective).toMatchObject({ concurrency: 3, at: '06:30' });
    expect(r.settings.source).toMatchObject({ concurrency: 'saved', at: 'saved', pauseMs: 'env/default' });
    expect(m.writes).toEqual([{ settings: { concurrency: 3, at: '06:30' }, runs: [] }]);
  });

  it('a saved field beats the environment; an empty save or a null one drops the copy and the environment applies again', async () => {
    process.env.MOS_SHELL_REBUILD_CONCURRENCY = '3';
    const m = memoryIo();
    const saved = await applyNightlySettings({ concurrency: 1 }, m.io);
    expect(saved.ok && saved.settings.effective.concurrency).toBe(1);

    const empty = await applyNightlySettings({}, m.io);
    expect(empty.ok && empty.settings.effective.concurrency).toBe(3);
    expect(empty.ok && empty.settings.saved).toBeNull();

    await applyNightlySettings({ concurrency: 1 }, m.io);
    const dropped = await applyNightlySettings(null, m.io);
    expect(dropped.ok && dropped.settings.effective.concurrency).toBe(3);
    expect(m.writes.at(-1)).toEqual({ settings: null, runs: [] });
  });

  it('a save moves the next run and changes nothing running: no walk starts at once, even for a time already past today', async () => {
    const m = memoryIo();
    armForTests();
    const r = await applyNightlySettings({ enabled: true, at: '06:30' }, m.io); // 10 minutes ago, inside the catch-up window
    expect(r.ok).toBe(true);
    expect(nightlySchedule()).toEqual({ minutes: 6 * 60 + 30, armed: true });
    expect(nightlyRunning()).toBe(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('switching the run off clears the timer, and on again arms it at the saved time', async () => {
    const m = memoryIo();
    armForTests();
    await applyNightlySettings({ enabled: false }, m.io);
    expect(nightlySchedule().armed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const on = await applyNightlySettings({ enabled: true, at: '04:15' }, m.io);
    expect(on.ok && on.settings.effective).toMatchObject({ enabled: true, at: '04:15' });
    expect(nightlySchedule()).toEqual({ minutes: 4 * 60 + 15, armed: true });
  });

  it('before the schedule is armed a save only saves: nothing is timed in this process yet', async () => {
    const m = memoryIo();
    await applyNightlySettings({ at: '04:15' }, m.io);
    expect(nightlySchedule().armed).toBe(false);
    expect(m.writes).toHaveLength(1);
  });
});

describe('applyNightlySettings when the file cannot be written', () => {
  it('refuses the save and keeps the copy that is on disk, so the run and the page follow what a restart would read', async () => {
    const m = memoryIo();
    await applyNightlySettings({ enabled: true, at: '04:00' }, m.io);
    const failing: SettingsIo = { read: m.io.read, write: async () => { throw new Error('disk full'); } };
    armForTests();
    const r = await applyNightlySettings({ enabled: false }, failing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stored).toBe(false);
    // The in-memory copy is the one on disk: still on at 04:00, the timer still armed.
    expect(nightlySchedule()).toEqual({ minutes: 4 * 60, armed: true });
    expect((await nightlySettingsView()).saved).toEqual({ enabled: true, at: '04:00' });
  });
});
