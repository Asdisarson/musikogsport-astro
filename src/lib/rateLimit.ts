// Fixed-window, in-process rate limiting per key (a visitor IP from lib/visitor, or a customer id).
// WordPress only ever sees the storefront server's address, so per-visitor limits have to live here.
// SERVER-ONLY.

export interface Limiter {
  /** True while `key` has used fewer than `limit` slots in the current window. Never counts. */
  allowed(key: string): boolean;
  /** Use one slot for `key`; true when it was within the limit. Take it BEFORE a slow check (a WordPress
   *  password check), so a parallel burst can't all pass while the first answers are pending. */
  take(key: string): boolean;
  /** Give back a slot from take() when the check succeeded (a right password isn't a failure). */
  refund(key: string): void;
  /** Keys currently held (for tests and monitoring). */
  size(): number;
}

export function createLimiter(limit: number, windowMs: number, now: () => number = Date.now): Limiter {
  // Insertion order = window start order (a key is re-inserted when its window restarts), so expired
  // entries are always at the front and the sweep below stops at the first live one.
  const hits = new Map<string, { n: number; at: number }>();
  const live = (key: string, t: number) => {
    const h = hits.get(key);
    return h && t - h.at <= windowMs ? h : null;
  };
  const sweep = (t: number) => {
    for (const [k, v] of hits) {
      if (t - v.at <= windowMs) break;
      hits.delete(k);
    }
  };
  return {
    allowed: (key) => (live(key, now())?.n ?? 0) < limit,
    take(key) {
      const t = now();
      const h = live(key, t);
      if (!h) {
        sweep(t);
        hits.delete(key);
        hits.set(key, { n: 1, at: t });
        return limit > 0;
      }
      if (h.n >= limit) return false; // a refused attempt uses no slot
      h.n += 1;
      return true;
    },
    refund(key) {
      const h = live(key, now());
      if (h && h.n > 0) h.n -= 1;
    },
    size: () => hits.size,
  };
}
