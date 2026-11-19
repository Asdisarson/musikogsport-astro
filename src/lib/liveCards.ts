// The pure part of filling product cards from /api/live: which ids still need a call, how a live answer is read,
// and what a card shows. The DOM side (ProductCard.astro's script) only applies what this returns.
// Client- and server-safe.
import { cardAction, priceChanged, type LiveProduct, type LiveStock } from './livePrices';
import { cardLabel } from './productCard';
import type { StockStatus } from './types';

export interface CardFill {
  /** The label line: "Uppselt" (sold out), "Útsala" (on sale), or '' (neither: cards carry no "Á lager" label). Null
   *  leaves the baked label alone (stock unknown). */
  label: string | null;
  /** Sold out: the tile's "Uppselt" badge shows. */
  outOfStock: boolean;
  /** Sale percent for the "-N%" badge; null for no sale, and always null when sold out (the badge is hidden). */
  percent: number | null;
  /** The price markup to show: the live one when it differs from the baked one, else the baked one. */
  priceHtml: string;
  /** The action the card should show: a cart button, or the neutral link (with its text). */
  action: { kind: 'cart' | 'link'; text: string };
}

/** Ids that still need a live answer, in order, without repeats or ids already filled. */
export function pendingIds(ids: number[], filled: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (const id of ids) if (!filled.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/** A failed refresh is asked again after this delay, once; the next pageshow or tab return asks again regardless. */
export const LIVE_RETRY_MS = 3000;

/** Whether a failed refresh gets another automatic try (`retries` automatic tries have already been made). */
export function shouldRetry(retries: number): boolean {
  return retries < 1;
}

/** Whether a call numbered `seq` may apply its answer to a card last filled by call `applied` (undefined: none yet).
 *  Calls are numbered as they start, so a response from an older call never overwrites a newer one. */
export function takesAnswer(applied: number | undefined, seq: number): boolean {
  return applied === undefined || seq >= applied;
}

const STOCKS: StockStatus[] = ['instock', 'outofstock', 'onbackorder'];

function stockOf(v: unknown): LiveStock {
  return STOCKS.includes(v as StockStatus) ? (v as StockStatus) : null;
}

/** The answer of GET /api/live/, by product id. Malformed rows are skipped; anything else gives an empty map. */
export function parseLiveAnswer(body: unknown): Map<number, LiveProduct> {
  const out = new Map<number, LiveProduct>();
  if (typeof body !== 'object' || body === null) return out;
  const list = (body as { products?: unknown }).products;
  if (!Array.isArray(list)) return out;
  for (const row of list) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'number' || typeof r.type !== 'string' || typeof r.priceHtml !== 'string') continue;
    out.set(r.id, {
      id: r.id,
      type: r.type,
      priceHtml: r.priceHtml,
      percent: typeof r.percent === 'number' ? r.percent : null,
      stock: stockOf(r.stock),
    });
  }
  return out;
}

/** What a card shows once its live answer is in; null while the product is missing from the answer (the card keeps
 *  its neutral state). Sold out wins over sale (the same rule as cardLabel); the label is never "Á lager" on a card. */
export function cardFill(type: string, bakedPriceHtml: string, live: LiveProduct | undefined): CardFill | null {
  if (!live) return null;
  const outOfStock = live.stock === 'outofstock';
  const label = live.stock === null ? null : (cardLabel({ discounted: live.percent !== null, outOfStock })?.text ?? '');
  return {
    label,
    outOfStock,
    percent: outOfStock ? null : live.percent,
    priceHtml: priceChanged(bakedPriceHtml, live.priceHtml) ? live.priceHtml : bakedPriceHtml,
    action: cardAction(type, live.stock),
  };
}
