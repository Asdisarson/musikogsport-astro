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

// Real product-colour swatches for the Litur facet — the one place colour is allowed
// into the monochrome UI because it's functional data, not decoration. Keyed by term
// slug (incl. alt grammatical forms); two-word slugs (e.g. "blar-hvitur") render as a
// split swatch. Unknown slugs return null → the option falls back to the neutral box.
const COLOUR_HEX: Record<string, string> = {
  grar: '#9a9a9a', gratt: '#9a9a9a',
  svartur: '#1b1b1b', svart: '#1b1b1b', black: '#1b1b1b',
  hvitur: '#f1f1f1', hvitt: '#f1f1f1', white: '#f1f1f1',
  blar: '#2f6fed', blatt: '#2f6fed', dokkblatt: '#1e2a52',
  bleikur: '#f178b6', 'dusty-pink': '#d9a7b0',
  graenn: '#3aa657', graent: '#3aa657',
  fjolublar: '#8a4fce',
  raudur: '#d83a3a', rautt: '#d83a3a', 'mahagony-red': '#6e2a26',
  gulur: '#f3c70f', gult: '#f3c70f', yellow: '#f3c70f',
  brunn: '#8a5a33',
  beige: '#d9c9a8',
  silfur: '#c4c4c8',
  turkis: '#1bb5ad',
  appelsinugulur: '#f08a1d',
  gull: '#d4af37',
};

/** One or two hex colours for a colour-term slug, or null if it isn't a known colour. */
export function colourSwatch(slug: string): string[] | null {
  if (COLOUR_HEX[slug]) return [COLOUR_HEX[slug]];
  if (slug.includes('-')) {
    const parts = slug.split('-').map((p) => COLOUR_HEX[p]).filter(Boolean);
    if (parts.length === 2) return parts;
  }
  return null;
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
