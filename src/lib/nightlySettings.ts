// The nightly rebuild's settings, as the WordPress page "Síðugeymsla" saves them (wp-mu-plugins/mos-shell-admin.php) and
// the storefront holds a copy of. Pure: validation, the merge with the environment, the shape of the persisted file and
// the estimate. The process side is src/lib/nightlyRebuildRuntime.ts. SERVER-ONLY by use.
//
// Precedence: a field saved here wins; a field not saved falls back to its MOS_SHELL_REBUILD_* environment value, and to
// the built-in default when that is not set. Validation is strict: an out-of-range or mistyped value is refused with a
// line of Icelandic text, never clamped.
import { formatAt, parseConcurrency, parsePauseMs, parseRebuildAt } from './nightlyRebuild';

export interface NightlySettings {
  /** Whether the nightly walk runs at all (off: nothing is armed; a walk already going keeps running). */
  enabled: boolean;
  /** HH:MM, Atlantic/Reykjavik (UTC all year). */
  at: string;
  /** Pages walked at once, 1..4. */
  concurrency: number;
  /** Base pause between renders, in milliseconds, 0..30000. */
  pauseMs: number;
  /** Whether a run missed while no process was up is caught up within CATCH_UP_MS of its time. */
  catchUp: boolean;
}

export const SETTING_KEYS = ['enabled', 'at', 'concurrency', 'pauseMs', 'catchUp'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type SavedSettings = Partial<NightlySettings>;
export type SettingSource = 'saved' | 'env/default';

/** How many finished runs the persisted file keeps (newest first). */
export const RUNS_KEPT = 7;
export const PAUSE_MAX_MS = 30_000;
export const CONCURRENCY_MAX = 4;

const AT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The problem with one field's value, as Icelandic text, or null when it is fine. */
export function fieldProblem(key: SettingKey, value: unknown): string | null {
  switch (key) {
    case 'enabled':
    case 'catchUp':
      return typeof value === 'boolean' ? null : `${key === 'enabled' ? 'Kveikt' : 'Bæta upp keyrslu'} þarf að vera true eða false.`;
    case 'at':
      return typeof value === 'string' && AT.test(value) ? null : 'Tíminn þarf að vera á forminu HH:MM (00:00 til 23:59).';
    case 'concurrency':
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= CONCURRENCY_MAX
        ? null
        : `Fjöldi síðna í einu þarf að vera heiltala frá 1 til ${CONCURRENCY_MAX}.`;
    case 'pauseMs':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= PAUSE_MAX_MS
        ? null
        : `Hlé milli síðna þarf að vera heiltala frá 0 til ${PAUSE_MAX_MS} millisekúndur.`;
  }
}

/** The settings a request sends (POST {action:"settings", settings}): an object of known fields only; a field left out
 *  falls back to the environment. Unknown fields are refused, not ignored. */
export function validateSettings(input: unknown): { ok: true; value: SavedSettings } | { ok: false; problems: string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, problems: ['Stillingarnar eru ekki á réttu formi.'] };
  }
  const obj = input as Record<string, unknown>;
  const problems: string[] = [];
  const value: SavedSettings = {};
  for (const key of Object.keys(obj)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      problems.push(`Óþekktur reitur: ${key}.`);
      continue;
    }
    const p = fieldProblem(key as SettingKey, obj[key]);
    if (p) problems.push(p);
    else (value as Record<string, unknown>)[key] = obj[key];
  }
  return problems.length === 0 ? { ok: true, value } : { ok: false, problems };
}

/** The built-in defaults and the environment's values (MOS_SHELL_REBUILD_AT, _CONCURRENCY, _PAUSE_MS), with a line for
 *  each value the environment holds that cannot be read. The rebuild is OFF by default: an unset MOS_SHELL_REBUILD_AT, or =off, is enabled false (the time stays
 *  05:00); a time in it is enabled true. */
export function envDefaults(env: { at?: string; concurrency?: string; pauseMs?: string }): { values: NightlySettings; problems: string[] } {
  const at = parseRebuildAt(env.at);
  const c = parseConcurrency(env.concurrency);
  const p = parsePauseMs(env.pauseMs);
  return {
    values: {
      // off unless asked for: a time in the environment, or the saved switch (wp-admin), turns the rebuild on
      enabled: at.at.kind === 'at' && (env.at ?? '').trim() !== '',
      at: at.at.kind === 'at' ? formatAt(at.at.minutes) : '05:00',
      concurrency: c.value,
      pauseMs: p.value,
      catchUp: true,
    },
    problems: [at.problem, c.problem, p.problem].filter((x): x is string => x !== null),
  };
}

