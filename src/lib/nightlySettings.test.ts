// The nightly rebuild's settings (src/lib/nightlySettings.ts): the bounds of each field (refused, never clamped), the
// precedence of saved over environment over default, the re-check of the persisted file, and the estimate.
import { describe, expect, it } from 'vitest';
import { RUNS_KEPT, envDefaults, estimateMs, mergeSettings, parseRun, parseStored, perPage, validateSettings, type NightlySettings, type RunRecord } from './nightlySettings';

const DEFAULTS: NightlySettings = { enabled: true, at: '05:00', concurrency: 2, pauseMs: 100, catchUp: true, photos: false };

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  startedAt: 1,
  endedAt: 4001,
  durationMs: 4000,
  total: 10,
  visited: 5,
  hits: 2,
  rendered: 2,
  gone: 1,
  failures: 0,
  stoppedEarly: false,
  stoppedWhy: null,
  concurrency: 2,
  ...over,
});

describe('validateSettings', () => {
  it('takes a full set and a partial one', () => {
    expect(validateSettings({ enabled: false, at: '23:59', concurrency: 4, pauseMs: 30000, catchUp: false })).toEqual({
      ok: true,
      value: { enabled: false, at: '23:59', concurrency: 4, pauseMs: 30000, catchUp: false },
    });
    expect(validateSettings({ at: '00:00' })).toEqual({ ok: true, value: { at: '00:00' } });
    expect(validateSettings({})).toEqual({ ok: true, value: {} });
  });

  it('refuses out-of-range values with a line each, and never clamps them', () => {
    const r = validateSettings({ concurrency: 5, pauseMs: 30001, at: '24:00' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(3);
    expect(validateSettings({ concurrency: 0 }).ok).toBe(false);
    expect(validateSettings({ pauseMs: -1 }).ok).toBe(false);
    expect(validateSettings({ at: '5:00' }).ok).toBe(false);
    expect(validateSettings({ at: '12:60' }).ok).toBe(false);
  });

  it('wants integers and real booleans: no strings, no fractions', () => {
    expect(validateSettings({ concurrency: '2' }).ok).toBe(false);
    expect(validateSettings({ concurrency: 2.5 }).ok).toBe(false);
    expect(validateSettings({ pauseMs: '100' }).ok).toBe(false);
    expect(validateSettings({ enabled: 'yes' }).ok).toBe(false);
    expect(validateSettings({ catchUp: 1 }).ok).toBe(false);
  });

  it('refuses unknown fields and anything that is not an object', () => {
    expect(validateSettings({ concurrency: 2, speed: 9 })).toEqual({ ok: false, problems: ['Óþekktur reitur: speed.'] });
    expect(validateSettings(null).ok).toBe(false);
    expect(validateSettings([]).ok).toBe(false);
    expect(validateSettings('x').ok).toBe(false);
  });
});

describe('envDefaults', () => {
  it('reads the environment, and the built-in defaults when it is empty', () => {
    expect(envDefaults({})).toEqual({ values: { ...DEFAULTS, enabled: false }, problems: [] });
    expect(envDefaults({ at: '03:30', concurrency: '3', pauseMs: '250' }).values).toEqual({ ...DEFAULTS, at: '03:30', concurrency: 3, pauseMs: 250 });
  });

  it('is off until it is switched on: an unset MOS_SHELL_REBUILD_AT is enabled false, a time in it is enabled true', () => {
    expect(envDefaults({}).values).toMatchObject({ enabled: false, at: '05:00' });
    expect(envDefaults({ at: '  ' }).values.enabled).toBe(false);
    expect(envDefaults({ at: '04:30' }).values).toMatchObject({ enabled: true, at: '04:30' });
  });

  it('MOS_SHELL_REBUILD_AT=off is enabled false, with the time left at 05:00 so the form has one to show', () => {
    expect(envDefaults({ at: 'off' }).values).toMatchObject({ enabled: false, at: '05:00' });
  });

  it('a value that cannot be read gives its default with a problem line, and the rebuild stays off (review 53)', () => {
    const e = envDefaults({ at: 'noon', concurrency: '9', pauseMs: 'x' });
    expect(e.values).toEqual({ ...DEFAULTS, enabled: false });
    expect(e.problems).toHaveLength(3);
  });

  it('an unreadable time never switches the walk on, whatever it looks like', () => {
    for (const at of ['5 am', '0500', '5:0', '25:00']) {
      expect(envDefaults({ at }).values).toMatchObject({ enabled: false, at: '05:00' });
      expect(envDefaults({ at }).problems).toHaveLength(1);
    }
  });
});

describe('mergeSettings: saved over environment over default', () => {
  it('uses the environment when nothing is saved, and says so per field', () => {
    const env = { ...DEFAULTS, concurrency: 3 };
    const m = mergeSettings(env, null);
    expect(m.values).toEqual(env);
    expect(Object.values(m.source).every((s) => s === 'env/default')).toBe(true);
  });

  it('a saved field wins, and a field absent from the saved copy falls back to the environment', () => {
    const m = mergeSettings({ ...DEFAULTS, concurrency: 3, at: '04:00' }, { concurrency: 1 });
    expect(m.values).toMatchObject({ concurrency: 1, at: '04:00' });
    expect(m.source).toMatchObject({ concurrency: 'saved', at: 'env/default' });
  });

  it('a saved off stays off even when the environment is on', () => {
    expect(mergeSettings(DEFAULTS, { enabled: false }).values.enabled).toBe(false);
  });
});

describe('parseStored: the persisted file is checked again', () => {
  it('drops a bad saved field and keeps the good ones, naming the bad one', () => {
    const p = parseStored({ settings: { concurrency: 9, at: '06:15', pauseMs: 100 } });
    expect(p.saved).toEqual({ at: '06:15', pauseMs: 100 });
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0]).toMatch(/^concurrency:/);
  });

  it('nothing usable is no saved copy; a file that is not an object is empty', () => {
    expect(parseStored({ settings: { concurrency: 9 } }).saved).toBeNull();
    expect(parseStored(null)).toEqual({ saved: null, runs: [], problems: [] });
    expect(parseStored('x')).toEqual({ saved: null, runs: [], problems: [] });
  });

  it('keeps at most seven runs, and drops a run that is not of its shape', () => {
    const many = Array.from({ length: 9 }, (_, i) => run({ startedAt: i }));
    expect(parseStored({ runs: many }).runs).toHaveLength(RUNS_KEPT);
    expect(parseStored({ runs: [{ startedAt: 'x' }, run()] }).runs).toHaveLength(1);
  });

  it('parseRun refuses a worker count outside 1..4 and a stop reason it does not know', () => {
    expect(parseRun(run({ concurrency: 9 }))).toBeNull();
    expect(parseRun({ ...run(), stoppedWhy: 'bored' })).toBeNull();
    expect(parseRun(run({ concurrency: null }))).not.toBeNull();
  });
});

