import { describe, expect, it, vi } from 'vitest';
import { createCachedLoader, createKeyedLoader, createTtlMap } from './cache';

describe('createCachedLoader', () => {
  const setup = (results: (() => Promise<string>)[]) => {
    let now = 0;
    let calls = 0;
    const load = createCachedLoader<string>({
      load: () => results[Math.min(calls++, results.length - 1)](),
      ttlMs: 1000,
      failMemoMs: 100,
      now: () => now,
    });
    return { load, calls: () => calls, tick: (ms: number) => (now += ms) };
  };

  it('loads once and serves the cached value within the TTL', async () => {
    const s = setup([async () => 'a']);
    expect(await s.load()).toEqual({ value: 'a', degraded: false });
    expect(await s.load()).toEqual({ value: 'a', degraded: false });
    expect(s.calls()).toBe(1);
  });

  // A value that comes back after a failed load may differ from what was served meanwhile: the caller is told once.
  it('tells the caller when a load succeeds again after a failure, and not on a first or an ordinary load', async () => {
    let now = 0;
    const onRecovered = vi.fn();
    let fail = true;
    const load = createCachedLoader<string>({
      load: async () => {
        if (fail) throw new Error('down');
        return 'b';
      },
      ttlMs: 1000,
      failMemoMs: 100,
      now: () => now,
      onRecovered,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await load()).degraded).toBe(true); // first load fails
    expect(onRecovered).not.toHaveBeenCalled();
    fail = false;
    now += 200; // past the failure memo
    expect(await load.refresh()).toBe(true);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    await load.refresh(); // an ordinary successful load
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent cold callers', async () => {
    const s = setup([async () => 'a']);
    const [x, y] = await Promise.all([s.load(), s.load()]);
    expect(x.value).toBe('a');
    expect(y.value).toBe('a');
    expect(s.calls()).toBe(1);
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('refresh() loads now even when the value is fresh, and the next read gets the new value', async () => {
    const s = setup([async () => 'a', async () => 'b']);
    await s.load();
    expect(await s.load.refresh()).toBe(true);
    expect(await s.load()).toEqual({ value: 'b', degraded: false });
    expect(s.calls()).toBe(2);
  });

  it('refresh() started during a running load loads again after it (that load may have read before the change)', async () => {
    const s = setup([async () => 'a', async () => 'b']);
    const [x, ok] = await Promise.all([s.load(), s.load.refresh()]);
    expect([x.value, ok]).toEqual(['a', true]);
    expect((await s.load()).value).toBe('b');
    expect(s.calls()).toBe(2);
  });

  it('refresh() says so and keeps the last good value when the load fails', async () => {
    const s = setup([async () => 'a', async () => { throw new Error('down'); }]);
    await s.load();
    expect(await s.load.refresh()).toBe(false);
    expect(await s.load()).toEqual({ value: 'a', degraded: false });
  });

  it('serves the last good value at once when it is stale, refreshing in the background', async () => {
    const s = setup([async () => 'a', async () => 'b']);
    await s.load();
    s.tick(1001);
    expect(await s.load()).toEqual({ value: 'a', degraded: false }); // no wait on WordPress
    await flush();
    expect(await s.load()).toEqual({ value: 'b', degraded: false });
    expect(s.calls()).toBe(2);
  });

  it('keeps the stale value through a failed refresh and waits before trying again', async () => {
    const s = setup([async () => 'a', async () => Promise.reject(new Error('down')), async () => 'c']);
    await s.load();
    s.tick(1001);
    await s.load();
    await flush();
    expect(await s.load()).toEqual({ value: 'a', degraded: false });
    expect(s.calls()).toBe(2); // inside the failure memo: no new attempt
    s.tick(101);
    expect((await s.load()).value).toBe('a');
    await flush();
    expect((await s.load()).value).toBe('c');
  });

  it('reports degraded on a cold failure, and remembers it briefly instead of retrying every request', async () => {
    const s = setup([async () => Promise.reject(new Error('down')), async () => 'b']);
    expect(await s.load()).toEqual({ value: null, degraded: true });
    expect(await s.load()).toEqual({ value: null, degraded: true });
    expect(s.calls()).toBe(1);
    s.tick(101);
    expect(await s.load()).toEqual({ value: 'b', degraded: false });
    expect(s.calls()).toBe(2);
  });
});

describe('createTtlMap', () => {
  it('returns entries until their own TTL passes', () => {
    let now = 0;
    const m = createTtlMap<string, number>(10, () => now);
    m.set('a', 1, 100);
    m.set('b', 2, 10);
    now = 50;
    expect(m.get('a')).toEqual({ value: 1, fresh: true });
    expect(m.get('b')).toEqual({ value: 2, fresh: false });
    expect(m.get('c')).toBeUndefined();
  });

  it('never holds more than its maximum, dropping the oldest entry first', () => {
    const m = createTtlMap<string, number>(2, () => 0);
    m.set('a', 1, 100);
    m.set('b', 2, 100);
    m.set('c', 3, 100);
    expect(m.size()).toBe(2);
    expect(m.get('a')).toBeUndefined();
    expect(m.get('c')?.value).toBe(3);
  });

  it('refreshes an existing key without evicting others', () => {
    const m = createTtlMap<string, number>(2, () => 0);
    m.set('a', 1, 100);
    m.set('b', 2, 100);
    m.set('a', 9, 100);
    expect(m.size()).toBe(2);
    expect(m.get('a')?.value).toBe(9);
    expect(m.get('b')?.value).toBe(2);
  });

  it('counts a read as a use: a key read since its insert outlives one that was not (LRU, F-3)', () => {
    const m = createTtlMap<string, number>(2, () => 0);
    m.set('a', 1, 100);
    m.set('b', 2, 100);
    expect(m.get('a')?.value).toBe(1);
    m.set('c', 3, 100);
    expect(m.get('a')?.value).toBe(1);
    expect(m.get('b')).toBeUndefined();
    expect(m.get('c')?.value).toBe(3);
  });
});

describe('createKeyedLoader', () => {
  // holds: a presence check that loads nothing and does not count as a use (the shell poke forgets a cached product on it)
  it('holds reports a key only once a value is held for it, and loads nothing', async () => {
    const load = vi.fn(async (key: string) => `v:${key}`);
    const get = createKeyedLoader<string>({ load, ttlMs: 1000, maxStaleMs: 1000, failMemoMs: 100, maxEntries: 10 });
    expect(get.holds('a')).toBe(false);
    expect(load).not.toHaveBeenCalled();
    await get('a');
    expect(get.holds('a')).toBe(true);
    expect(get.holds('b')).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  const setup = (impl: (key: string, call: number) => Promise<string>, maxEntries = 10) => {
    let now = 0;
    const calls: string[] = [];
    const get = createKeyedLoader<string>({
      load: (key) => {
        calls.push(key);
        return impl(key, calls.length);
      },
      ttlMs: 1000,
      maxStaleMs: 5000,
      failMemoMs: 100,
      maxEntries,
      now: () => now,
    });
    return { get, calls, tick: (ms: number) => (now += ms) };
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('loads a key once and serves it within the TTL', async () => {
    const s = setup(async (k) => `${k}!`);
    expect(await s.get('a')).toBe('a!');
    expect(await s.get('a')).toBe('a!');
    expect(s.calls).toEqual(['a']);
  });

  it('keeps keys apart', async () => {
    const s = setup(async (k) => `${k}!`);
    expect(await s.get('a')).toBe('a!');
    expect(await s.get('b')).toBe('b!');
    expect(s.calls).toEqual(['a', 'b']);
  });

  it('shares one load between concurrent cold callers of a key', async () => {
    const s = setup(async (k) => `${k}!`);
    expect(await Promise.all([s.get('a'), s.get('a')])).toEqual(['a!', 'a!']);
    expect(s.calls).toEqual(['a']);
  });

  it('serves a stale value at once and refreshes it once in the background', async () => {
    const s = setup(async (k, n) => `${k}${n}`);
    expect(await s.get('a')).toBe('a1');
    s.tick(1000);
    expect(await Promise.all([s.get('a'), s.get('a')])).toEqual(['a1', 'a1']);
    await settle();
    expect(s.calls).toEqual(['a', 'a']);
    expect(await s.get('a')).toBe('a2');
  });

  it('throws a cold failure to the caller and remembers it for failMemoMs', async () => {
    const boom = new Error('down');
    const s = setup(async (_k, n) => {
      if (n === 1) throw boom;
      return 'ok';
    });
    await expect(s.get('a')).rejects.toBe(boom);
    await expect(s.get('a')).rejects.toBe(boom);
    expect(s.calls).toEqual(['a']);
    s.tick(100);
    expect(await s.get('a')).toBe('ok');
  });

  it('keeps serving the stale value when a refresh fails, without retrying inside failMemoMs', async () => {
    const s = setup(async (_k, n) => {
      if (n === 1) return 'good';
      throw new Error('down');
    });
    expect(await s.get('a')).toBe('good');
    s.tick(1000);
    expect(await s.get('a')).toBe('good');
    await settle();
    expect(await s.get('a')).toBe('good');
    await settle();
    expect(s.calls).toEqual(['a', 'a']);
    s.tick(100);
    expect(await s.get('a')).toBe('good');
    await settle();
    expect(s.calls).toEqual(['a', 'a', 'a']);
  });

  it('does not show a value older than maxStaleMs past its TTL: the caller waits for a load', async () => {
    const s = setup(async (k, n) => `${k}${n}`);
    expect(await s.get('a')).toBe('a1');
    s.tick(6000);
    expect(await s.get('a')).toBe('a2');
    expect(s.calls).toEqual(['a', 'a']);
  });

  it('falls back to a too-old value when that load fails', async () => {
    const s = setup(async (_k, n) => {
      if (n === 1) return 'good';
      throw new Error('down');
    });
    expect(await s.get('a')).toBe('good');
    s.tick(6000);
    expect(await s.get('a')).toBe('good');
    expect(await s.get('a')).toBe('good'); // inside the failure memo: no second attempt
    expect(s.calls).toEqual(['a', 'a']);
  });

  it('drops the least recently used key past maxEntries', async () => {
    const s = setup(async (k) => k, 2);
    await s.get('a');
    await s.get('b');
    await s.get('c');
    await s.get('a');
    expect(s.calls).toEqual(['a', 'b', 'c', 'a']);
  });
});
