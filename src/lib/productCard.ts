// Product-card text helpers for the nike-look wall (SPEC § Wall): the label line above the title, the
// "N litir" line under the price, and the product page's subtitle. Pure — no server imports.
import type { WooAttribute } from './types';
import { splitBrand } from './brand';
import { decodeEntities } from './decode';
import { countWord } from './plural';

/** A product published within this many days reads "Nýtt". */
export const NEW_PRODUCT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CardLabel {
  text: 'Nýtt' | 'Útsala' | 'Uppselt';
  /** accent: --accent #d33918 (on white only); muted: --meta #707072. */
  tone: 'accent' | 'muted';
}

export interface CardLabelInput {
  /** The card shows a "-N%" discount (salePercent() found one). */
  discounted: boolean;
  outOfStock: boolean;
  /** Publish date (WooCommerce `date_created`). The Store API the wall reads doesn't expose it, so the
   *  "Nýtt" label only appears where a caller has a date. */
  createdAt?: string | null;
  now?: Date;
}

function isRecent(createdAt: string | null | undefined, now: Date): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= NEW_PRODUCT_DAYS * DAY_MS;
}

/** The card's label line: "Uppselt" when sold out, else "Nýtt" when recently published, else "Útsala" when
 *  discounted; null for a plain product. */
export function cardLabel({ discounted, outOfStock, createdAt, now = new Date() }: CardLabelInput): CardLabel | null {
  if (outOfStock) return { text: 'Uppselt', tone: 'muted' };
  if (isRecent(createdAt, now)) return { text: 'Nýtt', tone: 'accent' };
  if (discounted) return { text: 'Útsala', tone: 'accent' };
  return null;
}

const COLOUR_ATTRIBUTE = /^(pa_)?(litur|litir|colou?rs?)$/i;

/** A colour attribute: "Litur" (local in this store), Litir, Colour, or their pa_ taxonomy names. */
export function isColourAttribute(name: string): boolean {
  return COLOUR_ATTRIBUTE.test(name.trim());
}

/** Number of colours a product comes in: the options of its colour variation attribute ("Litur", a local
 *  attribute in this store), or 0 when there is no choice of colour (none, one, or not a variation). */
export function colourCount(attributes: WooAttribute[] | undefined): number {
  const colour = (attributes ?? []).find((a) => a.variation && isColourAttribute(a.name));
  const n = colour ? new Set(colour.options).size : 0;
  return n >= 2 ? n : 0;
}

/** The product page's subtitle (SPEC § PDP, "Men's Shoes"): the first card category, then the brand — the product's
 *  brand term, else a known brand at the start of its name (splitBrand) — joined by " · ". A brand that is also the
 *  category's name isn't repeated. `category` is expected decoded. */
export function productSubtitle({ category, brands, name }: { category?: string; brands?: { name: string }[]; name: string }): string {
  const brand = (brands?.[0]?.name ? decodeEntities(brands[0].name).trim() : '') || splitBrand(name).brand || '';
  const parts = [category?.trim() ?? '', brand].filter(Boolean);
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) parts.pop();
  return parts.join(' · ');
}

/** The category at the start of a product subtitle as a link, with what follows it (" · Nike") as text; null when the
 *  subtitle doesn't start with that category or the category has no page. */
export function subtitleLink(subtitle: string, category?: { name: string; path: string }): { name: string; href: string; rest: string } | null {
  const name = category?.name.trim() ?? '';
  if (!name || !category?.path || !subtitle.startsWith(name)) return null;
  return { name, href: category.path, rest: subtitle.slice(name.length) };
}

/** "2 litir", "21 litur": Icelandic takes the singular after numbers ending in 1, except 11. */
export function colourLabel(n: number): string {
  return countWord(n, 'litur', 'litir');
}
