// Page-lifecycle hooks for the cart and checkout islands (CO-04, CO-05). Client-safe; the targets are injectable so
// node tests can drive them with plain EventTargets.

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Run `cb` when the browser restores this page from its back/forward cache (pageshow with persisted): the page
 *  comes back exactly as it was left (a disabled button, an old cart), with no reload and no React remount. */
export function onPageRestored(cb: () => void, target: Target = window): () => void {
  const handler = (e: Event) => {
    if ((e as Event & { persisted?: boolean }).persisted) cb();
  };
  target.addEventListener('pageshow', handler);
  return () => target.removeEventListener('pageshow', handler);
}

/** Run `cb` when the tab becomes visible again. */
export function onTabVisible(cb: () => void, doc: Target & { visibilityState: string } = document): () => void {
  const handler = () => {
    if (doc.visibilityState === 'visible') cb();
  };
  doc.addEventListener('visibilitychange', handler);
  return () => doc.removeEventListener('visibilitychange', handler);
}
