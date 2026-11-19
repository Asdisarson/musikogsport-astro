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

/** Whether one option can be picked given the OTHER attributes already chosen:
 *  'instock' (buyable), 'outofstock' (exists but sold out — live crosses it out), 'none' (no such combination),
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

/** The add-to-cart guidance while a selection is incomplete: "Veldu stærð" when the first unchosen attribute is a
 *  size (Stærð, Stærðir, Skóstærð, Size …), a generic "Veldu valkost" for any other attribute, null once everything
 *  is chosen. With `availability`, also null when no option of that attribute is selectable (every swatch sold out
 *  or 'none', as optionState judges them), since the hint would ask for something that can't be picked. */
export function choiceHint(
  attrNames: string[],
  selected: Record<string, string>,
  availability?: { attrs: { name: string; options: string[] }[]; variations: VariationLike[] },
): string | null {
  const missing = attrNames.find((n) => !selected[n]);
  if (missing === undefined) return null;
  if (availability) {
    const options = availability.attrs.find((a) => a.name === missing)?.options ?? [];
    const selectable = options.some((opt) => {
      const st = optionState(availability.variations, missing, opt, selected, attrNames);
      return st === 'instock' || st === 'pending';
    });
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
