// Live price and stock answer (/api/live): the pure rules shared by the endpoints, the cards and the product page.
// Stock is never baked into HTML and never cached (see api/live, which sends no-store). SERVER- and CLIENT-safe.
import { sanitizeHtml } from './sanitize';
import { salePercent } from './price';
import type { StockStatus, WooProduct, WooVariation } from './types';
import { isPosInt } from './validate';

/** Most ids one /api/live/ call takes: a listing page shows 24 cards, so this leaves room for a few pages. */
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
  /** Most the customer may buy at once (purchasableMax): a number, or null for no cap. */
  max: number | null;
  /** What the stock alone allows (stockCap), or null for no cap. The cart's lines of the same stock are taken off it. */
  stockMax: number | null;
  /** Sold individually: one per cart, whatever the stock (soldIndividually). Not a stock shortage. */
  soldOne: boolean;
}

export interface LiveVariation {
  id: number;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  stock: LiveStock;
  /** Most the customer may buy at once (purchasableMax), or null for no cap. */
  max: number | null;
  /** What the stock alone allows (stockCap; the parent's when this variation shares it), or null for no cap. */
  stockMax: number | null;
  /** Managed by the parent: its stock is the parent's, shared with every variation managed that way (sharedStock). */
  sharedStock: boolean;
  /** Sold individually: one per cart, whatever the stock (soldIndividually). */
  soldOne: boolean;
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

/** The WooCommerce stock fields the purchasable maximum reads (REST: manage_stock, stock_quantity, backorders,
 *  backorders_allowed, sold_individually). A variation may say manage_stock 'parent': then its parent's decide. */
export interface StockRules {
  manage_stock?: boolean | 'parent';
  stock_quantity?: number | null;
  backorders?: string;
  backorders_allowed?: boolean;
  sold_individually?: boolean;
}

/** What the stock alone allows one customer to take, or null when there is no cap (not managed, backorders allowed, or a
 *  field missing: nothing is guessed). Managed with a quantity and no backorders: the quantity, floored, never below 0.
 *  `parent` is the variable product: its stock is read when the variation says 'parent'. Sold individually is not in it. */
export function stockCap(v: StockRules, parent?: StockRules): number | null {
  const src = v.manage_stock === 'parent' ? parent : v;
  if (src && src.manage_stock === true && typeof src.stock_quantity === 'number' && Number.isFinite(src.stock_quantity)) {
    const allowed = src.backorders_allowed === true || src.backorders === 'yes' || src.backorders === 'notify';
    if (!allowed) return Math.max(0, Math.floor(src.stock_quantity));
  }
  return null;
}

/** The most one customer may put in the cart, or null when there is no cap: the stock cap, and sold individually caps it at 1. */
export function purchasableMax(v: StockRules, parent?: StockRules): number | null {
  const max = stockCap(v, parent);
  if (soldIndividually(v, parent)) return max === null ? 1 : Math.min(max, 1);
  return max;
}

/** Sold individually (one per cart). A variation does not carry the flag itself: the variable product's counts for every variation. */
export function soldIndividually(v: StockRules, parent?: StockRules): boolean {
  const src = v.manage_stock === 'parent' ? parent : v;
  return v.sold_individually === true || src?.sold_individually === true || parent?.sold_individually === true;
}

/** The counter's value held under the cap: no cap leaves it as it is; a cap of 0 still shows 1 (the button is off). */
export function clampQty(qty: number, max: number | null): number {
  return max === null ? qty : Math.min(qty, Math.max(1, max));
}

/** One product as the live answer carries it. */
export function liveProductOf(p: WooProduct): LiveProduct {
  return {
    id: p.id,
    type: p.type,
    priceHtml: sanitizeHtml(p.price_html),
    percent: salePercent(p.price_html),
    stock: stockOf(p),
    max: purchasableMax(p),
    stockMax: stockCap(p),
    soldOne: soldIndividually(p),
  };
}

/** One variation's price, stock and cap, straight from WooCommerce. `parent` is the variable product (for 'parent'). */
export function liveVariationOf(v: WooVariation, parent?: WooProduct): LiveVariation {
  return {
    id: v.id,
    price: v.price,
    regular_price: v.regular_price,
    sale_price: v.sale_price,
    on_sale: Boolean(v.on_sale),
    stock: stockOf(v),
    max: purchasableMax(v, parent),
    stockMax: stockCap(v, parent),
    sharedStock: v.manage_stock === 'parent',
    soldOne: soldIndividually(v, parent),
  };
}