describe('perPage and estimateMs', () => {
  it('measures the average per page and the pages per minute', () => {
    expect(perPage(run())).toEqual({ msPerPage: 800, pagesPerMinute: 75 });
  });

  it('has no measure for a run with no visited page or no time', () => {
    expect(perPage(run({ visited: 0 }))).toEqual({ msPerPage: null, pagesPerMinute: null });
    expect(perPage(run({ durationMs: 0 }))).toEqual({ msPerPage: null, pagesPerMinute: null });
  });

  it('estimates from the last run, scaled by the workers: pages x ms per page x workers then / workers now', () => {
    expect(estimateMs(run(), 2, 100)).toBe(8000);
    expect(estimateMs(run(), 4, 100)).toBe(4000);
    expect(estimateMs(run({ total: null }), 2, 100)).toBe(4000); // 5 visited pages, no sitemap count on record
  });

  it('is null with no last run, no workers on record, or nothing measured', () => {
    expect(estimateMs(null, 2, 100)).toBeNull();
    expect(estimateMs(run({ concurrency: null }), 2, 100)).toBeNull();
    expect(estimateMs(run({ visited: 0 }), 2, 100)).toBeNull();
  });

  it('is null when the last run had its own base pause: the measured time per page includes that pause', () => {
    expect(estimateMs(run({ pauseMs: 100 }), 2, 100)).toBe(8000);
    expect(estimateMs(run({ pauseMs: 0 }), 2, 100)).toBeNull();
    expect(estimateMs(run({ pauseMs: 5000 }), 2, 100)).toBeNull();
  });

  it('is null when the last run had photos: its time per page includes the photo work', () => {
    expect(estimateMs(run({ photos: true }), 2, 100)).toBeNull();
    expect(estimateMs(run({ photos: false }), 2, 100)).toBe(8000);
  });

  it('a record from before the pause was kept still estimates, as it did', () => {
    expect(estimateMs(run(), 2, 250)).toBe(8000);
  });
});

describe('photos: the nightly walk prepares the photos only when it is asked to', () => {
  it('is off by default, with no environment value for it', () => {
    expect(envDefaults({}).values.photos).toBe(false);
  });

  it('takes a real boolean only: a string or a number is refused with an Icelandic line', () => {
    expect(validateSettings({ photos: true })).toEqual({ ok: true, value: { photos: true } });
    expect(validateSettings({ photos: false })).toEqual({ ok: true, value: { photos: false } });
    const bad = validateSettings({ photos: 'yes' });
    expect(bad.ok).toBe(false);
    expect(validateSettings({ photos: 1 }).ok).toBe(false);
  });

  it('a saved copy from before the setting existed has no photos: the default applies, and nothing is dropped', () => {
    const p = parseStored({ settings: { at: '06:15' } });
    expect(p.saved).toEqual({ at: '06:15' });
    expect(p.problems).toEqual([]);
    expect(mergeSettings(envDefaults({}).values, p.saved).values.photos).toBe(false);
  });

  it('a saved photos value wins over the default, and is reported as saved', () => {
    const m = mergeSettings(envDefaults({}).values, { photos: true });
    expect(m.values.photos).toBe(true);
    expect(m.source.photos).toBe('saved');
  });

  it('a run record from before the photo fields still parses, with those fields absent', () => {
    const r = parseRun(run());
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('photos');
  });

  it('keeps the base pause of a run record that has it, and refuses one that is not a time', () => {
    expect(parseRun({ ...run(), pauseMs: 250 })).toMatchObject({ pauseMs: 250 });
    expect(parseRun({ ...run(), pauseMs: null })).toMatchObject({ pauseMs: null });
    expect(parseRun(run())).not.toHaveProperty('pauseMs');
    expect(parseRun({ ...run(), pauseMs: -1 })).toBeNull();
    expect(parseRun({ ...run(), pauseMs: '100' })).toBeNull();
  });

  it('keeps the photo fields of a run record that has them, and refuses a count that is not one', () => {
    const r = parseRun({ ...run(), photos: true, photosConverted: 4, photosKept: 2, photosFailed: 1 });
    expect(r).toMatchObject({ photos: true, photosConverted: 4, photosKept: 2, photosFailed: 1 });
    expect(parseRun({ ...run(), photos: 'yes' })).toBeNull();
    expect(parseRun({ ...run(), photosConverted: -1 })).toBeNull();
  });
});

