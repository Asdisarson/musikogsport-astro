// Facet rules for the archive's filter rail — pure, no server imports (archive.ts wires them to the Store API).
import { CARD_SALE_ROOT_SLUG, childrenOf } from './categoryTree';
import type { CategoryTerm, FilterKey, TermRef } from './liveFilters';
import { countWord as pluralWord } from './plural';

/** Whether a filter option is listed. With counts in hand (even an empty result: nothing matches) an option without
 *  products is hidden, since picking it would be a dead end; an active option always stays so it can be removed.
 *  `source` is null only when the count request failed: then every option shows, without counts. */
export function keepOption(o: { active: boolean; count?: number }, source: ReadonlyMap<unknown, number> | null): boolean {
  return o.active || source === null || (o.count ?? 0) > 0;
}

/** The number of products a query matches, from its collection-data stock-status counts: every status, or only the
 *  statuses the query is itself limited to (Á lager). Undefined without counts. */
export function matchCountFromStock(stock: ReadonlyMap<string, number> | null | undefined, onlyStatuses?: string[]): number | undefined {
  if (!stock) return undefined;
  let n = 0;
  for (const [status, count] of stock) if (!onlyStatuses || onlyStatuses.includes(status)) n += count;
  return n;
}

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase('is').replace(/\s+/g, ' ').trim();

/** Slug of the clubs root ("Félag/lið"): a category grouping club merchandise, not a product type. The catalog
 *  tidy-up (mos-catalog-clean) merges it into Liðafatnaður; kept for a site that hasn't run it. */
const CLUBS_ROOT_SLUG = 'felag-lid';
/** Slug of the sports root ("Íþrótt"): its children are sports, exempt from the club rule because the Félag/Lið
 *  attribute carries stray sport terms ("Fótbolti", "Körfubolti"). The tidy-up folds this tree into the sport
 *  filter; kept for a site that hasn't run it. */
const SPORTS_ROOT_SLUG = 'ithrott';

/** Merchandising buckets that a toggle already covers: NETTILBOD (`sale`) is the Útsala toggle. Hidden like the
 *  pseudo-categories below (Vöruflokkar, the shop's rail links) unless active. "Sumar" is a real category and stays. */
export const HIDDEN_SHOP_CATEGORY_SLUGS: ReadonlySet<string> = new Set([CARD_SALE_ROOT_SLUG]);

/** Categories that are really a brand or a club, which the Vörumerki and Félag/Lið groups already cover, plus the
 *  HIDDEN_SHOP_CATEGORY_SLUGS buckets. The data rule (2026-10-26 tree): a category is a pseudo-category when
 *   - its slug is in HIDDEN_SHOP_CATEGORY_SLUGS (NETTILBOD), or
 *   - its name equals a product_brand term's name ("Didriksons", top level and again under Fatnaður as `vetur`), or
 *   - it is the clubs root `felag-lid` or anywhere under it, or
 *   - outside the `ithrott` (sports) subtree, its name equals a pa_felag-lid term's name ("Stjarnan", "FH") or ends
 *     with one as a whole word ("Fimleikafélagið Björk" → the club "Björk"). pa_felag-lid has stray terms, so a term
 *     that is also a pa_ithrott (sport) name ("Fótbolti", "Körfubolti") is not a club, and a top-level category with
 *     sub-categories (a product root such as Skór) is never a club bucket. A top-level leaf ("Stjarnan") can be.
 *  Names compare case-insensitively after Unicode normalisation. A hidden category hides its subtree. */
