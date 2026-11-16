import { describe, expect, it } from 'vitest';
import { createCachedLoader, createTtlMap } from './cache';

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
