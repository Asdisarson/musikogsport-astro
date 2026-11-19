import { describe, expect, it } from 'vitest';
import { audienceGroups, chartFromRows, headingKind, isShoe, sectionLabel, sectionSlug, parseWant, pickSections, sizeChartFor, sizeIndex, transpose, wantAttr, type SizeWant } from './sizeGuide';

// The /staerdir/ WordPress page's headings, in page order (2026-10-30).
const HEADINGS = [
  'STRÁKAR / UNISEX / STÓRIR KRAKKAR / FATNAÐUR', // 0
  'STELPUR / FATNAÐUR', // 1
  'LITLIR KRAKKAR / FATNAÐUR', // 2
  'BÖRN / FATNAÐUR', // 3
  'LITLIR KRAKKAR / FÓTBOLTAFATNAÐUR', // 4
  'BÖRN / FÓTBOLTAFATNAÐUR', // 5
  'STÓRIR STRÁKAR / SUNDFATNAÐUR', // 6
  'LITLIR STRÁKAR / SUNDFATNAÐUR', // 7
  'STÓRAR STELPUR / SUNDFATNAÐUR', // 8
  'LITLAR STELPUR / SUNDFATNAÐUR', // 9
  'KARLAR / EFRI LÍKAMI', // 10
  'KARLAR / NEÐRI LÍKAMI', // 11
  'KARLAR / NÆRBUXUR', // 12
  'KARLAR / NÚMERAÐAR STÆRÐIR', // 13
  'KARLAR / SUNDFATNAÐUR', // 14
  'KONUR / EFRI LÍKAMI', // 15
  'KONUR / NEÐRI LÍKAMI', // 16
  'KONUR / SPORT BRAS', // 17
  'KONUR / NÚMERAÐAR STÆRÐIR', // 18
  'KONUR / SUNDFATNAÐUR', // 19
];

describe('headingKind: who and what a /staerdir/ chart is for', () => {
  it('reads the adult audiences and garments', () => {
    expect(headingKind('KARLAR / EFRI LÍKAMI')).toEqual({ audience: 'karlar', garment: 'efri' });
    expect(headingKind('KONUR / NEÐRI LÍKAMI')).toEqual({ audience: 'konur', garment: 'nedri' });
    expect(headingKind('KARLAR / NÚMERAÐAR STÆRÐIR')).toEqual({ audience: 'karlar', garment: 'nedri' });
    expect(headingKind('KARLAR / NÆRBUXUR')).toEqual({ audience: 'karlar', garment: 'naerfot' });
    expect(headingKind('KONUR / SPORT BRAS')).toEqual({ audience: 'konur', garment: 'toppar' });
    expect(headingKind('KONUR / SUNDFATNAÐUR')).toEqual({ audience: 'konur', garment: 'sund' });
  });

  it('reads every kids heading as born, whatever the age or gender words', () => {
    expect(headingKind('STRÁKAR / UNISEX / STÓRIR KRAKKAR / FATNAÐUR')).toEqual({ audience: 'born', garment: 'general' });
    expect(headingKind('LITLAR STELPUR / SUNDFATNAÐUR')).toEqual({ audience: 'born', garment: 'sund' });
    expect(headingKind('BÖRN / FÓTBOLTAFATNAÐUR')).toEqual({ audience: 'born', garment: 'lid' });
  });

  it('ignores case and stray spacing, and gives null parts for words it does not know', () => {
    expect(headingKind('  Konur /  Efri líkami ')).toEqual({ audience: 'konur', garment: 'efri' });
    expect(headingKind('SKÓR')).toEqual({ audience: null, garment: null });
  });
});

