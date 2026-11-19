// Live price and stock answer (/api/live): the pure rules shared by the endpoints, the cards and the product page.
// Stock is never baked into HTML and never cached (see api/live, which sends no-store). SERVER- and CLIENT-safe.
import { sanitizeHtml } from './sanitize';
import { salePercent } from './price';
import type { StockStatus, WooProduct, WooVariation } from './types';
import { isPosInt } from './validate';

/** Most ids one /api/live/ call takes: a listing page shows 27 cards, so this leaves room for a few pages. */
export const LIVE_MAX_IDS = 60;

export type LiveStock = StockStatus | null;

export interface LiveProduct {
  id: number;
  type: string;
  /** Sanitised WooCommerce price_html, the same markup PriceTag renders. */
  priceHtml: string;
  /** Sale percent from the del/ins amounts, or null. */
  percent: number | null;
  /** WooCommerce stock status, or null when the product is not in the answer. */
  stock: LiveStock;
}

export interface LiveVariation {
  id: number;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  stock: LiveStock;
}

/** The ids of a `?ids=1,2,3` query, or null when any token is not a positive integer or the list is empty or too long. */
export function parseLiveIds(raw: string | null, cap = LIVE_MAX_IDS): number[] | null {
  if (!raw) return null;
  const tokens = raw.split(',');
  const ids: number[] = [];
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    if (!isPosInt(n)) return null;
    if (!ids.includes(n)) ids.push(n);
  }
  if (ids.length === 0 || ids.length > cap) return null;
  return ids;
}

/** Ids split into groups of at most `size`, in order. */
export function chunkIds(ids: number[], size = LIVE_MAX_IDS): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Buyable: in stock, or on backorder (WooCommerce lets a customer buy a backorder product). The one rule for cards and the PDP. */
export function buyable(stock: LiveStock): boolean {
  return stock === 'instock' || stock === 'onbackorder';
}

/** The stock label, or null while unknown (the slot stays empty rather than guessing). */
export function stockLabel(stock: LiveStock): string | null {
  if (stock === null) return null;
  return buyable(stock) ? 'Á lager' : 'Uppselt';
}

/** The card's action: variable products open their choices; a buyable simple product adds to cart; everything else,
 *  and anything whose stock is still unknown, is the neutral link to the product. */
export function cardAction(type: string, stock: LiveStock): { kind: 'cart' | 'link'; text: string } {
  if (type === 'variable') return { kind: 'link', text: 'Veldu kosti' };
  if (type === 'simple' && buyable(stock)) return { kind: 'cart', text: 'Setja í körfu' };
  return { kind: 'link', text: 'Frekari upplýsingar' };
}

/** Whether the live price markup differs from the baked one (whitespace ignored). */
export function priceChanged(baked: string, live: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return norm(baked) !== norm(live);
}

/** What the product page changes after the live answer: the new price markup (null: the shown one is right) and the
 *  "-N%" badge (null: no sale). Null while the answer is missing, so nothing is guessed. */
export function pdpPriceFill(shownHtml: string, live: LiveProduct | undefined): { priceHtml: string | null; percent: number | null } | null {
  if (!live) return null;
  return { priceHtml: priceChanged(shownHtml, live.priceHtml) ? live.priceHtml : null, percent: live.percent };
}

const STOCKS: StockStatus[] = ['instock', 'outofstock', 'onbackorder'];
function stockOf(v: { stock_status?: string }): LiveStock {
  return STOCKS.includes(v.stock_status as StockStatus) ? (v.stock_status as StockStatus) : null;
}

/** One product as the live answer carries it. */
export function liveProductOf(p: WooProduct): LiveProduct {
  return {
    id: p.id,
    type: p.type,
    priceHtml: sanitizeHtml(p.price_html),
    percent: salePercent(p.price_html),
    stock: stockOf(p),
  };
}

/** One variation's price and stock, straight from WooCommerce. */
export function liveVariationOf(v: WooVariation): LiveVariation {
  return {
    id: v.id,
    price: v.price,
    regular_price: v.regular_price,
    sale_price: v.sale_price,
    on_sale: Boolean(v.on_sale),
    stock: stockOf(v),
  };
}