/** The effective settings and, per field, where each value comes from. A saved field wins; the rest fall back. */
export function mergeSettings(defaults: NightlySettings, saved: SavedSettings | null): { values: NightlySettings; source: Record<SettingKey, SettingSource> } {
  const values = { ...defaults };
  const source = {} as Record<SettingKey, SettingSource>;
  for (const key of SETTING_KEYS) {
    const v = saved?.[key];
    if (v !== undefined) {
      (values as Record<string, unknown>)[key] = v;
      source[key] = 'saved';
    } else {
      source[key] = 'env/default';
    }
  }
  return { values, source };
}

/** One finished run, as the persisted file keeps it. `total` is the sitemap count; `concurrency` the workers it used. */
export interface RunRecord {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  total: number | null;
  visited: number;
  hits: number;
  rendered: number;
  gone: number;
  failures: number;
  stoppedEarly: boolean;
  stoppedWhy: 'failures' | 'stopped' | 'error' | null;
  concurrency: number | null;
}

const COUNT_KEYS = ['visited', 'hits', 'rendered', 'gone', 'failures'] as const;

/** A run read back from the persisted file, checked field by field; null when any value is not of its shape. */
export function parseRun(x: unknown): RunRecord | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  const isMs = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  if (!isMs(r.startedAt) || !isMs(r.endedAt) || !isMs(r.durationMs)) return null;
  if (!COUNT_KEYS.every((k) => isCount(r[k]))) return null;
  if (r.total !== null && !isCount(r.total)) return null;
  if (r.concurrency !== null && fieldProblem('concurrency', r.concurrency) !== null) return null;
  if (typeof r.stoppedEarly !== 'boolean') return null;
  if (r.stoppedWhy !== null && r.stoppedWhy !== 'failures' && r.stoppedWhy !== 'stopped' && r.stoppedWhy !== 'error') return null;
  return {
    startedAt: r.startedAt as number,
    endedAt: r.endedAt as number,
    durationMs: r.durationMs as number,
    total: r.total as number | null,
    visited: r.visited as number,
    hits: r.hits as number,
    rendered: r.rendered as number,
    gone: r.gone as number,
    failures: r.failures as number,
    stoppedEarly: r.stoppedEarly,
    stoppedWhy: r.stoppedWhy as RunRecord['stoppedWhy'],
    concurrency: r.concurrency as number | null,
  };
}

/** The persisted file: { settings, runs }. Every value is checked again on the way in, so a hand-edited or older file
 *  cannot bypass the bounds: a bad field is dropped (and named in `problems`), a bad run is dropped. */
export function parseStored(raw: unknown): { saved: SavedSettings | null; runs: RunRecord[]; problems: string[] } {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { saved: null, runs: [], problems };
  const r = raw as Record<string, unknown>;
  let saved: SavedSettings | null = null;
  if (typeof r.settings === 'object' && r.settings !== null && !Array.isArray(r.settings)) {
    const s = r.settings as Record<string, unknown>;
    const kept: SavedSettings = {};
    for (const key of SETTING_KEYS) {
      if (s[key] === undefined) continue;
      const p = fieldProblem(key, s[key]);
      if (p) problems.push(`${key}: ${p}`);
      else (kept as Record<string, unknown>)[key] = s[key];
    }
    saved = Object.keys(kept).length > 0 ? kept : null;
  }
  const runs = Array.isArray(r.runs)
    ? r.runs.map(parseRun).filter((x): x is RunRecord => x !== null).slice(0, RUNS_KEPT)
    : [];
  return { saved, runs, problems };
}

/** The per-page figures of a run: its measured average and the pages per minute. Null when the run has no measure. */
export function perPage(run: Pick<RunRecord, 'durationMs' | 'visited'>): { msPerPage: number | null; pagesPerMinute: number | null } {
  if (run.visited <= 0 || run.durationMs <= 0) return { msPerPage: null, pagesPerMinute: null };
  return { msPerPage: run.durationMs / run.visited, pagesPerMinute: (run.visited * 60_000) / run.durationMs };
}

/** The duration (ms) of a run of every page at `concurrency` workers, estimated from the last run's measured time per page.
 *  The last run's workers scale it linearly. Null when the last run has no measure, or it did not record its workers. */
export function estimateMs(last: RunRecord | null, concurrency: number): number | null {
  if (!last || last.concurrency === null) return null;
  const { msPerPage } = perPage(last);
  if (msPerPage === null) return null;
  const pages = last.total ?? last.visited;
  return Math.round((pages * msPerPage * last.concurrency) / concurrency);
}
