// The nightly rebuild's schedule (05:00 Reykjavik, UTC all year), its origin, and the walk: N workers (two by default)
// sharing one queue, one bad answer dropping to one worker with the pause doubling, the stop after a run of failures,
// and only the path of each sitemap URL taken.
import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_MS,
  missedRun,
  msUntilNextRun,
  parseRebuildAt,
  rebuildOrigin,
  runDue,
  scheduleWhy,
  scheduledAtOrBefore,
  walkStorefront,
  isWalkablePath,
  WALK_DEFAULTS,
  parseConcurrency,
  parsePauseMs,
  parseRetryAfter,
  type WalkIo,
  type WalkOptions,
} from './nightlyRebuild';
import { sitemapPathsFrom } from '../../scripts/prebuild_shells.mjs';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const FIVE = 5 * 60;
// 2026-11-19 00:00 UTC
const MIDNIGHT = Date.UTC(2026, 10, 19);

describe('parseRebuildAt', () => {
  it('defaults to 05:00, reads HH:MM, and turns off on "off"', () => {
    expect(parseRebuildAt(undefined)).toEqual({ at: { kind: 'at', minutes: FIVE }, problem: null });
    expect(parseRebuildAt('')).toEqual({ at: { kind: 'at', minutes: FIVE }, problem: null });
    expect(parseRebuildAt('04:30').at).toEqual({ kind: 'at', minutes: 270 });
    expect(parseRebuildAt(' off ').at).toEqual({ kind: 'off' });
  });

  it('falls back to 05:00 with a problem for a value it cannot read', () => {
    const r = parseRebuildAt('5 am');
    expect(r.at).toEqual({ kind: 'at', minutes: FIVE });
    expect(r.problem).toMatch(/MOS_SHELL_REBUILD_AT/);
    expect(r.problem).toMatch(/stays off/);
    expect(parseRebuildAt('25:00').problem).not.toBeNull();
  });
});

describe('schedule (Atlantic/Reykjavik is UTC all year)', () => {
  it('finds the latest 05:00 at or before a moment', () => {
    expect(scheduledAtOrBefore(MIDNIGHT + 6 * 60 * MIN, FIVE)).toBe(MIDNIGHT + FIVE * MIN);
    expect(scheduledAtOrBefore(MIDNIGHT + 4 * 60 * MIN, FIVE)).toBe(MIDNIGHT + FIVE * MIN - DAY);
    expect(scheduledAtOrBefore(MIDNIGHT + FIVE * MIN, FIVE)).toBe(MIDNIGHT + FIVE * MIN);
  });

  it('says how long until the next run', () => {
    expect(msUntilNextRun(MIDNIGHT, FIVE)).toBe(FIVE * MIN);
    expect(msUntilNextRun(MIDNIGHT + 6 * 60 * MIN, FIVE)).toBe(23 * 60 * MIN);
    // exactly at the time: the next one is a day away
    expect(msUntilNextRun(MIDNIGHT + FIVE * MIN, FIVE)).toBe(DAY);
    // a timer that fires a millisecond early waits the millisecond
    expect(msUntilNextRun(MIDNIGHT + FIVE * MIN - 1, FIVE)).toBe(1);
  });

  it('is due at the time, and within three hours after it when the run has not happened today', () => {
    const due = MIDNIGHT + FIVE * MIN;
    expect(runDue(due, FIVE, null)).toBe(true);
    expect(runDue(due + CATCH_UP_MS, FIVE, null)).toBe(true);
    expect(runDue(due + CATCH_UP_MS + 1, FIVE, null)).toBe(false);
    expect(runDue(due - 1, FIVE, null)).toBe(false);
  });

  it('is not due again once today has run, or when the run started at the time', () => {
    const due = MIDNIGHT + FIVE * MIN;
    expect(runDue(due + MIN, FIVE, due + 2)).toBe(false);
    expect(runDue(due - 1, FIVE, due)).toBe(false);
    // yesterday's run does not count for today
    expect(runDue(due + MIN, FIVE, due - DAY)).toBe(true);
  });

  it("says a run was missed once it is past the catch-up window with no run since", () => {
    const due = MIDNIGHT + FIVE * MIN;
    expect(missedRun(due + CATCH_UP_MS, FIVE, due - DAY)).toBe(false);
    expect(missedRun(due + CATCH_UP_MS + MIN, FIVE, due - DAY)).toBe(true);
    expect(missedRun(due + CATCH_UP_MS + MIN, FIVE, null)).toBe(true);
    // done today: not missed, however late
    expect(missedRun(due + CATCH_UP_MS + MIN, FIVE, due + 2)).toBe(false);
  });
});