describe('sizeChartFor: what a product needs, from its category slug chains', () => {
  it('takes the audiences from Kyn and the garment from Fatnaður', () => {
    expect(sizeChartFor([['kyn', 'konur'], ['fatnadur', 'efri-likami', 'bolir-efri-likami']])).toEqual({ audiences: ['konur'], garment: 'efri' });
    expect(sizeChartFor([['kyn', 'karlar'], ['kyn', 'konur'], ['fatnadur', 'nedri-likami', 'buxur-leggings']])).toEqual({
      audiences: ['karlar', 'konur'],
      garment: 'nedri',
    });
  });

  it('maps each clothing branch', () => {
    const g = (chain: string[]) => sizeChartFor([chain])?.garment;
    expect(g(['fatnadur', 'sundfatnadur-fatnadur-2'])).toBe('sund');
    expect(g(['fatnadur', 'lidafatnadur-fatnadur-2'])).toBe('lid');
    expect(g(['fatnadur', 'nedri-likami', 'sokkar-naerfatnadur'])).toBe('naerfot');
    expect(g(['fatnadur', 'efri-likami', 'topp-ur'])).toBe('toppar');
    expect(g(['fatnadur', 'yfirhafnir'])).toBe('efri');
    expect(g(['fatnadur', 'hlaup'])).toBe('efri');
    expect(g(['fatnadur', 'vetur'])).toBe('efri');
    expect(g(['fatnadur'])).toBe('efri');
  });

  it('prefers the most specific branch when a product sits in several', () => {
    expect(sizeChartFor([['fatnadur', 'hlaup'], ['fatnadur', 'nedri-likami', 'buxur-leggings']])?.garment).toBe('nedri');
    expect(sizeChartFor([['fatnadur'], ['fatnadur', 'sundfatnadur-fatnadur-2']])?.garment).toBe('sund');
  });

  it('has no chart for shoes, hats and gloves, gear, or a product with no clothing category', () => {
    expect(sizeChartFor([['kyn', 'karlar'], ['skor', 'ithrottaskor', 'fotboltaskor-ithrottaskor']])).toBeNull();
    expect(sizeChartFor([['fatnadur', 'efri-likami', 'hufur-treflar']])).toBeNull();
    expect(sizeChartFor([['fatnadur', 'efri-likami', 'hanskar-vettlingar']])).toBeNull();
    expect(sizeChartFor([['aefingavorur', 'tosku']])).toBeNull();
    expect(sizeChartFor([])).toBeNull();
  });

  it('has no clothing chart for a shoe also filed under a clothing branch (running shoes sit in Fatnaður › Hlaup)', () => {
    expect(sizeChartFor([['fatnadur', 'hlaup'], ['skor', 'ithrottaskor', 'hlaupa-aefingarskor-ithrottaskor'], ['kyn', 'karlar']])).toBeNull();
  });
});

describe('pickSections: the charts the popup shows', () => {
  const pick = (audiences: string[], garment: string) => pickSections(HEADINGS, { audiences, garment } as never);

  it('shows the one matching chart', () => {
    expect(pick(['karlar'], 'sund')).toEqual([14]);
    expect(pick(['karlar'], 'naerfot')).toEqual([12]);
  });

  it("falls back to all of the audience's charts when none fits the garment", () => {
    expect(pick(['konur'], 'naerfot')).toEqual([15, 16, 17, 18, 19]); // no women's underwear chart
  });

  it('shows every chart of a garment for both audiences of a unisex product, men first', () => {
    expect(pick(['karlar', 'konur'], 'efri')).toEqual([10, 15]);
  });

  it('adds the numbered sizes to lower body, and sport bras to tops', () => {
    expect(pick(['konur'], 'nedri')).toEqual([16, 18]);
    expect(pick(['konur'], 'toppar')).toEqual([17, 15]);
  });

  it('gives kids the matching kids charts: team kit, swim, or the general clothing ones', () => {
    // the football charts stop at 7-8 years: the general kids charts follow for older kids
    expect(pick(['born'], 'lid')).toEqual([4, 5, 0, 1, 2, 3]);
    expect(pick(['born'], 'sund')).toEqual([6, 7, 8, 9]);
    expect(pick(['born'], 'efri')).toEqual([0, 1, 2, 3]);
  });

  it('gives adult team kit the upper and lower body charts', () => {
    expect(pick(['karlar'], 'lid')).toEqual([10, 11, 13]);
  });

  it('without a Kyn category, matches the garment across audiences', () => {
    expect(pick([], 'sund')).toEqual([6, 7, 8, 9, 14, 19]);
  });

  it('falls back to all of the audience, then to everything', () => {
    expect(pickSections(['KARLAR / BOLIR', 'KONUR / BOLIR', 'SKÓR'], { audiences: ['konur'], garment: 'efri' })).toEqual([1]);
    expect(pickSections(['SKÓR', 'ANNAÐ'], { audiences: ['konur'], garment: 'efri' })).toEqual([0, 1]);
  });
});

