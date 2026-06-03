// Faceted-filter config + URL <-> selection plumbing for the shop pages.
// Semantics: OR within a facet (pick several colours), AND across facets
// (colour AND sport AND brand) — implemented by storeCatalog.storeProducts().
import { listAttributeTerms, listBrandTerms, type FacetTerm } from './woo';
import type { AttributeFilter } from './storeCatalog';

export const BRAND_KEY = 'merki';

/** Attribute facets shown in the shop filter UI (clothing size pa_staerdir is
 *  omitted — 200+ terms make a flat list unusable; size is chosen on the PDP). */
export const FACET_GROUPS = [
  { key: 'ithrott', taxonomy: 'pa_ithrott', attrId: 6, label: 'Íþrótt', cap: 24 },
  { key: 'kyn', taxonomy: 'pa_kyn', attrId: 8, label: 'Kyn', cap: 8 },
  { key: 'litur', taxonomy: 'pa_litur', attrId: 2, label: 'Litur', cap: 40 },
  { key: 'skostaerd', taxonomy: 'pa_skostaerdir', attrId: 4, label: 'Skóstærð', cap: 40 },
] as const;

export interface FacetGroupData {
  key: string;
  label: string;
  taxonomy: string;
  terms: FacetTerm[];
  /** Max terms to render in the dropdown (curation; the panel is scrollable). */
  cap: number;
}
export interface FacetData {
  brand: FacetGroupData;
  groups: FacetGroupData[];
}

const BRAND_CAP = 24;

/** Load every facet's term list (brand + attributes) in parallel. The underlying
 *  woo fetchers cache for 10 min, so this is cheap on warm processes. */
export async function loadFacetData(): Promise<FacetData> {
  const [brandTerms, ...groupTerms] = await Promise.all([
    listBrandTerms().catch(() => [] as FacetTerm[]),
    ...FACET_GROUPS.map((g) => listAttributeTerms(g.attrId).catch(() => [] as FacetTerm[])),
  ]);
  return {
    brand: { key: BRAND_KEY, label: 'Vörumerki', taxonomy: 'brand', terms: brandTerms, cap: BRAND_CAP },
    groups: FACET_GROUPS.map((g, i) => ({
      key: g.key,
      label: g.label,
      taxonomy: g.taxonomy,
      terms: groupTerms[i],
      cap: g.cap,
    })),
  };
}

function parseCsv(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolve requested slugs against a term list → ordered, de-duped {ids, slugs}. */
function slugsToIds(csv: string | null, terms: FacetTerm[]): { ids: number[]; slugs: string[] } {
  const want = parseCsv(csv);
  const bySlug = new Map(terms.map((t) => [t.slug, t.id]));
  const ids: number[] = [];
  const slugs: string[] = [];
  for (const s of want) {
    const id = bySlug.get(s);
    if (id != null && !slugs.includes(s)) {
      ids.push(id);
      slugs.push(s);
    }
  }
  return { ids, slugs };
}

export interface Selection {
  brandIds: number[];
  attributes: AttributeFilter[];
  /** Active slugs per facet key (incl. BRAND_KEY) — only those that resolved. */
  active: Record<string, string[]>;
  activeCount: number;
}

/** Read the current facet selection from the URL params, validated against the data. */
export function resolveSelection(params: URLSearchParams, data: FacetData): Selection {
  const active: Record<string, string[]> = {};
  const brand = slugsToIds(params.get(BRAND_KEY), data.brand.terms);
  if (brand.slugs.length) active[BRAND_KEY] = brand.slugs;

  const attributes: AttributeFilter[] = [];
  for (const g of data.groups) {
    const { ids, slugs } = slugsToIds(params.get(g.key), g.terms);
    if (ids.length) {
      attributes.push({ taxonomy: g.taxonomy, termIds: ids });
      active[g.key] = slugs;
    }
  }
  const activeCount = Object.values(active).reduce((n, arr) => n + arr.length, 0);
  return { brandIds: brand.ids, attributes, active, activeCount };
}

/** Build an href that toggles one facet value on/off, preserving the rest. Resets page. */
export function toggleHref(basePath: string, params: URLSearchParams, key: string, slug: string): string {
  const p = new URLSearchParams(params);
  const current = parseCsv(p.get(key));
  const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...new Set([...current, slug])];
  if (next.length) p.set(key, next.join(','));
  else p.delete(key);
  p.delete('page');
  const qs = p.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Href that clears all facet selections (keeps sort/in-stock/sale). */
export function clearHref(basePath: string, params: URLSearchParams): string {
  const p = new URLSearchParams(params);
  p.delete(BRAND_KEY);
  for (const g of FACET_GROUPS) p.delete(g.key);
  p.delete('page');
  const qs = p.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
