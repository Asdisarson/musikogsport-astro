// One-at-a-time execution for calls that share server state (the Store API cart session has no lock, so
// two cart writes in flight can overwrite each other). Client-safe.

/** Wrap async work so each call starts only after the previous one settled (resolved or failed). */
export function createSerial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}