describe('rebuildOrigin', () => {
  it('uses MOS_SHELL_REBUILD_BASE (origin only) when set', () => {
    expect(rebuildOrigin('http://127.0.0.1:10026/some/path', 'other.example.is')).toEqual({ origin: 'http://127.0.0.1:10026', problem: null });
  });

  it('otherwise uses the first host of MOS_EXTRA_ALLOWED_HOSTS as https', () => {
    expect(rebuildOrigin(undefined, ' New.Musikogsport.is , staging.example.is')).toEqual({ origin: 'https://new.musikogsport.is', problem: null });
  });

  it('is null with nothing configured, and reports a bad value', () => {
    expect(rebuildOrigin(undefined, undefined)).toEqual({ origin: null, problem: null });
    expect(rebuildOrigin('ftp://x.is', undefined).origin).toBeNull();
    expect(rebuildOrigin('not a url', undefined).problem).not.toBeNull();
    expect(rebuildOrigin(undefined, '*.ondigitalocean.app').origin).toBeNull();
  });
});

describe('sitemapPathsFrom (the prebuild script\'s parser, reused)', () => {
  it('keeps product and category paths once each, drops pagination and other hosts\' paths', () => {
    const xml = [
      '<urlset>',
      '<url><loc>https://new.musikogsport.is/vara/a-b/</loc></url>',
      '<url><loc>https://new.musikogsport.is/vara/a-b/</loc></url>',
      '<url><loc>https://new.musikogsport.is/verslun/kyn/x/</loc></url>',
      '<url><loc>https://new.musikogsport.is/verslun/page/2/</loc></url>',
      '<url><loc>https://new.musikogsport.is/um-okkur/</loc></url>',
      '</urlset>',
    ].join('');
    expect(sitemapPathsFrom(xml)).toEqual(['/vara/a-b/', '/verslun/kyn/x/']);
  });
});

describe('isWalkablePath', () => {
  it('takes only plain absolute paths: never a protocol-relative or backslash form', () => {
    expect(isWalkablePath('/vara/a/')).toBe(true);
    expect(isWalkablePath('//evil.example/vara/')).toBe(false);
    expect(isWalkablePath('/\\evil.example')).toBe(false);
    expect(isWalkablePath('vara/a/')).toBe(false);
  });
});

/** A fake storefront: each path answers from a script of [status, shell] per call; time moves with sleeps. */
function fakeIo(script: Record<string, [number, string | null][]>, opts: { renderMs?: number } = {}) {
  let t = 0;
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const progress: unknown[] = [];
  const io: WalkIo = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    get: async (path) => {
      calls.push(path);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const next = script[path]?.shift() ?? [200, 'hit'];
      t += next[1] === 'miss' || next[1] === 'refused' ? (opts.renderMs ?? 100) : 1;
      inFlight -= 1;
      return { status: next[0], shell: next[1] };
    },
    progress: (x) => progress.push(x),
  };
  return { io, calls, maxInFlight: () => maxInFlight, progress, now: () => t };
}

const OPTS: WalkOptions = { ...WALK_DEFAULTS, concurrency: 1, delayMs: 1000, pollMs: 500, maxWaitMs: 60_000, slowMs: 3000, maxFailures: 5, limit: Infinity, progressEvery: 500 };

/** A storefront that models the server's renders, not the client's requests (the walk awaits each request, so counting
 *  client requests in flight proves nothing). A miss renders for renderMs and the request waits for it. A stored page
 *  that is stale starts a background refresh of renderMs, which the answers report as X-Mos-Refresh: running until it
 *  ends (a refresh of a `failing` page ends stale; a `backoff` page starts none, and answers idle). Every render is
 *  recorded as [start, end], so a test can check that no two renders overlap on the server. */
