// Variation logic for the product page's swatches (live: WooCommerce + Variation Swatches with
// out-of-stock options crossed out). Pure functions so the PDP island stays thin and testable.
import { buyable } from './livePrices';
import type { StockStatus } from './types';

export interface VariationLike {
  id: number;
  attributes: { name: string; option: string }[];
  price: string;
  regular_price: string;
  /** Absent on the page: stock is never baked in, it arrives from /api/live/product. Absent means unknown. */
  stock_status?: string;
}

/** "Any value" is a wildcard: Woo stores it as an empty option, and WC REST leaves the attribute out of
 *  the variation altogether. */
function matches(v: VariationLike, selected: Record<string, string>): boolean {
  return Object.entries(selected).every(([name, value]) => {
    if (!value) return true;
    const attr = v.attributes.find((a) => a.name === name);
    return attr === undefined || attr.option === '' || attr.option === value;
  });
}

/** The variation for a complete selection, or null while any attribute is still unchosen. Like WooCommerce
 *  (find_matching_product_variation, and live's variation form), the first match in menu order wins, an
 *  "any" variation included and whatever its stock: `variations` must be in menu order. */
export function resolveVariation<T extends VariationLike>(
  variations: T[],
  attrNames: string[],
  selected: Record<string, string>,
): T | null {
  if (!attrNames.every((n) => selected[n])) return null;
  return variations.find((v) => matches(v, selected)) ?? null;
}

/** One option's state given the OTHER attributes already chosen:
 *  'instock' (buyable), 'outofstock' (exists but sold out — crossed out, still pickable: its waitlist), 'none' (no such combination),
 *  'pending' (stock not known yet: selectable, never shown as sold out).
 *  Once every other attribute in `attrNames` is chosen, the option means one variation (the first match in
 *  menu order, as resolveVariation picks), so its stock decides. While others are still open, the option is
 *  buyable when some matching variation is in stock. */
export function optionState(
  variations: VariationLike[],
  attrName: string,
  option: string,
  selected: Record<string, string>,
  attrNames: string[] = [],
): 'instock' | 'outofstock' | 'none' | 'pending' {
  const wanted = { ...selected, [attrName]: option };
  const candidates = variations.filter((v) => matches(v, wanted));
  if (candidates.length === 0) return 'none';
  const decided = attrNames.length > 0 && attrNames.every((n) => wanted[n]);
  if (decided) {
    const s = candidates[0].stock_status;
    return s === undefined ? 'pending' : buyable(s as StockStatus) ? 'instock' : 'outofstock';
  }
  if (candidates.some((v) => v.stock_status !== undefined && buyable(v.stock_status as StockStatus))) return 'instock';
  return candidates.some((v) => v.stock_status === undefined) ? 'pending' : 'outofstock';
}

/** A variable product with no variation resolved: is nothing of it buyable? True only when the product's own stock is known
 *  and sold out, or every variation's stock is known and sold out (and there is at least one). Unknown stock (pending, or
 *  failed, so undefined or null) never counts: a variation the answer does not name, or a product not in it, stays
 *  pressable and WooCommerce decides on add. Then the product page shows the selection as sold out, with no hint to pick.
 *  `productStock` is the product's live stock (lib/liveStore productStock); `variationStocks` the variations' live stocks. */
export function nothingToBuy(
  productStock: string | null | undefined,
  variationStocks: (string | null | undefined)[],
): boolean {
  const known = (s: string | null | undefined): s is string => s !== undefined && s !== null;
  if (known(productStock) && !buyable(productStock as StockStatus)) return true;
  return variationStocks.length > 0 && variationStocks.every((s) => known(s) && !buyable(s as StockStatus));
}

/** The product a waitlist sign-up is for, when the choice shown is known to be sold out: the chosen variation of a
 *  variable product (each variation has its own waitlist; the parent has none), or a simple product itself. Null for
 *  anything that can be bought (backorders included), for stock not known yet, and while no variation is chosen. */
