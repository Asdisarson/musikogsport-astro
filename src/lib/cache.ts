// In-process caches for WordPress data — pure, no I/O of their own.

export interface Loaded<T> {
  /** The fresh or last good value; null only when nothing has ever loaded. */
  value: T | null;
  /** True when there is no value because WordPress couldn't be reached (answer 503, not 404). */
  degraded: boolean;
}

export type CachedLoader<T> = (() => Promise<Loaded<T>>) & { refresh: () => Promise<boolean> };

/** One cached value with a TTL (stale-while-revalidate). A stale value is served at once while a single
 *  background refresh runs; concurrent cold callers share one load. A failed load, cold or warm, is
 *  remembered for `failMemoMs`, so an outage isn't retried (and waited on) by every request. With nothing
 *  ever loaded the result is `degraded`.
 *  `.refresh()` loads now whatever the value's age (the caller knows the source changed) and resolves to whether
 *  that load succeeded; a failed one keeps the last good value like any other. A load already running is waited
 *  out first, since it may have read before the change. */
export function createCachedLoader<T>(opts: {
  load: () => Promise<T>;
  ttlMs: number;
  failMemoMs: number;
  now?: () => number;
}): CachedLoader<T> {
  const now = opts.now ?? Date.now;
  let cached: { at: number; value: T } | null = null;
  let failedAt: number | null = null;
  let inflight: Promise<Loaded<T>> | null = null;

  const refresh = (): Promise<Loaded<T>> =>
    (inflight ??= opts
      .load()
      .then((value): Loaded<T> => {
        cached = { at: now(), value };
        failedAt = null;
        return { value, degraded: false };
      })
      .catch((err): Loaded<T> => {
        console.warn('[cache] load failed:', err instanceof Error ? err.message : err);
        failedAt = now();
        return cached ? { value: cached.value, degraded: false } : { value: null, degraded: true };
      })
      .finally(() => {
        inflight = null;
      }));

  const read = (): Promise<Loaded<T>> => {
    const t = now();
    const backingOff = failedAt !== null && t - failedAt < opts.failMemoMs;
    if (cached) {
      if (t - cached.at >= opts.ttlMs && !backingOff) void refresh();
      return Promise.resolve({ value: cached.value, degraded: false });
    }
    if (backingOff) return Promise.resolve({ value: null, degraded: true });
    return refresh();
  };
  return Object.assign(read, {
    refresh: async () => {
      await inflight;
      await refresh();
      return failedAt === null;
    },
  });
}

/** A size-bounded map whose entries each carry their own TTL. `get` also returns expired entries
 *  (fresh: false) so a caller can serve stale data when a refresh fails. Eviction is least recently used: a read
 *  counts as a use, so a hot key isn't dropped just because it was inserted early. */
export function createTtlMap<K, V>(maxEntries: number, now: () => number = Date.now) {
  const entries = new Map<K, { value: V; expires: number }>();
  return {
    get(key: K): { value: V; fresh: boolean } | undefined {
      const e = entries.get(key);
      if (!e) return undefined;
      entries.delete(key); // move to the end: Map order is the eviction order
      entries.set(key, e);
      return { value: e.value, fresh: now() < e.expires };
    },
    set(key: K, value: V, ttlMs: number): void {
      entries.delete(key); // re-insert at the end: Map order is the eviction order
      entries.set(key, { value, expires: now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as K);
    },
    size: () => entries.size,
  };
}

/** `createCachedLoader` per key (stale-while-revalidate), bounded by `maxEntries` (least recently used goes first).
 *  A fresh value is returned as is; a stale one is returned at once while a single background refresh runs;
 *  concurrent cold callers of a key share one load. A value more than `maxStaleMs` past its TTL is too old to show
 *  (a rarely asked key could otherwise answer with a price from hours ago): the caller waits for a load, and gets
 *  the old value only if that load fails. A failed load is remembered for `failMemoMs` per key: with a value in hand
 *  that value keeps being served, otherwise the error is thrown to every caller until the memo expires, so an
 *  outage isn't retried (and waited on) by every request. Values are shared between callers: treat them as
 *  read-only. */
export function createKeyedLoader<V>(opts: {
  load: (key: string) => Promise<V>;
  ttlMs: number;
  maxStaleMs: number;
  failMemoMs: number;
  maxEntries: number;
  now?: () => number;
}): (key: string) => Promise<V> {
  const now = opts.now ?? (() => Date.now()); // read at call time: tests swap the global Date
  // The map's own expiry marks "too old to show"; `at` says when to refresh.
  const values = createTtlMap<string, { value: V; at: number }>(opts.maxEntries, now);
  const failures = createTtlMap<string, unknown>(opts.maxEntries, now);
  const inflight = new Map<string, Promise<V>>();

  const refresh = (key: string): Promise<V> => {
    const pending = inflight.get(key);
    if (pending) return pending;
    const load = opts
      .load(key)
      .then((value) => {
        values.set(key, { value, at: now() }, opts.ttlMs + opts.maxStaleMs);
        return value;
      })
      .catch((err: unknown) => {
        failures.set(key, err, opts.failMemoMs);
        throw err;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, load);
    return load;
  };

  return (key) => {
    const hit = values.get(key);
    const failing = failures.get(key)?.fresh ? failures.get(key) : undefined;
    if (!hit) return failing ? Promise.reject(failing.value) : refresh(key);
    const { value, at } = hit.value;
    if (failing) return Promise.resolve(value); // WordPress is failing: the last good value, however old
    if (!hit.fresh) return refresh(key).catch(() => value);
    if (now() - at >= opts.ttlMs) refresh(key).catch(() => undefined); // the failure is memoised above
    return Promise.resolve(value);
  };
}