function renderFake(opts: { renderMs?: number; stale?: string[]; failing?: string[]; backoff?: string[]; fail500?: string[] } = {}) {
  let t = 0;
  const ms = opts.renderMs ?? 100;
  const renders: [number, number, string][] = [];
  const calls: string[] = [];
  const state = new Map<string, 'miss' | 'stale' | 'hit'>();
  for (const p of opts.stale ?? []) state.set(p, 'stale');
  const running = new Map<string, number>();
  const settle = () => {
    for (const [p, end] of running) {
      if (end > t) continue;
      running.delete(p);
      state.set(p, (opts.failing ?? []).includes(p) ? 'stale' : 'hit');
    }
  };
  const io: WalkIo = {
    now: () => t,
    sleep: async (d) => {
      t += d;
      settle();
    },
    get: async (path) => {
      calls.push(path);
      settle();
      if (running.has(path)) return { status: 200, shell: 'stale', refreshing: true };
      const s = state.get(path) ?? 'miss';
      if ((opts.fail500 ?? []).includes(path) && s === 'stale') {
        // a refresh that is answered 500 at once: the walk counts it bad without polling; its render still runs
        renders.push([t, t + ms, path]);
        running.set(path, t + ms);
        return { status: 500, shell: 'stale', refreshing: true };
      }
      if (s === 'stale') {
        if ((opts.backoff ?? []).includes(path)) return { status: 200, shell: 'stale', refreshing: false };
        renders.push([t, t + ms, path]);
        running.set(path, t + ms);
        return { status: 200, shell: 'stale', refreshing: true };
      }
      if (s === 'miss') {
        renders.push([t, t + ms, path]);
        t += ms;
        settle();
        state.set(path, 'hit');
        return { status: 200, shell: 'miss', refreshing: false };
      }
      return { status: 200, shell: 'hit', refreshing: false };
    },
    progress: () => undefined,
  };
  const overlapping = () => {
    const sorted = [...renders].sort((a, b) => a[0] - b[0]);
    return sorted.some((r, i) => i > 0 && r[0] < sorted[i - 1][1]);
  };
  return { io, calls, renders, overlapping };
}