describe('hats and gloves anywhere in the tree', () => {
  it('have no chart wherever WordPress files them', () => {
    expect(sizeChartFor([['fatnadur', 'hufur-treflar']])).toBeNull();
    expect(sizeChartFor([['fatnadur', 'vetur', 'hanskar-vettlingar']])).toBeNull();
  });

  it('still leave a real clothing category its chart', () => {
    expect(sizeChartFor([['fatnadur', 'efri-likami', 'hufur-treflar'], ['fatnadur', 'efri-likami', 'peysur-efri-likami']])?.garment).toBe('efri');
  });
});

describe('transpose: the phone layout of a chart (sizes down the side)', () => {
  it('swaps rows and columns', () => {
    expect(
      transpose([
        ['Size', 'S', 'M'],
        ['Chest (cm)', '86 - 91', '97 - 101'],
      ]),
    ).toEqual([
      ['Size', 'Chest (cm)'],
      ['S', '86 - 91'],
      ['M', '97 - 101'],
    ]);
  });

  it('pads a short row with empty cells instead of dropping columns', () => {
    expect(
      transpose([
        ['Size', 'S', 'M'],
        ['Age', '3-4'],
      ]),
    ).toEqual([
      ['Size', 'Age'],
      ['S', '3-4'],
      ['M', ''],
    ]);
  });

  it('gives nothing for an empty table', () => {
    expect(transpose([])).toEqual([]);
  });
});

describe('sizeIndex: the chart column of the size chosen on the page', () => {
  const sizes = ['Size', 'XS', 'S', 'S Tall', 'M', '2XL'];
  it('finds the size however it is written', () => {
    expect(sizeIndex(sizes, 'M')).toBe(4);
    expect(sizeIndex(sizes, ' s tall ')).toBe(3);
    expect(sizeIndex(sizes, '2xl')).toBe(5);
  });

  it('never matches the label column, a partial size, or nothing', () => {
    expect(sizeIndex(sizes, 'Size')).toBe(-1);
    expect(sizeIndex(sizes, 'S/M')).toBe(-1);
    expect(sizeIndex(sizes, '')).toBe(-1);
    expect(sizeIndex(sizes, null)).toBe(-1);
  });
});

describe('wantAttr / parseWant: the link attribute round trip', () => {
  it('round-trips, and reads junk as null', () => {
    const want: SizeWant = { audiences: ['karlar', 'konur'], garment: 'efri' };
    expect(wantAttr(want)).toBe('karlar,konur|efri');
    expect(parseWant(wantAttr(want))).toEqual(want);
    expect(parseWant('|efri')).toEqual({ audiences: [], garment: 'efri' });
    expect(parseWant('karlar|nope')).toBeNull();
    expect(parseWant('hacker,karlar|efri')).toEqual({ audiences: ['karlar'], garment: 'efri' });
    expect(parseWant(undefined)).toBeNull();
  });
});

