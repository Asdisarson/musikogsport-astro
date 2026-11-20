// Archive pages (shop, category, brand, tag, search) — SERVER-ONLY. One loader so every archive
// shares live's filter semantics, page size and facet groups.
import { loadCatalogTerms, loadSizeTerms, type CatalogData } from './catalogTerms';
import { categoryChain, childrenOf, STRUCTURAL_ROOT_SLUGS } from './categoryTree';
import { activeFilterList, colourSwatch, COVERAGE_GROUPS, coversEnough, isPlainColour, keepOption, pickCounts, pickNote, pseudoCategoryIds, sizeBlocks, type ActiveFilter, type SizeBlock } from './facets';
import {
  KYN_PARENT_SLUG,
  MERGED_COLOURS,
  PRICE_PRESETS,
  parseLiveFilters,
  presetBounds,
  sizeIndexDecision,
  toStoreFilter,
  type FilterKey,
  type LiveFilterState,
  type SizeRef,
  type TermRef,
} from './liveFilters';
import { collectionCounts, COUNT_TAXONOMIES, currencyMinorUnit, matchCount, storeProducts, type CountsResult, type StoreQuery } from './storeCatalog';
import type { CachedWooProduct, Paged } from './types';

/** The archive's own constraint: a category archive, tag archive, brand archive, or none (shop/search). */
export interface ArchiveScope {
  categoryId?: number;
  tagId?: number;
  brandId?: number;
}

export interface FacetOption extends TermRef {
  /** Products this option gives within the other filters (OR within its own group); undefined when unknown. */
  count?: number;
  active: boolean;
  /** Nesting level in the Vöruflokkar tree (0 = top level). */
  depth: number;
  /** Sub-categories (Vöruflokkar only; shown collapsed behind a "+"). */
  children: FacetOption[];
  /** Render the sub-tree expanded (an option inside it is active). */
  open: boolean;
  /** The URL key this option toggles, when it isn't its group's (the Útsala and Á lager rows share one block). */
  key?: FilterKey;
  /** Size group (shoe | letter | kids | other), Stærð only. */
  group?: string;
  /** Swatch colours (one, or two for a two-colour term), Litur only. */
  swatch?: string[];
  /** Why this option cannot be picked (the picking caps are reached, facets pickNote): shown unavailable, not a link. */
  blocked?: string;
}
export type SizeOption = FacetOption & { group: string };
/** How a group renders: checkbox rows, the Vöruflokkar tree, the Stærð button grid, or the toggle rows on top. */
export type FacetKind = 'list' | 'tree' | 'size' | 'toggles';
export interface FacetGroup {
  key: FilterKey;
  label: string;
  kind: FacetKind;
  options: FacetOption[];
  /** Whether the options carry counts (false only when the count request failed). */
  showCounts: boolean;
  /** Open by default: a group with a selection, the toggles, and Stærð on shoe categories. */
  open: boolean;
  /** Why no more values of this group can be picked (facets pickNote), when the caps are reached. */
  note?: string;
  /** Stærð only: the options split into shoe → letter → kids → other blocks. */
  sizeBlocks?: SizeBlock<SizeOption>[];
}
export interface Archive {
  result: Paged<CachedWooProduct>;
  state: LiveFilterState;
  groups: FacetGroup[];
  activeCount: number;
  /** Labels of the active filters, for the page title ("Nike", "42"). */
  activeLabels: string[];
  /** The active filter values in title order: the removable chips under the header. */
  activeFilters: ActiveFilter[];
  /** Brand and club pseudo-categories and NETTILBOD (facets.pseudoCategoryIds): hidden from Vöruflokkar and the shop's
   *  rail links. */
  pseudoCategories: ReadonlySet<number>;
  terms: CatalogData;
  /** The products couldn't be loaded, or filters were asked for while the terms (or, for `staerd`, the size list)
   *  are down: answer 503. */
  unavailable: boolean;
  /** The facet counts didn't come back (the page still shows, without counts): the page must not be stored. */
  countsMissing: boolean;
}

/** Stærð opens by default on this category and below it. */
const SHOE_ROOT_SLUG = 'skor';

const EMPTY_RESULT = (page: number): Paged<CachedWooProduct> => ({ items: [], total: 0, totalPages: 0, page });
const NO_COUNTS = new Map<number, number>();

