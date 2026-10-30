// The product page's size chart ("Stærðartafla"): which of the /staerdir/ WordPress page's charts a product needs.
// The page is a run of `<h4>AUDIENCE / … / GARMENT</h4>` headings, each followed by its table(s); the owner edits it
// in WordPress, so charts are matched by reading the heading words, not by position. Pure; the product page runs
// sizeChartFor on the server, SizeGuide.astro's script runs pickSections in the browser.

export type Audience = 'karlar' | 'konur' | 'born';
/** efri: upper body · nedri: lower body · naerfot: underwear · toppar: tops / sport bras · sund: swim · lid: team kit
 *  · general: a kids chart for all their clothing. */
export type Garment = 'efri' | 'nedri' | 'naerfot' | 'toppar' | 'sund' | 'lid' | 'general';

export interface SizeWant {
  /** Kyn categories, in Kyn order; empty when the product has none. */
  audiences: Audience[];
  garment: Exclude<Garment, 'general'>;
}

const AUDIENCES: Audience[] = ['karlar', 'konur', 'born'];
const GARMENTS: SizeWant['garment'][] = ['efri', 'nedri', 'naerfot', 'toppar', 'sund', 'lid'];

/** Accent- and case-free, so "Neðri líkami" and "NEÐRI LÍKAMI" read the same. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ð/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/æ/g, 'ae')
    .replace(/ö/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const KIDS_WORDS = /\b(strak|stelp|krakk|born|litl|stor)/;

/** Who and what one /staerdir/ heading's chart is for; null for a part it doesn't recognise. */
export function headingKind(heading: string): { audience: Audience | null; garment: Garment | null } {
  const parts = fold(heading).split('/').map((p) => p.trim()).filter(Boolean);
  const who = parts.slice(0, -1).join(' ') || (parts[0] ?? '');
  const what = parts[parts.length - 1] ?? '';
  const audience: Audience | null = /\bkarlar\b/.test(who) ? 'karlar' : /\bkonur\b/.test(who) ? 'konur' : KIDS_WORDS.test(who) ? 'born' : null;
  const garment: Garment | null =
    what === 'sundfatnadur'
      ? 'sund'
      : what === 'fotboltafatnadur'
        ? 'lid'
        : what === 'efri likami'
          ? 'efri'
          : what === 'nedri likami' || what === 'numeradar staerdir'
            ? 'nedri'
            : what === 'naerbuxur'
              ? 'naerfot'
              : what === 'sport bras'
                ? 'toppar'
                : what === 'fatnadur'
                  ? 'general'
                  : null;
  return { audience: parts.length > 1 ? audience : null, garment };
}

// Fatnaður branches, most specific first: a product in both "Hlaup" and "Buxur & leggings" gets the trousers chart.
// Hats, scarves and gloves have no chart: those categories count for nothing.
const NO_CHART = /(^|\/)(hufur-treflar|hanskar-vettlingar)(\/|$)/;
const BRANCHES: [RegExp, SizeWant['garment']][] = [
  [/^fatnadur\/sundfatnadur/, 'sund'],
  [/^fatnadur\/lidafatnadur/, 'lid'],
  [/^fatnadur\/nedri-likami\/sokkar-naerfatnadur/, 'naerfot'],
  [/^fatnadur\/nedri-likami/, 'nedri'],
  [/^fatnadur\/efri-likami\/topp-ur/, 'toppar'],
  [/^fatnadur\/./, 'efri'], // tops and jumpers, outerwear, running, winter, ski
  [/^fatnadur$/, 'efri'],
];

/** Whether a product is a shoe, from its categories' slug chains: any of them under Skór. A shoe is a shoe even when
 *  it is also filed under a clothing branch (running shoes sit in Fatnaður › Hlaup too). */
export function isShoe(chains: string[][]): boolean {
  return chains.some((c) => c[0] === 'skor');
}

/** What size chart a product needs, from its categories' slug chains (lib/categoryTree categoryChain); null when it
 *  has none (shoes, gear, hats and gloves). /staerdir/ has no shoe chart yet. */
export function sizeChartFor(chains: string[][]): SizeWant | null {
  if (isShoe(chains)) return null;
  const paths = chains.map((c) => c.join('/'));
  const ranks = paths.filter((p) => !NO_CHART.test(p)).map((p) => BRANCHES.findIndex(([re]) => re.test(p))).filter((r) => r >= 0);
  if (!ranks.length) return null;
  const garment = BRANCHES[Math.min(...ranks)][1];
  const audiences = AUDIENCES.filter((a) => paths.includes(`kyn/${a}`));
  return { audiences, garment };
}

/** The chart garments that fit a wanted one, best first. */
function fits(audience: Audience | null, garment: SizeWant['garment']): Garment[] {
  // kids' football charts stop at 7-8 years, so the general kids charts follow them for older kids
  if (audience === 'born') return garment === 'sund' ? ['sund'] : garment === 'lid' ? ['lid', 'general'] : ['general'];
  if (garment === 'toppar') return ['toppar', 'efri'];
  if (garment === 'lid') return ['efri', 'nedri'];
  return [garment];
}

/** Indices of the headings to show, in display order: the charts fitting the garment, per audience; else all of the
 *  audiences' charts; else every chart. */
export function pickSections(headings: string[], want: SizeWant): number[] {
  const kinds = headings.map(headingKind);
  const all = headings.map((_, i) => i);
  const matched: number[] = [];
  if (want.audiences.length) {
    for (const audience of want.audiences)
      for (const g of fits(audience, want.garment)) for (const i of all) if (kinds[i].audience === audience && kinds[i].garment === g) matched.push(i);
  } else {
    // no Kyn category: every audience's fitting charts, in page order
    matched.push(...all.filter((i) => fits(kinds[i].audience, want.garment).includes(kinds[i].garment as Garment)));
  }
  if (matched.length) return matched;
  const sameAudience = all.filter((i) => want.audiences.includes(kinds[i].audience as Audience));
  return sameAudience.length ? sameAudience : all;
}

/** A chart's cells turned sideways (the phone layout: sizes down the side, measures across); a short row is padded
 *  with empty cells so no column is lost. */
export function transpose(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => rows.map((r) => r[c] ?? ''));
}

const sizeKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Where the size chosen on the page sits in a chart's size row (`sizes[0]` is the row label, never a match); -1
 *  when the chart doesn't have exactly that size. */
export function sizeIndex(sizes: string[], chosen: string | null | undefined): number {
  const key = sizeKey(chosen ?? '');
  if (!key) return -1;
  return sizes.findIndex((s, at) => at > 0 && sizeKey(s) === key);
}

/** The link's data-sizeguide-want value. */
export function wantAttr(want: SizeWant): string {
  return `${want.audiences.join(',')}|${want.garment}`;
}

/** Reads data-sizeguide-want back; null when it isn't one. */
export function parseWant(value: string | undefined): SizeWant | null {
  const [who = '', garment = ''] = (value ?? '').split('|');
  if (!GARMENTS.includes(garment as SizeWant['garment'])) return null;
  const audiences = AUDIENCES.filter((a) => who.split(',').includes(a));
  return { audiences, garment: garment as SizeWant['garment'] };
}