export function pseudoCategoryIds(categories: CategoryTerm[], brands: TermRef[], teams: TermRef[], sports: TermRef[] = []): Set<number> {
  const brandNames = new Set(brands.map((b) => norm(b.name)));
  const sportNames = new Set(sports.map((s) => norm(s.name)));
  const teamNames = [...new Set(teams.map((t) => norm(t.name)))].filter((t) => t && !sportNames.has(t));
  const isClub = (name: string) => teamNames.some((t) => name === t || name.endsWith(` ${t}`));
  const hasChildren = new Set(categories.map((c) => c.parent));
  const hidden = new Set<number>();
  const walk = (parentId: number, inSports: boolean, hide: boolean, seen: Set<number>) => {
    for (const c of childrenOf(categories, parentId)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const name = norm(c.name);
      const inSportsTree = inSports || (parentId === 0 && c.slug === SPORTS_ROOT_SLUG);
      const productRoot = parentId === 0 && hasChildren.has(c.id);
      const pseudo =
        hide ||
        (parentId === 0 && HIDDEN_SHOP_CATEGORY_SLUGS.has(c.slug)) ||
        brandNames.has(name) ||
        c.slug === CLUBS_ROOT_SLUG ||
        (!inSportsTree && !productRoot && isClub(name));
      if (pseudo) hidden.add(c.id);
      walk(c.id, inSportsTree, pseudo, seen);
    }
  };
  walk(0, false, false, new Set());
  return hidden;
}

const SIZE_GROUP_ORDER = ['shoe', 'letter', 'kids', 'other'] as const;
export const SIZE_GROUP_HEADINGS: Record<(typeof SIZE_GROUP_ORDER)[number], string> = {
  shoe: 'Skóstærðir',
  letter: 'Fatastærðir',
  kids: 'Barnastærðir',
  other: 'Annað',
};

export interface SizeItem {
  slug: string;
  group: string;
  count?: number;
  active: boolean;
}
export interface SizeBlock<T extends SizeItem> {
  group: string;
  heading: string;
  options: (T & { minor: boolean })[];
  /** None of the block's sizes is shown before "Sýna allar stærðir". */
  minor: boolean;
}

/** The Stærð grid: sizes split into shoe → letter → kids → other blocks (input order kept inside each, which the
 *  size index already sorts). With more than `limit` + 4 sizes, only `limit` stay visible — every selected size,
 *  then the best-stocked ones — and the rest are `minor`: shown in place by "Sýna allar stærðir". (On Skór the
 *  first sizes by number are children's 17–29; by stock they are the adult sizes people look for.) */
export function sizeBlocks<T extends SizeItem>(sizes: T[], limit = 24): SizeBlock<T>[] {
  const visible = new Set<number>();
  if (sizes.length <= limit + 4) sizes.forEach((_, i) => visible.add(i));
  else {
    sizes.forEach((s, i) => s.active && visible.add(i));
    const byStock = sizes.map((s, i) => ({ i, n: s.count ?? 0 })).filter(({ i }) => !visible.has(i)).sort((a, b) => b.n - a.n || a.i - b.i);
    for (const { i } of byStock) {
      if (visible.size >= limit) break;
      visible.add(i);
    }
  }
  const rank = (g: string) => {
    const r = (SIZE_GROUP_ORDER as readonly string[]).indexOf(g);
    return r < 0 ? SIZE_GROUP_ORDER.length - 1 : r;
  };
  const blocks: SizeBlock<T>[] = SIZE_GROUP_ORDER.map((g) => ({ group: g, heading: SIZE_GROUP_HEADINGS[g], options: [], minor: true }));
  sizes.forEach((s, i) => {
    const block = blocks[rank(s.group)];
    const minor = !visible.has(i);
    block.options.push({ ...s, minor });
    if (!minor) block.minor = false;
  });
  return blocks.filter((b) => b.options.length > 0);
}

/** "125 vörur", "1 vara", "21 vara" (Icelandic: the singular after a number ending in 1, except 11). */
export function countWord(n: number): string {
  return pluralWord(n, 'vara', 'vörur');
}

/** The order active filters are named in (page title, chips): what the products are first, then how they're narrowed. */
export const ACTIVE_ORDER: FilterKey[] = ['brand', 'kyn', 'ithrott', 'team', 'product-category', 'litur', 'staerd', 'verd', 'utsala', 'lager'];

/** Groups that are left out when they describe too few of the products in view (Íþrótt on a shoe page with three
 *  football boots), and the share they must reach. */
export const COVERAGE_GROUPS: ReadonlySet<FilterKey> = new Set(['ithrott', 'team', 'litur']);
const MIN_GROUP_COVERAGE = 0.1;
/** List groups with more options than this get a search box. */
export const LIST_SEARCH_MIN = 12;