export function waitlistTarget(
  isVariable: boolean,
  productId: number,
  productStock: string | null | undefined,
  resolved: { id: number; stock_status?: string } | null,
): number | null {
  const soldOut = (s: string | null | undefined) => s !== undefined && s !== null && !buyable(s as StockStatus);
  if (isVariable) return resolved && soldOut(resolved.stock_status) ? resolved.id : null;
  return soldOut(productStock) ? productId : null;
}

/** The waitlist target to show: the current one when the stock is known; while a refetch is pending (the tab came
 *  back), the last known one as long as the same product or variation (`own`) is still chosen, so the form and what
 *  was typed in it stay put. */
export function waitlistDuring(pending: boolean, current: number | null, lastKnown: number | null, own: number | null): number | null {
  if (!pending) return current;
  return lastKnown !== null && lastKnown === own ? lastKnown : null;
}

/** The add-to-cart guidance while a selection is incomplete: "Veldu stærð" when the first unchosen attribute is a
 *  size (Stærð, Stærðir, Skóstærð, Size …), a generic "Veldu valkost" for any other attribute, null once everything
 *  is chosen. With `availability`, also null when no option of that attribute is selectable (every swatch 'none', as
 *  optionState judges them), since the hint would ask for something that can't be picked. A sold-out option counts:
 *  it is picked to join its waitlist. */
export function choiceHint(
  attrNames: string[],
  selected: Record<string, string>,
  availability?: { attrs: { name: string; options: string[] }[]; variations: VariationLike[] },
): string | null {
  const missing = attrNames.find((n) => !selected[n]);
  if (missing === undefined) return null;
  if (availability) {
    const options = availability.attrs.find((a) => a.name === missing)?.options ?? [];
    const selectable = options.some((opt) => optionState(availability.variations, missing, opt, selected, attrNames) !== 'none');
    if (!selectable) return null;
  }
  return isSizeAttribute(missing) ? 'Veldu stærð' : 'Veldu valkost';
}

/** A size attribute: Stærð, Stærðir, Skóstærð, Size … (the product page labels it "Veldu stærð"). */
export function isSizeAttribute(name: string): boolean {
  return /stærð|size/i.test(name.trim());
}

/** A size as a number ("42", "42,5", "42 2/3"), or null when it isn't one ("M", "One size"). */
function sizeNumber(option: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)(?:\s+(\d)\/(\d))?$/.exec(option.trim());
  if (!m) return null;
  return Number(m[1].replace(',', '.')) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

/** A size attribute's options smallest first when every one is a number (shoe sizes come in whatever order they were
 *  added in); any other list (S/M/L, "One size") keeps the shop's own order. */
export function sortSizeOptions(options: string[]): string[] {
  const numbers = options.map(sizeNumber);
  if (numbers.some((n) => n === null)) return options;
  return options.map((o, i) => ({ o, n: numbers[i]! })).sort((a, b) => a.n - b.n).map((x) => x.o);
}

/** Colourway pictures for one attribute: each option's image from its first variation (menu order) that names the
 *  option exactly and has an image. Null unless there are two or more options and every one has its own, distinct
 *  picture — variations without a photo of their own repeat the parent's, which is no colourway. */
export function optionImages(
  attrName: string,
  options: string[],
  variations: (VariationLike & { image?: { src: string } | null })[],
): Record<string, string> | null {
  if (options.length < 2) return null;
  const images: Record<string, string> = {};
  for (const opt of options) {
    const src = variations.find((v) => v.image?.src && v.attributes.some((a) => a.name === attrName && a.option === opt))?.image?.src;
    if (!src) return null;
    images[opt] = src;
  }
  return new Set(Object.values(images)).size === options.length ? images : null;
}

/** Woo only shows a separate variation price when variation prices differ. */
export function pricesVary(variations: VariationLike[]): boolean {
  return new Set(variations.map((v) => `${v.price}|${v.regular_price}`)).size > 1;
}