export async function loadArchive(params: URLSearchParams, page: number, scope: ArchiveScope = {}): Promise<Archive> {
  const [terms, sizeIndex] = await Promise.all([loadCatalogTerms(), loadSizeTerms()]);
  const sizes = sizeIndex.sizes;
  const state = parseLiveFilters(params);
  // Filter slugs can't be mapped without the terms; the plain shop and a search don't need them (nor do the size,
  // price, sale and stock keys). Sizes need the size list unless the size plugin simply isn't installed.
  const needsTerms = state.kyn.length + state.brand.length + state.team.length + state.productCategory.length + state.ithrott.length + state.litur.length > 0;
  if ((terms.degraded && needsTerms) || sizeIndexDecision(state.staerd.length > 0, sizeIndex.status) === 'unavailable') {
    return {
      result: EMPTY_RESULT(page),
      state,
      groups: [],
      activeCount: 0,
      activeLabels: [],
      activeFilters: [],
      pseudoCategories: new Set(),
      terms,
      unavailable: true,
      countsMissing: false,
    };
  }
  const minorUnit = currencyMinorUnit();
  const { filter, active, activeCount } = toStoreFilter(state, { ...terms, sizes }, scope.categoryId, minorUnit);
  const scopeBrand = scope.brandId ? [scope.brandId] : undefined;

  const q: StoreQuery = {
    page,
    categoryIds: filter.categoryIds,
    andCategoryIds: filter.andCategoryIds,
    brandIds: filter.brandIds ?? scopeBrand,
    tagIds: scope.tagId ? [scope.tagId] : undefined,
    attributes: filter.attributes,
    sizeSlugs: filter.sizeSlugs,
    minPrice: filter.minPrice,
    maxPrice: filter.maxPrice,
    stockStatus: filter.stockStatus,
    on_sale: filter.onSale,
    orderby: filter.orderby,
    order: filter.order,
    search: filter.search,
  };
  const { category, brand, team, sport, colour } = COUNT_TAXONOMIES;
  const activePrice = active.verd?.[0];

  // One request for the grid and one for most counts (categories incl. Aldur/Kyn, brands, Félag/Lið, Íþrótt and Litur as
  // OR attribute counts that leave their own selection out, sizes without the size filter, stock, and — from the
  // size plugin's `mos_extra_counts` — each inactive price preset, every one within the other filters).
  // An active OR-within taxonomy group self-applies to its own counts, so it gets a companion request without its
  // selection. An active price preset (or Útsala) is simply the grid's total. The grid request goes first, so it is
  // first to get a PHP worker.
  const presets = PRICE_PRESETS.filter((p) => p.key !== activePrice);
  const ranges = presets.map((p) => presetBounds(p, minorUnit));
  // One count request per preset: the old path, for a site without the size plugin (in parallel)
  // or with a version of it that doesn't answer `mos_extra_counts` (after the main request, which asked).
  const separateCounts = () =>
    Promise.all(ranges.map((r) => matchCount({ ...q, minPrice: r.min, maxPrice: r.max })));
  const pluginAbsent = sizeIndex.status === 'absent';
  const [result, main, withoutPc, withoutKyn, withoutBrand, separate] = await Promise.all([
    storeProducts(q).catch((): null => null),
    collectionCounts(q, {
      taxonomies: [category, brand],
      attributes: [team, sport, colour],
      sizes: sizes !== undefined,
      stock: Boolean(active.lager), // only the lager row reads it, and it shows only while that filter is on
      extra: pluginAbsent ? undefined : { priceRanges: ranges, onSale: false },
    }),
    active['product-category']
      ? collectionCounts({ ...q, categoryIds: scope.categoryId ? [scope.categoryId] : undefined }, { taxonomies: [category] })
      : undefined,
    active.kyn ? collectionCounts({ ...q, andCategoryIds: undefined }, { taxonomies: [category] }) : undefined,
    active.brand ? collectionCounts({ ...q, brandIds: scopeBrand }, { taxonomies: [brand] }) : undefined,
    pluginAbsent ? separateCounts() : undefined,
  ]);
  const presetCounts = main?.extra ? main.extra.price : (separate ?? (await separateCounts()));
  const priceCounts = PRICE_PRESETS.map((p) => (p.key === activePrice ? undefined : presetCounts[presets.indexOf(p)]));
  const total = result?.total;
  // A companion request when there is one (null if it failed), else the main counts.
  const pick = (companion: CountsResult | null | undefined) => (companion === undefined ? main : companion);

  // The picking caps, counted from the URL as the middleware counts them: a pick that would cross one is shown as
  // unavailable (facets pickNote), so the redirect for an over-picked URL is never one a click leads to.
  const caps = pickCounts({
    kyn: state.kyn,
    brand: state.brand,
    team: state.team,
    'product-category': state.productCategory,
    ithrott: state.ithrott,
    litur: state.litur,
  });
  const option = (t: TermRef, key: FilterKey, source: Map<number, number> | null, depth = 0): FacetOption => {
    const isActive = active[key]?.includes(t.slug) ?? false;
    return { ...t, count: source?.get(t.id), active: isActive, depth, children: [], open: false, blocked: isActive ? undefined : pickNote(key, caps) };
  };
  const listGroup = (key: FilterKey, label: string, pool: TermRef[], source: Map<number, number> | null): FacetGroup => {
    const options = pool.map((t) => option(t, key, source)).filter((o) => keepOption(o, source));
    return { key, label, kind: 'list', showCounts: source !== null, open: options.some((o) => o.active), options, note: pickNote(key, caps) };
  };
  /** A computed option (price preset, toggle row): `count` undefined when its request failed. */
  const plainOption = (id: number, slug: string, name: string, count: number | undefined, isActive: boolean, key?: FilterKey): FacetOption =>
    ({ id, slug, name, count, active: isActive, depth: 0, children: [], open: false, key });
  const known = (o: FacetOption) => keepOption(o, o.count === undefined ? null : NO_COUNTS);

  // Toggle rows on top of the rail. The owner took "Útsala" and "Aðeins vörur á lager" off the rail (2026-10-30); a
  // link that still carries utsala=1 / lager=1 keeps its row, so the filter it applies can be seen and removed.
  const toggles = [
    ...(active.utsala ? [plainOption(-1, '1', 'Útsala', total, true, 'utsala')] : []),
    ...(active.lager ? [plainOption(-2, '1', 'Aðeins vörur á lager', main?.stock.get('instock'), true, 'lager')] : []),
  ].filter(known);

  // Stærð: the sizes the products in view come in (selected ones kept), as a button grid.
  let sizeOptions: SizeOption[] = [];
  if (sizes !== undefined) {
    const source = main?.sizes ?? null;
    const pool: (SizeRef & { count?: number })[] = source ?? sizes;
    sizeOptions = pool.map((s, i) => ({
      ...plainOption(-100 - i, s.slug, s.label, s.count, active.staerd?.includes(s.slug) ?? false),
      group: s.group,
    }));
    if (source) sizeOptions = sizeOptions.filter((o) => keepOption(o, NO_COUNTS));
    // A selected size the lists don't know (newer than the cached size list, or no such size): still an active,
    // removable option with its slug as the label, so it gets a chip.
    const listed = new Set(sizeOptions.map((o) => o.slug));
    for (const slug of active.staerd ?? []) {
      if (!listed.has(slug)) sizeOptions.push({ ...plainOption(-100 - pool.length - sizeOptions.length, slug, slug, source ? 0 : undefined, true), group: 'other' });
    }
  }
  const inShoes = scope.categoryId !== undefined && categoryChain(terms.categories, scope.categoryId)[0] === SHOE_ROOT_SLUG;
  const sizeGroup: FacetGroup = {
    key: 'staerd',
    label: 'Stærð',
    kind: 'size',
    showCounts: Boolean(main?.sizes),
    open: inShoes || sizeOptions.some((o) => o.active),
    options: sizeOptions,
    sizeBlocks: sizeBlocks(sizeOptions),
  };

  // Verð: four presets, one at a time.
  const priceOptions = PRICE_PRESETS.map((p, i) =>
    plainOption(-10 - i, p.key, p.label, p.key === activePrice ? total : priceCounts[i], p.key === activePrice),
  ).filter(known);

  // Vöruflokkar: a collapsible category tree, starting at the top level (structural roots and the brand and club
  // pseudo-categories hidden). Only where the rail has no category links of its own (shop, brand, tag and search),
  // or on a category archive with a sub-category already chosen, so it stays removable.
  const kynParent = terms.categories.find((c) => c.slug === KYN_PARENT_SLUG);
  const pseudo = pseudoCategoryIds(terms.categories, terms.brands, terms.teams, terms.sports);
  const pcSource = pick(withoutPc)?.taxonomy ?? null;
  const isActivePc = (slug: string) => active['product-category']?.includes(slug) ?? false;
  const tree = (parentId: number, depth: number): FacetOption[] =>
    childrenOf(terms.categories, parentId)
      .filter((c) => !(parentId === 0 && STRUCTURAL_ROOT_SLUGS.has(c.slug)) && (!pseudo.has(c.id) || isActivePc(c.slug)))
      .map((c) => {
        const o = option(c, 'product-category', pcSource, depth);
        o.children = tree(c.id, depth + 1);
        o.open = o.children.some((ch) => ch.active || ch.open);
        return o;
      })
      // With counts: categories with products here (counts include sub-categories). Without: any with products.
      .filter((o) => (pcSource ? keepOption(o, pcSource) : o.active || o.children.length > 0 || (terms.counts.get(o.id) ?? 0) > 0));
  const showTree = scope.categoryId === undefined || Boolean(active['product-category']);
  const treeOptions = showTree ? tree(scope.categoryId ?? 0, 0) : [];
  const categoryGroup: FacetGroup = {
    key: 'product-category',
    label: 'Vöruflokkar',
    kind: 'tree',
    showCounts: pcSource !== null,
    open: treeOptions.some((o) => o.active || o.open), // `open` is set on an option with an active descendant
    options: treeOptions,
    note: pickNote('product-category', caps),
  };

  // Litur: checkbox rows with a swatch; commonest colours first (the term list is alphabetical). Only plain colours
  // (isPlainColour); a link that still selects a two-colour term or ISLAND keeps that row, so it can be removed.
  // A merged colour's products count towards the colour it's part of (MERGED_COLOURS: Mahagony Red is Rauður).
  const colourCounts = main?.attribute ? new Map(main.attribute) : null;
  if (colourCounts) {
    for (const [slug, merged] of Object.entries(MERGED_COLOURS)) {
      const into = terms.colours.find((c) => c.slug === slug);
      const extra = terms.colours.filter((c) => merged.includes(c.slug)).reduce((n, c) => n + (colourCounts.get(c.id) ?? 0), 0);
      if (into && extra) colourCounts.set(into.id, (colourCounts.get(into.id) ?? 0) + extra);
    }
  }
  const colourGroup = listGroup('litur', 'Litur', terms.colours, colourCounts);
  colourGroup.options = colourGroup.options
    .filter((o) => o.active || isPlainColour(o))
    .map((o) => ({ ...o, swatch: colourSwatch(o.slug) }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  const groups: FacetGroup[] = [
    { key: 'utsala', label: 'Útsala', kind: 'toggles', showCounts: true, open: true, options: toggles } satisfies FacetGroup,
    sizeGroup,
    listGroup('kyn', 'Aldur/Kyn', kynParent ? childrenOf(terms.categories, kynParent.id) : [], pick(withoutKyn)?.taxonomy ?? null),
    { key: 'verd', label: 'Verð', kind: 'list', showCounts: true, open: Boolean(activePrice), options: priceOptions } satisfies FacetGroup,
    listGroup('brand', 'Vörumerki', terms.brands, pick(withoutBrand)?.taxonomy ?? null),
    colourGroup,
    listGroup('ithrott', 'Íþrótt', terms.sports, main?.attribute ?? null),
    listGroup('team', 'Félag/Lið', terms.teams, main?.attribute ?? null),
    categoryGroup,
  ].filter((g) => g.options.length > 0 && (!COVERAGE_GROUPS.has(g.key) || coversEnough(g, total)));

  // Title labels and chips: every active option, in facets.ACTIVE_ORDER.
  const activeFilters = activeFilterList(groups);
  const activeLabels = activeFilters.map((f) => f.label);

  return {
    result: result ?? EMPTY_RESULT(page),
    state,
    groups,
    activeCount,
    activeLabels,
    activeFilters,
    pseudoCategories: pseudo,
    terms,
    unavailable: result === null,
    countsMissing: main === null,
  };
}