/** Whether a group covers enough of the `total` products in view to be worth showing. Coverage is the sum of its
 *  option counts (capped at the total): an upper bound on the products having any of its values, since a product can
 *  carry two. The largest single option would hide Félag/Lið on the whole shop, where no one club reaches 3% but the
 *  clubs together cover 13%. Kept when unsure (no counts or no total) and when one of its options is active. */
export function coversEnough(group: { options: { active: boolean; count?: number }[]; showCounts: boolean }, total: number | undefined): boolean {
  if (!group.showCounts || !total || group.options.some((o) => o.active)) return true;
  const sum = group.options.reduce((n, o) => n + (o.count ?? 0), 0);
  return Math.min(sum, total) / total >= MIN_GROUP_COVERAGE;
}

/** Swatch colours for the Litur filter, by pa_litur term slug (and the parts of a two-colour slug like
 *  "blar-hvitur"). The one place colour enters the monochrome UI: it is product data, not decoration. */
const COLOUR_HEX: Record<string, string> = {
  svartur: '#1b1b1b',
  hvitur: '#f4f4f4',
  hvitt: '#f4f4f4',
  svart: '#1b1b1b',
  grar: '#9a9a9a',
  gratt: '#9a9a9a',
  blar: '#2f6fed',
  dokkblatt: '#1e2a52',
  bleikur: '#f178b6',
  'dusty-pink': '#e3a3b8', // named Ljósbleikur
  graenn: '#3aa657',
  raudur: '#d83a3a',
  gulur: '#f3c70f',
  fjolublar: '#8a4fce',
  brunn: '#8a5a33',
  appelsinugulur: '#f08a1d',
};

/** Whether a colour term is listed in the Litur filter: the owner took the two-colour terms ("Blár/hvítur") and
 *  ISLAND (a team kit, no colour) off it (2026-10-30). */
export function isPlainColour(term: { slug: string; name: string }): boolean {
  return !term.name.includes('/') && term.slug !== 'island';
}

/** One or two swatch colours for a colour term, or undefined when the slug isn't a known colour (no swatch). */
export function colourSwatch(slug: string): string[] | undefined {
  const hex = (key: string) => (Object.hasOwn(COLOUR_HEX, key) ? COLOUR_HEX[key] : undefined);
  const whole = hex(slug);
  if (whole) return [whole];
  const parts = slug.split('-').flatMap((p) => hex(p) ?? []);
  return parts.length === 2 && slug.split('-').length === 2 ? parts : undefined;
}

const ACTIVE_LABEL: Partial<Record<FilterKey, string>> = { lager: 'Á lager' };

interface ActiveSource {
  slug: string;
  name: string;
  active: boolean;
  key?: FilterKey;
  children: ActiveSource[];
}
export interface ActiveFilter {
  key: FilterKey;
  slug: string;
  label: string;
}

/** Every active value in the rail groups (sub-categories included), in ACTIVE_ORDER: the page title's labels and
 *  the removable chips. An option's own `key` wins over its group's (the Útsala / Á lager rows share a block). */
export function activeFilterList(groups: { key: FilterKey; options: ActiveSource[] }[]): ActiveFilter[] {
  const byKey = new Map<FilterKey, ActiveFilter[]>();
  const collect = (opts: ActiveSource[], groupKey: FilterKey) => {
    for (const o of opts) {
      const key = o.key ?? groupKey;
      if (o.active) byKey.set(key, [...(byKey.get(key) ?? []), { key, slug: o.slug, label: ACTIVE_LABEL[key] ?? o.name }]);
      collect(o.children, groupKey);
    }
  };
  for (const g of groups) collect(g.options, g.key);
  return ACTIVE_ORDER.flatMap((k) => byKey.get(k) ?? []);
}

/** The most filter labels a page title names; the rest are counted ("+2"). */
const MAX_TITLE_LABELS = 4;

/** Page title with the active filters: "Skór – Nike, 42"; past four, "Skór – Nike, Adidas, Konur, 42 +2". */
export function filterTitle(title: string, labels: string[]): string {
  if (!labels.length) return title;
  const shown = labels.slice(0, MAX_TITLE_LABELS).join(', ');
  return labels.length > MAX_TITLE_LABELS ? `${title} – ${shown} +${labels.length - MAX_TITLE_LABELS}` : `${title} – ${shown}`;
}
