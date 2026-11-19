// Shares one in-flight load between callers asking for the same key at the same moment (e.g. two cards on a page
// asking the same ids). Nothing is kept once it settles: stock is never cached. SERVER-ONLY by use.
const inFlight = new Map<string, Promise<unknown>>();

export function coalesce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = load().finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

/** Loads in flight right now (tests and monitoring). */
export function coalesceSize(): number {
  return inFlight.size;
}