describe('walkStorefront', () => {
  it('never overlaps two renders: a stale page is walked until its refresh ends, then the next path renders', async () => {
    const f = renderFake({ stale: ['/vara/a/'], renderMs: 200 });
    const tally = await walkStorefront(['/vara/a/', '/vara/b/'], OPTS, f.io);
    expect(f.overlapping()).toBe(false);
    expect(f.renders.map((r) => r[2])).toEqual(['/vara/a/', '/vara/b/']);
    expect(tally).toMatchObject({ visited: 2, failures: 0, stoppedEarly: false });
  });

  it('a refresh that outlasts maxWaitMs counts as a failure, but the walk still waits for it to end', async () => {
    // The refresh outlasts maxWaitMs (100) and ends before twice that, so a walk that moved on would overlap it. slowMs
    // is raised so that only the timeout counts (the render itself is slow by design here).
    const f = renderFake({ stale: ['/vara/a/'], renderMs: 150 });
    const tally = await walkStorefront(['/vara/a/', '/vara/b/'], { ...OPTS, maxWaitMs: 100, pollMs: 50, slowMs: 60_000 }, f.io);
    expect(tally.failures).toBe(1);
    expect(f.overlapping()).toBe(false);
    expect(f.renders[1][0]).toBeGreaterThanOrEqual(f.renders[0][1]);
  });

  it('a stale page whose refresh failed (backoff on) is a failure, and the walk moves on at once', async () => {
    const f = renderFake({ stale: ['/vara/a/'], backoff: ['/vara/a/'] });
    const tally = await walkStorefront(['/vara/a/', '/vara/b/'], OPTS, f.io);
    expect(tally).toMatchObject({ visited: 2, failures: 1 });
    expect(f.renders.map((r) => r[2])).toEqual(['/vara/b/']);
  });

  it('a render slower than slowMs is requested once, never again (a retry would start a second render)', async () => {
    const f = renderFake({ renderMs: 3500 });
    const tally = await walkStorefront(['/vara/a/'], OPTS, f.io);
    expect(f.calls).toEqual(['/vara/a/']);
    expect(tally.failures).toBe(1);
  });

  it('calls `before` once per path, before its first request', async () => {
    const f = renderFake();
    const order: string[] = [];
    const io: WalkIo = {
      ...f.io,
      before: async (path) => void order.push(`before ${path}`),
      get: async (path) => (order.push(`get ${path}`), f.io.get(path)),
    };
    await walkStorefront(['/vara/a/', '/vara/b/'], OPTS, io);
    expect(order).toEqual(['before /vara/a/', 'get /vara/a/', 'before /vara/b/', 'get /vara/b/']);
  });

  it('counts a page that is fresh at once as a hit, and a 404 or redirect as gone (not a failure)', async () => {
    const f = fakeIo({ '/vara/a/': [[200, 'hit']], '/vara/b/': [[404, null]], '/vara/c/': [[301, null]] });
    const tally = await walkStorefront(['/vara/a/', '/vara/b/', '/vara/c/'], OPTS, f.io);
    expect(tally).toMatchObject({ visited: 3, hits: 1, gone: 2, failures: 0 });
  });

  it('doubles the pause on a 5xx and halves it back on a good answer', async () => {
    const f = fakeIo({ '/vara/a/': [[500, null]], '/vara/b/': [[200, 'miss']], '/vara/c/': [[200, 'miss']] });
    const before = f.now();
    await walkStorefront(['/vara/a/', '/vara/b/', '/vara/c/'], OPTS, f.io);
    // a: 1 ms, bad -> pause 2000; b: 100 ms render, good -> pause 1000; c: 100 ms render, last (no pause)
    expect(f.now() - before).toBe(1 + 2000 + 100 + 1000 + 100);
  });

  it('counts a slow answer (over slowMs) as bad: a render that stalls past it', async () => {
    const f = fakeIo({ '/vara/a/': [[200, 'miss']], '/vara/b/': [[200, 'miss']] }, { renderMs: 3500 });
    const tally = await walkStorefront(['/vara/a/', '/vara/b/'], OPTS, f.io);
    expect(tally.failures).toBe(2);
  });

  it('stops after five failures in a row, and says it stopped early', async () => {
    const script: Record<string, [number, string | null][]> = {};
    const paths = Array.from({ length: 9 }, (_, i) => `/vara/p${i}/`);
    for (const p of paths) script[p] = [[503, null]];
    const f = fakeIo(script);
    const tally = await walkStorefront(paths, OPTS, f.io);
    expect(tally.visited).toBe(5);
    expect(tally.failures).toBe(5);
    expect(tally.stoppedEarly).toBe(true);
    expect(f.calls).toHaveLength(5);
  });

  it('hands the after hook a stop that is true once the walk has halted, for a page still in flight', async () => {
    const f = fakeIo({ '/vara/bad/': [[500, null]], '/vara/ok/': [[200, 'hit']] });
    const seen: boolean[] = [];
    // a third page is left for the halt to skip, so the walk stops early
    const io: WalkIo = {
      ...f.io,
      after: async (path, _last, stop) => {
        if (path !== '/vara/ok/') return;
        // this page is in flight while the other one fails and halts the walk
        await new Promise((r) => setTimeout(r, 5));
        seen.push(stop());
      },
    };
    const tally = await walkStorefront(['/vara/bad/', '/vara/ok/', '/vara/left/'], { ...OPTS, concurrency: 2, maxFailures: 1 }, io);
    expect(tally.stoppedEarly).toBe(true);
    expect(f.calls).not.toContain('/vara/left/');
    expect(seen).toEqual([true]);
  });

  it('a failure run broken by a good answer does not stop the walk', async () => {
    const script: Record<string, [number, string | null][]> = {};
    const paths = Array.from({ length: 8 }, (_, i) => `/vara/p${i}/`);
    paths.forEach((p, i) => (script[p] = [i % 4 === 3 ? [200, 'hit'] : [500, null]]));
    const tally = await walkStorefront(paths, OPTS, fakeIo(script).io);
    expect(tally.visited).toBe(8);
    expect(tally.stoppedEarly).toBe(false);
  });

  it('takes at most `limit` paths, and reports progress every progressEvery pages', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/vara/p${i}/`);
    const f = fakeIo({});
    const tally = await walkStorefront(paths, { ...OPTS, limit: 5, progressEvery: 2 }, f.io);
    expect(tally.visited).toBe(5);
    expect(f.progress).toHaveLength(2);
  });

  it('skips paths that are not plain paths', async () => {
    const f = fakeIo({});
    const tally = await walkStorefront(['//evil.example/vara/', '/vara/ok/'], OPTS, f.io);
    expect(f.calls).toEqual(['/vara/ok/']);
    expect(tally.visited).toBe(1);
  });
});

describe('walkStorefront: the slow rule reads the storefront\'s first answer (review 17)', () => {
  it('a healthy stale refresh longer than slowMs is not a failure: the page is being rebuilt, not answered slowly', async () => {
    const paths = Array.from({ length: 6 }, (_, i) => `/vara/p${i}/`);
    const f = renderFake({ stale: paths, renderMs: 3500 });
    const tally = await walkStorefront(paths, { ...OPTS, concurrency: 1 }, f.io);
    expect(tally).toMatchObject({ visited: 6, failures: 0, stoppedEarly: false, stoppedBy: null });
    expect(f.renders).toHaveLength(6);
  });
});

describe('walkStorefront: any answer but a success, a redirect or a gone page is bad (review 19)', () => {
  it.each([403, 429])('a %i answer is a failure: the pause grows and five in a row stop the walk', async (status) => {
    const paths = Array.from({ length: 12 }, (_, i) => `/vara/p${i}/`);
    const script = Object.fromEntries(paths.map((p) => [p, [[status, null]]])) as Record<string, [number, string | null][]>;
    const tally = await walkStorefront(paths, { ...OPTS, concurrency: 1 }, fakeIo(script).io);
    expect(tally).toMatchObject({ visited: 5, failures: 5, stoppedEarly: true, stoppedBy: 'failures' });
  });

  it('a single 429 is a failure, but a 410 is still a gone page and not a failure', async () => {
    const one = await walkStorefront(['/vara/a/'], OPTS, fakeIo({ '/vara/a/': [[429, null]] }).io);
    expect(one).toMatchObject({ visited: 1, failures: 1, stoppedBy: null });
    const gone = await walkStorefront(['/vara/a/'], OPTS, fakeIo({ '/vara/a/': [[410, null]] }).io);
    expect(gone).toMatchObject({ visited: 1, failures: 0, gone: 1 });
  });

  it('honours Retry-After on a bad answer: the next pause is what the server asked, capped at 30 s', async () => {
    const pausesFor = async (retryAfter: string | null) => {
      const pauses: number[] = [];
      let t = 0;
      const io: WalkIo = {
        get: async () => ({ status: 429, shell: null, retryAfter }),
        sleep: async (ms) => void (t += ms),
        now: () => t,
        progress: () => undefined,
        step: (s) => pauses.push(s.pauseMs),
      };
      await walkStorefront(['/vara/a/'], { ...OPTS, concurrency: 1, delayMs: 100 }, io);
      return pauses[0];
    };
    expect(await pausesFor('10')).toBe(10_000);
    expect(await pausesFor('3600')).toBe(30_000);
    // without the header the backoff alone decides
    expect(await pausesFor(null)).toBe(200);
  });
});

describe('walkStorefront: a base pause of 0 backs off from a floor (review 3)', () => {
  it('doubles from the floor, and returns to two workers only with the pause back at 0', async () => {
    const bad = Array.from({ length: 4 }, (_, i) => `/vara/bad${i}/`);
    const good = Array.from({ length: 20 }, (_, i) => `/vara/good${i}/`);
    const script = Object.fromEntries(bad.map((p) => [p, [[503, null]]])) as Record<string, [number, string | null][]>;
    const f = fakeIo(script);
    const steps: { workers: number; pauseMs: number }[] = [];
    const io: WalkIo = { ...f.io, step: (s) => steps.push({ workers: s.workers, pauseMs: s.pauseMs }) };
    await walkStorefront([...bad, ...good], { ...WALK_DEFAULTS, concurrency: 2, delayMs: 0, pollMs: 50, maxFailures: 5 }, io);
    expect(steps.slice(0, 4).map((s) => s.pauseMs)).toEqual([200, 400, 800, 1600]);
    // the pause halves back to 0 after eleven good answers; the twentieth good answer restores two workers
    expect(steps[22].workers).toBe(1);
    expect(steps[23]).toMatchObject({ workers: 2, pauseMs: 0 });
  });
});

describe('parseRetryAfter', () => {
  // 2026-11-19 05:00 UTC
  const NOW = Date.UTC(2026, 10, 19, 5, 0, 0);
  it('reads delay-seconds or an HTTP-date as milliseconds from now, and undefined for none or an unreadable value', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120_000);
    expect(parseRetryAfter(' 0 ', NOW)).toBe(0);
    expect(parseRetryAfter('Thu, 19 Nov 2026 05:01:00 GMT', NOW)).toBe(60_000);
    expect(parseRetryAfter('Thu, 19 Nov 2026 04:59:00 GMT', NOW)).toBe(0);
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter('', NOW)).toBeUndefined();
    expect(parseRetryAfter('soon', NOW)).toBeUndefined();
  });
});

describe('scheduleWhy', () => {
  const ok = { storeOn: true, atOff: false, hasBase: true, armed: true };
  it('says what is missing, in order: the store, the switch, the base, then waiting for the first request', () => {
    expect(scheduleWhy({ ...ok, storeOn: false })).toBe('store-off');
    expect(scheduleWhy({ ...ok, atOff: true })).toBe('off');
    expect(scheduleWhy({ ...ok, hasBase: false })).toBe('no-base');
    expect(scheduleWhy({ ...ok, armed: false })).toBe('waiting');
    expect(scheduleWhy(ok)).toBeNull();
  });
});

describe('walkStorefront stop and step', () => {
  // Every path answers a plain hit, except the ones listed as bad (status 500).
  const plainIo = (bad: string[] = []) => {
    const visited: string[] = [];
    const steps: { path: string; bad: boolean; pauseMs: number }[] = [];
    let stopAfter = Infinity;
    let t = 0;
    const io: WalkIo = {
      get: async (path) => {
        visited.push(path);
        return bad.includes(path) ? { status: 500, shell: 'miss' } : { status: 200, shell: 'hit' };
      },
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
      progress: () => undefined,
      stop: () => visited.length >= stopAfter,
      step: (s) => steps.push({ path: s.path, bad: s.bad, pauseMs: s.pauseMs }),
    };
    return { io, visited, steps, stopAfterVisits: (n: number) => (stopAfter = n) };
  };

  it('reports each counted path with its pause, in order', async () => {
    const f = plainIo(['/vara/b/']);
    await walkStorefront(['/vara/a/', '/vara/b/', '/vara/c/'], OPTS, f.io);
    expect(f.steps.map((s) => s.path)).toEqual(['/vara/a/', '/vara/b/', '/vara/c/']);
    expect(f.steps.map((s) => s.bad)).toEqual([false, true, false]);
    expect(f.steps[1].pauseMs).toBeGreaterThan(0);
  });

  it('stops before the next path when the stop flag is set, and says why', async () => {
    const f = plainIo();
    f.stopAfterVisits(2);
    const tally = await walkStorefront(['/vara/a/', '/vara/b/', '/vara/c/', '/vara/d/'], OPTS, f.io);
    expect(f.visited).toEqual(['/vara/a/', '/vara/b/']);
    expect(tally).toMatchObject({ visited: 2, stoppedEarly: true, stoppedBy: 'stopped' });
  });

  it('a run of failures stops with stoppedBy failures; a clean run has none', async () => {
    const bad = ['/vara/a/', '/vara/b/', '/vara/c/', '/vara/d/', '/vara/e/'];
    const f = plainIo(bad);
    const tally = await walkStorefront([...bad, '/vara/f/'], OPTS, f.io);
    expect(tally).toMatchObject({ stoppedEarly: true, stoppedBy: 'failures' });
    const clean = await walkStorefront(['/vara/a/'], OPTS, plainIo().io);
    expect(clean.stoppedBy).toBeNull();
  });
});

describe('walkStorefront with a refresh that never ends', () => {
  // A stale page whose refresh reports "running" forever. The fake throws after many reads, so a walk that never ends
  // fails the test instead of hanging it.
  function stuckIo(stopAfterMs?: number) {
    let t = 0;
    let reads = 0;
    return {
      io: {
        get: async () => {
          if (++reads > 5000) throw new Error('walk did not end');
          return { status: 200, shell: 'stale', refreshing: true };
        },
        sleep: async (ms: number) => void (t += ms),
        now: () => t,
        progress: () => undefined,
        stop: stopAfterMs === undefined ? undefined : () => t >= stopAfterMs,
      },
      reads: () => reads,
    };
  }

  it('ends the walk after twice maxWaitMs, the page counted as a failure, and does not go on to the next page', async () => {
    const s = stuckIo();
    const tally = await walkStorefront(['/vara/a/', '/vara/b/'], { ...WALK_DEFAULTS, concurrency: 1, delayMs: 0, pollMs: 100, maxWaitMs: 1000 }, s.io);
    expect(tally).toMatchObject({ visited: 1, failures: 1, stoppedEarly: true, stoppedBy: 'failures' });
  });

  it('honours the stop request while it waits for a refresh', async () => {
    const s = stuckIo(300);
    const tally = await walkStorefront(['/vara/a/', '/vara/b/'], { ...WALK_DEFAULTS, concurrency: 1, delayMs: 0, pollMs: 100, maxWaitMs: 90_000 }, s.io);
    expect(tally).toMatchObject({ visited: 0, stoppedEarly: true, stoppedBy: 'stopped' });
  });
});

describe('parseConcurrency and parsePauseMs', () => {
  it('reads an integer 1..4 for the workers, default 2, with a problem for anything else', () => {
    expect(parseConcurrency(undefined)).toEqual({ value: 2, problem: null });
    expect(parseConcurrency(' 3 ')).toEqual({ value: 3, problem: null });
    expect(parseConcurrency('0').value).toBe(2);
    expect(parseConcurrency('5').value).toBe(2);
    expect(parseConcurrency('two').value).toBe(2);
    expect(parseConcurrency('2.5').problem).toMatch(/MOS_SHELL_REBUILD_CONCURRENCY/);
    expect(parseConcurrency('0').problem).not.toBeNull();
  });

  it('reads a base pause 0..30000 ms, default 100, with a problem for anything else', () => {
    expect(parsePauseMs(undefined)).toEqual({ value: 100, problem: null });
    expect(parsePauseMs('0')).toEqual({ value: 0, problem: null });
    expect(parsePauseMs('30000').value).toBe(30000);
    expect(parsePauseMs('30001').value).toBe(100);
    expect(parsePauseMs('-5').problem).toMatch(/MOS_SHELL_REBUILD_PAUSE_MS/);
    expect(parsePauseMs('fast').value).toBe(100);
  });
});

describe('walkStorefront with N workers', () => {
  it('a stale page is walked with the others: two renders overlap at N=2, never more', async () => {
    const f = renderFake({ stale: ['/vara/a/', '/vara/b/', '/vara/c/', '/vara/d/'], renderMs: 200 });
    const tally = await walkStorefront(['/vara/a/', '/vara/b/', '/vara/c/', '/vara/d/'], { ...OPTS, concurrency: 2, pollMs: 50 }, f.io);
    expect(tally).toMatchObject({ visited: 4, failures: 0, stoppedEarly: false });
    expect(maxOverlap(f.renders)).toBe(2);
  });

  it('after a bad answer only one render starts at a time, until the walk recovers', async () => {
    // p0 answers 500 after its render; every other page is a stale page with a 200 render.
    const stale = Array.from({ length: 12 }, (_, i) => `/vara/p${i}/`);
    const f = renderFake({ stale, renderMs: 200, fail500: ['/vara/p0/'] });
    const seen: { at: number; workers: number; bad: boolean }[] = [];
    const io: WalkIo = { ...f.io, step: (s) => seen.push({ at: s.at, workers: s.workers, bad: s.bad }) };
    await walkStorefront(stale, { ...OPTS, concurrency: 2, pollMs: 50, delayMs: 100 }, io);
    const firstBad = seen.find((s) => s.bad)!.at;
    expect(seen[0].workers).toBe(1);
    // a render that starts after the first bad answer never starts while another render is still running
    const later = f.renders.filter((r) => r[0] >= firstBad);
    for (const r of later) {
      const others = f.renders.filter((o) => o !== r && o[0] <= r[0] && o[1] > r[0]);
      expect(others).toHaveLength(0);
    }
    expect(f.renders.length).toBeGreaterThan(3);
  });

  it('returns to two workers only after 20 good answers in a row, with the pause back at the base', async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `/vara/p${i}/`);
    const script: Record<string, [number, string | null][]> = { [paths[0]]: [[500, null]] };
    const f = fakeIo(script);
    const steps: { workers: number; bad: boolean; pauseMs: number }[] = [];
    const io: WalkIo = { ...f.io, step: (s) => steps.push({ workers: s.workers, bad: s.bad, pauseMs: s.pauseMs }) };
    await walkStorefront(paths, { ...WALK_DEFAULTS, delayMs: 100, pollMs: 50, maxFailures: 5 }, io);
    expect(steps[0]).toMatchObject({ bad: true, workers: 1 });
    // the 19th good answer after the bad one is still one worker; the 20th restores two
    expect(steps[19].workers).toBe(1);
    expect(steps[20].workers).toBe(2);
    expect(steps[20].pauseMs).toBe(100);
  });

  it('counts failures in a row across workers: five bad answers stop the walk', async () => {
    const paths = Array.from({ length: 9 }, (_, i) => `/vara/p${i}/`);
    const script: Record<string, [number, string | null][]> = {};
    for (const p of paths) script[p] = [[503, null]];
    const f = fakeIo(script);
    const tally = await walkStorefront(paths, { ...WALK_DEFAULTS, delayMs: 0 }, f.io);
    expect(tally).toMatchObject({ failures: 5, stoppedEarly: true, stoppedBy: 'failures' });
  });
});

/** The largest number of render intervals open at one moment. */
function maxOverlap(renders: [number, number, string][]): number {
  let max = 0;
  for (const r of renders) {
    const open = renders.filter((o) => o[0] <= r[0] && o[1] > r[0]).length;
    max = Math.max(max, open);
  }
  return max;
}

describe('walkStorefront when a worker throws or the walk is halted', () => {
  it('a throw in one worker ends the walk for the other: it rejects only after the other has stopped, and starts no new page', async () => {
    let inFlight = 0;
    const calls: string[] = [];
    const io: WalkIo = {
      before: async (path) => {
        if (path === '/vara/b/') throw new Error('the store went away');
      },
      get: async (path) => {
        calls.push(path);
        inFlight += 1;
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        return { status: 200, shell: 'hit' };
      },
      sleep: async () => undefined,
      now: () => 0,
      progress: () => undefined,
    };
    const paths = ['/vara/a/', '/vara/b/', '/vara/c/', '/vara/d/'];
    let inFlightAtRejection: number | null = null;
    await walkStorefront(paths, { ...WALK_DEFAULTS, concurrency: 2, delayMs: 0 }, io).catch((err: Error) => {
      inFlightAtRejection = inFlight;
      expect(err.message).toBe('the store went away');
    });
    expect(inFlightAtRejection).toBe(0);
    expect(calls).toEqual(['/vara/a/']);
  });

  it('a throw does not leave a slot taken: the walk ends instead of spinning in the slot wait', async () => {
    let sleeps = 0;
    const io: WalkIo = {
      before: async (path) => {
        if (path === '/vara/a/') throw new Error('boom');
      },
      get: async () => ({ status: 500, shell: 'miss' }),
      sleep: async () => {
        if (++sleeps > 1000) throw new Error('slot wait never ended');
      },
      now: () => 0,
      progress: () => undefined,
    };
    await expect(walkStorefront(['/vara/a/', '/vara/b/', '/vara/c/'], { ...WALK_DEFAULTS, concurrency: 2, delayMs: 0 }, io)).rejects.toThrow('boom');
    expect(sleeps).toBeLessThan(1000);
  });

  it('a stop during a long pause ends the walk within a poll, not after the whole pause', async () => {
    let t = 0;
    const visited: string[] = [];
    const io: WalkIo = {
      get: async (path) => {
        visited.push(path);
        return { status: 500, shell: 'miss' };
      },
      sleep: async (ms) => void (t += ms),
      now: () => t,
      progress: () => undefined,
      stop: () => t >= 1000,
    };
    const tally = await walkStorefront(['/vara/a/', '/vara/b/'], { ...WALK_DEFAULTS, concurrency: 1, delayMs: 30_000, pollMs: 100, maxFailures: 5 }, io);
    expect(visited).toEqual(['/vara/a/']);
    expect(tally).toMatchObject({ visited: 1, stoppedBy: 'stopped' });
    expect(t).toBeLessThan(2000);
  });

  it('a worker halted by failures stops its sibling that is polling a refresh, and the walk does not wait out the refresh', async () => {
    let t = 0;
    let reads = 0;
    const io: WalkIo = {
      get: async (path) => {
        if (path === '/vara/b/') return { status: 500, shell: 'miss' };
        if (++reads > 5000) throw new Error('walk did not end');
        return { status: 200, shell: 'stale', refreshing: true };
      },
      sleep: async (ms) => void (t += ms),
      now: () => t,
      progress: () => undefined,
    };
    const tally = await walkStorefront(['/vara/a/', '/vara/b/', '/vara/c/'], { ...WALK_DEFAULTS, concurrency: 2, delayMs: 0, pollMs: 100, maxWaitMs: 90_000, maxFailures: 1 }, io);
    expect(t).toBeLessThan(10_000);
    expect(tally).toMatchObject({ failures: 1, stoppedBy: 'failures' });
  });
});

describe('after: the photo hook of a page (the walk counts nothing from it)', () => {
  it('is called once per settled page, with the page\'s last answer and its body, before the pause', async () => {
    const f = fakeIo({});
    const seen: { path: string; status: number; html: unknown }[] = [];
    const order: string[] = [];
    const io: WalkIo = {
      ...f.io,
      get: async (path) => ({ status: 200, shell: 'miss', html: `<p>${path}</p>` }),
      after: async (path, last) => {
        seen.push({ path, status: last.status, html: last.html });
        order.push(`after ${path}`);
      },
      sleep: async (ms) => {
        order.push(`sleep ${ms}`);
      },
    };
    await walkStorefront(['/vara/a/', '/vara/b/'], OPTS, io);
    expect(seen).toEqual([
      { path: '/vara/a/', status: 200, html: '<p>/vara/a/</p>' },
      { path: '/vara/b/', status: 200, html: '<p>/vara/b/</p>' },
    ]);
    expect(order.indexOf('after /vara/a/')).toBeLessThan(order.findIndex((x) => x.startsWith('sleep')));
  });

  it('photo work never counts as a bad answer: a run of pages whose photos all fail has no failures and runs to the end', async () => {
    const f = fakeIo({});
    const tally = await walkStorefront(
      ['/vara/a/', '/vara/b/', '/vara/c/'],
      { ...OPTS, maxFailures: 1, concurrency: 2 },
      {
        ...f.io,
        get: async () => ({ status: 200, shell: 'hit', html: '<p></p>' }),
        // the runtime catches its own photo errors (see nightlyRebuildRuntime); the walk itself only sees the outcome
        after: async () => undefined,
      },
    );
    expect(tally).toMatchObject({ visited: 3, failures: 0, stoppedEarly: false });
  });

  it('is not called for a page that stopped or was abandoned', async () => {
    const f = fakeIo({});
    let calls = 0;
    await walkStorefront(['/vara/a/'], OPTS, {
      ...f.io,
      stop: () => true,
      after: async () => {
        calls += 1;
      },
    });
    expect(calls).toBe(0);
  });
});

