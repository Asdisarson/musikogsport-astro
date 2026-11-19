// The product page's live answer (/api/live/product/<id>/): stock, and corrected prices, fetched once per page view.
// Stock is never in the HTML and never cached, so until this answers the page shows neutral placeholders
// (state 'pending'); a failed call shows 'failed' and never guesses "Á lager" or "Uppselt". CLIENT-safe.
import { atom } from 'nanostores';
import type { LiveProduct, LiveStock, LiveVariation } from './livePrices';
import { onPageRestored, onTabVisible } from './pageLifecycle';
import { log } from './logger';

export interface LiveAnswer {
  product: LiveProduct;
  variations: LiveVariation[];
}

export interface LiveSnapshot {
  state: 'pending' | 'ready' | 'failed';
  productId: number | null;
  product?: LiveProduct;
  variations?: Record<number, LiveVariation>;
}

/** Client timeout for the live call: a hung request ends in 'failed' (with its retry button), never in an endless wait. */
export const LIVE_TIMEOUT_MS = 8000;

export const liveStore = atom<LiveSnapshot>({ state: 'pending', productId: null });

/** The snapshot for a finished call. Pure, so the mapping is tested without a browser. */
export function snapshotFor(productId: number, answer: LiveAnswer | null): LiveSnapshot {
  if (!answer || !answer.product || !Array.isArray(answer.variations)) return { state: 'failed', productId };
  const variations: Record<number, LiveVariation> = {};
  for (const v of answer.variations) variations[v.id] = v;
  return { state: 'ready', productId, product: answer.product, variations };
}

/** A variation with the live price and stock laid over its baked data. Without a live entry (pending, failed, or a
 *  variation the answer does not name) the baked price stays and stock stays unknown (undefined), so nothing is guessed. */
export function withLive<T extends { id: number; price: string; regular_price: string; sale_price: string; on_sale: boolean; stock_status?: string; max?: number | null; soldOne?: boolean }>(
  v: T,
  live: Record<number, LiveVariation> | undefined,
): T {
  const l = live?.[v.id];
  if (!l) return { ...v, stock_status: undefined, max: undefined, soldOne: undefined };
  return { ...v, price: l.price, regular_price: l.regular_price, sale_price: l.sale_price, on_sale: l.on_sale, stock_status: l.stock ?? undefined, max: l.max, soldOne: l.soldOne };
}

/** The stock of the product itself, once known (null while pending or failed). */
export function productStock(s: LiveSnapshot): LiveStock | undefined {
  return s.state === 'ready' ? s.product?.stock ?? null : undefined;
}

/** The most the product itself may be bought at once: a number or null (no cap), undefined while unknown (no cap shown). */
export function productMax(s: LiveSnapshot): number | null | undefined {
  return s.state === 'ready' ? s.product?.max ?? null : undefined;
}

/** Whether the product itself is sold individually, once known (undefined while pending or failed). */
export function productSoldOne(s: LiveSnapshot): boolean | undefined {
  return s.state === 'ready' ? s.product?.soldOne === true : undefined;
}

let inFlight: AbortController | null = null;
let wiredFor: number | null = null;

/** Fetch the live answer for this product. One call per page view: a second subscriber, or a repeat from a restored
 *  page, reuses what is there unless `force` is set (retry, or a refetch after the tab came back). */
export async function loadLive(productId: number, force = false): Promise<void> {
  const cur = liveStore.get();
  if (!force && cur.productId === productId && cur.state !== 'failed') return;
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;
  if (cur.productId !== productId || cur.state === 'failed' || force) liveStore.set({ state: 'pending', productId });
  const timeout = AbortSignal.timeout(LIVE_TIMEOUT_MS);
  const signal = AbortSignal.any ? AbortSignal.any([ctrl.signal, timeout]) : ctrl.signal;
  try {
    const res = await fetch(`/api/live/product/${productId}/`, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`live ${res.status}`);
    const answer = (await res.json()) as LiveAnswer;
    if (inFlight === ctrl) liveStore.set(snapshotFor(productId, answer));
  } catch (err) {
    if (ctrl.signal.aborted && inFlight !== ctrl) return; // superseded by a newer call
    log.warn('live product call failed', { productId, message: err instanceof Error ? err.message : String(err) });
    if (inFlight === ctrl) liveStore.set(snapshotFor(productId, null));
  } finally {
    if (inFlight === ctrl) inFlight = null;
  }
}

/** Retry after a failure (the 'Reyna aftur' button). */
export function retryLive(): void {
  const id = liveStore.get().productId;
  if (id !== null) void loadLive(id, true);
}

/** Start the page's load and re-check it when the page comes back (bfcache restore) or the tab is shown again. Safe to
 *  call from several components: it is wired once per product. Returns a cleanup for tests. */
export function startLive(productId: number): () => void {
  void loadLive(productId);
  if (wiredFor === productId) return () => {};
  wiredFor = productId;
  const refresh = () => {
    if (liveStore.get().state !== 'pending') void loadLive(productId, true);
  };
  const offRestore = onPageRestored(refresh);
  const offVisible = onTabVisible(refresh);
  return () => {
    offRestore();
    offVisible();
    wiredFor = null;
  };
}
