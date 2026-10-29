// Product-category tree helpers for live's /voruflokkur/<parent>/<child>/ URLs. Pure.
import { categoryPath } from './paths';
import { KYN_PARENT_SLUG, type CategoryTerm } from './liveFilters';

/** Slugs from the root down to `id` ([] if unknown). Guards against parent cycles. */
export function categoryChain(categories: CategoryTerm[], id: number): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const chain: string[] = [];
  const seen = new Set<number>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur.slug);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return chain;
}

/** Top-level categories that group products by something other than what they are (live's "kyn" gender facets,
 *  WordPress's unsorted buckets). The archive hides them from its filters. */
export const STRUCTURAL_ROOT_SLUGS: ReadonlySet<string> = new Set([KYN_PARENT_SLUG, 'uncategorized', 'oflokkad', 'unisex']);

/** The merchandising bucket a card ranks last: the archive keeps it as a filter, but next to the product type it says
 *  little (the sale badge already says "sale"), so it never takes a slot from a gender facet either. */
export const CARD_SALE_ROOT_SLUG = 'sale';

type FoundCategory = { id: number; name: string; chain: string[] };

/** Card rank of a category's root: 0 real product type, 1 structural facet (gender, unisex, unsorted), 2 sale. */
const tier = (c: FoundCategory) => (c.chain[0] === CARD_SALE_ROOT_SLUG ? 2 : STRUCTURAL_ROOT_SLUGS.has(c.chain[0]) ? 1 : 0);
const isAncestorOf = (a: FoundCategory, b: FoundCategory) => a.chain.length < b.chain.length && a.chain.every((slug, i) => b.chain[i] === slug);

/** The categories a product card lists, at most `limit`: each name once, never a category whose descendant is also
 *  listed, real categories first, then structural facets, then the sale bucket; within a tier most specific first,
 *  then alphabetical in Icelandic order. Of two categories with the same name the lower tier wins, then the deeper,
 *  then the one whose root branch more of the product's other categories share (Fatnaður + two "Hlaup" → the
 *  clothing one), then the lower id (so the API's order never decides). Categories missing from the tree are
 *  dropped. `productCats` names are expected decoded. */
export function cardCategories(productCats: { id: number; name: string }[], categories: CategoryTerm[], limit: number): { name: string; path: string }[] {
  const found = productCats.map(({ id, name }) => ({ id, name, chain: categoryChain(categories, id) })).filter((c) => c.chain.length > 0);
  const sharedRoot = (c: FoundCategory) => found.filter((o) => o.name !== c.name && o.chain[0] === c.chain[0]).length;
  const byName = new Map<string, FoundCategory>();
  for (const c of found) {
    const kept = byName.get(c.name);
    const wins =
      !kept ||
      (tier(c) - tier(kept) || kept.chain.length - c.chain.length || sharedRoot(kept) - sharedRoot(c) || c.id - kept.id) < 0;
    if (wins) byName.set(c.name, c);
  }
  const listed = [...byName.values()];
  return listed
    .filter((a) => !listed.some((b) => isAncestorOf(a, b)))
    .sort((a, b) => tier(a) - tier(b) || b.chain.length - a.chain.length || a.name.localeCompare(b.name, 'is'))
    .slice(0, limit)
    .map((c) => ({ name: c.name, path: categoryPath(c.chain) }));
}

/** Root-first {name, path} crumbs for a category. */
function chainTrail(categories: CategoryTerm[], id: number): { name: string; path: string }[] {
  const chain = categoryChain(categories, id);
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  return chain.map((s, i) => ({ name: bySlug.get(s)?.name ?? s, path: categoryPath(chain.slice(0, i + 1)) }));
}

export interface ResolvedCategory {
  term: CategoryTerm;
  /** Canonical /voruflokkur/…/ path. */
  path: string;
  /** Whether the requested segments already were the canonical chain. */
  canonical: boolean;
  /** Root-first breadcrumb trail, ending with this category. */
  trail: { name: string; path: string }[];
}

/** Resolve rest-route segments by their last slug; null if that slug isn't a category. */
export function resolveCategoryPath(categories: CategoryTerm[], segments: string[]): ResolvedCategory | null {
  const slug = segments[segments.length - 1];
  const term = slug ? categories.find((c) => c.slug === slug) : undefined;
  if (!term) return null;
  const chain = categoryChain(categories, term.id);
  const trail = chainTrail(categories, term.id);
  return {
    term,
    path: categoryPath(chain),
    canonical: chain.length === segments.length && chain.every((s, i) => s === segments[i]),
    trail,
  };
}

/** A product page's category crumbs the way WooCommerce builds them: the product's categories
 *  ordered by parent id descending (ties by id), the first one's ancestors then itself. */
export function productCrumbTrail(categories: CategoryTerm[], productCategoryIds: number[]): { name: string; path: string }[] {
  const ids = new Set(productCategoryIds);
  const main = categories.filter((c) => ids.has(c.id)).sort((a, b) => b.parent - a.parent || a.id - b.id)[0];
  return main ? chainTrail(categories, main.id) : [];
}

export function childrenOf(categories: CategoryTerm[], parentId: number): CategoryTerm[] {
  return categories.filter((c) => c.parent === parentId && c.id !== parentId);
}

/** The wall rail's plain category links (nike-look): the children of the archive's category, or the top-level
 *  categories when there is none (the shop). Structural roots are hidden at the top level and categories with
 *  no products in them or below them are left out, as in the archive's Vöruflokkar tree. `hidden`: ids to leave
 *  out as well (the shop passes facets' brand/club pseudo-categories). */
export function railCategoryLinks(
  categories: CategoryTerm[],
  counts: Map<number, number>,
  scopeId = 0,
  hidden: ReadonlySet<number> = new Set(),
): { name: string; path: string }[] {
  const stocked = (id: number, seen: Set<number>): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return (counts.get(id) ?? 0) > 0 || childrenOf(categories, id).some((c) => stocked(c.id, seen));
  };
  return childrenOf(categories, scopeId)
    .filter((c) => !(scopeId === 0 && STRUCTURAL_ROOT_SLUGS.has(c.slug)) && !hidden.has(c.id))
    .filter((c) => stocked(c.id, new Set()))
    .map((c) => ({ name: c.name, path: categoryPath(categoryChain(categories, c.id)) }));
}