describe('isShoe', () => {
  it('is any product under Skór, even one also filed under clothing', () => {
    expect(isShoe([['skor']])).toBe(true);
    expect(isShoe([['fatnadur', 'hlaup'], ['skor', 'ithrottaskor', 'hlaupa-aefingarskor-ithrottaskor']])).toBe(true);
  });
  it('is not clothing, or a category that only starts with the same letters', () => {
    expect(isShoe([['fatnadur', 'efri-likami']])).toBe(false);
    expect(isShoe([['skorpa']])).toBe(false);
    expect(isShoe([])).toBe(false);
  });
});

describe('sectionLabel: a /staerdir/ heading as a tab label', () => {
  it('sentence-cases each part and joins them with a middle dot', () => {
    expect(sectionLabel('KONUR / EFRI LÍKAMI')).toBe('Konur · Efri líkami');
    expect(sectionLabel('STRÁKAR / UNISEX / STÓRIR KRAKKAR / FATNAÐUR')).toBe('Strákar · Unisex · Stórir krakkar · Fatnaður');
  });

  it('keeps Icelandic capitals and drops empty parts', () => {
    expect(sectionLabel(' ÞÓR /  / ÆFINGAFÖT ')).toBe('Þór · Æfingaföt');
  });
});

describe('chartFromRows: one WordPress table as a chart', () => {
  it('lifts a one-cell row over a wider table out as the caption', () => {
    expect(chartFromRows([['Alpha Sizing'], ['Size', 'S', 'M'], ['Chest', '90', '98']])).toEqual({
      caption: 'Alpha Sizing',
      rows: [['Size', 'S', 'M'], ['Chest', '90', '98']],
    });
  });

  it('joins several title rows and drops empty rows', () => {
    expect(chartFromRows([['A'], ['Size', 'S'], ['', ''], ['B'], ['Chest', '90']])).toEqual({
      caption: 'A · B',
      rows: [['Size', 'S'], ['Chest', '90']],
    });
  });

  it('keeps the rows of a one-column table', () => {
    expect(chartFromRows([['Size'], ['S']])).toEqual({ caption: '', rows: [['Size'], ['S']] });
  });
});

describe('sectionSlug: a /staerdir/ heading as the anchor of its chart on the page', () => {
  it('is ASCII, lower case and hyphenated', () => {
    expect(sectionSlug('KONUR / EFRI LÍKAMI')).toBe('konur-efri-likami');
    expect(sectionSlug('KARLAR / NÚMERAÐAR STÆRÐIR')).toBe('karlar-numeradar-staerdir');
    expect(sectionSlug('STRÁKAR / UNISEX / STÓRIR KRAKKAR / FATNAÐUR')).toBe('strakar-unisex-storir-krakkar-fatnadur');
  });

  it('drops anything that is not a letter or digit', () => {
    expect(sectionSlug('  Þór & Æfingaföt (3–4 ára) / ')).toBe('thor-aefingafot-3-4-ara');
    expect(sectionSlug(' / ')).toBe('');
  });
});

describe('audienceGroups: the /staerdir/ page\'s overview (Börn · Karlar · Konur)', () => {
  it('gathers the charts by who they are for, in page order', () => {
    expect(audienceGroups(HEADINGS)).toEqual([
      { id: 'born', label: 'Börn', indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { id: 'karlar', label: 'Karlar', indices: [10, 11, 12, 13, 14] },
      { id: 'konur', label: 'Konur', indices: [15, 16, 17, 18, 19] },
    ]);
  });

  it('keeps one group per audience when the page mixes them, and puts unknown charts last', () => {
    expect(audienceGroups(['KONUR / EFRI LÍKAMI', 'SKÓR', 'KARLAR / EFRI LÍKAMI', 'KONUR / SUNDFATNAÐUR'])).toEqual([
      { id: 'konur', label: 'Konur', indices: [0, 3] },
      { id: 'karlar', label: 'Karlar', indices: [2] },
      { id: 'annad', label: 'Annað', indices: [1] },
    ]);
  });

  it('is empty for no charts', () => {
    expect(audienceGroups([])).toEqual([]);
  });
});
