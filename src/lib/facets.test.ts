import { describe, expect, it } from 'vitest';
import { activeFilterList, colourSwatch, countWord, coversEnough, filterTitle, HIDDEN_SHOP_CATEGORY_SLUGS, isPlainColour, keepOption, matchCountFromStock, pickCounts, pickNote, pseudoCategoryIds, searchOnlyQuery, sizeBlocks, SIZE_GROUP_HEADINGS } from './facets';
import { colourTermIds, type CategoryTerm, type FilterKey, type TermRef } from './liveFilters';

describe('keepOption (the dead-end fix)', () => {
  it('hides a zero-count option when the counts came back (even when they came back empty)', () => {
    expect(keepOption({ active: false, count: undefined }, new Map())).toBe(false);
    expect(keepOption({ active: false, count: 0 }, new Map([[1, 0]]))).toBe(false);
  });

  it('keeps an option with products', () => {
    expect(keepOption({ active: false, count: 3 }, new Map([[1, 3]]))).toBe(true);
  });

  it('keeps an active option at zero so it stays removable', () => {
    expect(keepOption({ active: true, count: undefined }, new Map())).toBe(true);
  });

  it('shows every option (without counts) only when the count request failed', () => {
    expect(keepOption({ active: false, count: undefined }, null)).toBe(true);
  });
});

describe('matchCountFromStock', () => {
  const stock = new Map([['instock', 572], ['outofstock', 9], ['onbackorder', 0]]);
  it('sums every stock status when the query has no stock filter', () => {
    expect(matchCountFromStock(stock)).toBe(581);
  });
  it('counts only the filtered statuses when the query is limited to them', () => {
    expect(matchCountFromStock(stock, ['instock'])).toBe(572);
  });
  it('is undefined without counts', () => {
    expect(matchCountFromStock(null)).toBeUndefined();
  });
});

describe('pseudoCategoryIds (brand and club pseudo-categories hidden from Vöruflokkar)', () => {
  // The real tree's offenders and look-alikes (2026-10-26 data).
  const categories: CategoryTerm[] = [
    { id: 1814, slug: 'didriksons', name: 'Didriksons', parent: 0 },
    { id: 654, slug: 'fatnadur', name: 'Fatnaður', parent: 0 },
    { id: 687, slug: 'vetur', name: 'Didriksons', parent: 654 },
    { id: 2513, slug: 'hlaup', name: 'Hlaup', parent: 654 },
    { id: 2546, slug: 'stjarnan', name: 'Stjarnan', parent: 0 },
    { id: 2640, slug: 'felag-lid', name: 'Félag/lið', parent: 0 },
    { id: 9001, slug: 'felag-child', name: 'Eitthvað', parent: 2640 },
    { id: 675, slug: 'aefingarvorur', name: 'Æfingavörur', parent: 0 },
    { id: 686, slug: 'fh', name: 'FH', parent: 675 },
    { id: 684, slug: 'fimleikafelagid-bjork', name: 'Fimleikafélagið Björk', parent: 675 },
    { id: 2539, slug: 'fimleikar', name: 'Fimleikar', parent: 675 },
    { id: 685, slug: 'fotboltamyndir-og-fl', name: 'Fótboltamyndir og fl', parent: 675 },
    { id: 2626, slug: 'ithrott', name: 'Íþrótt', parent: 0 },
    { id: 2630, slug: 'fotbolti', name: 'Fótbolti', parent: 2626 },
    { id: 2635, slug: 'korfubolti', name: 'Körfubolti', parent: 2626 },
  ];
  const brands: TermRef[] = [{ id: 1, slug: 'didriksons', name: 'Didriksons' }, { id: 2, slug: 'nike', name: 'Nike' }];
  const teams: TermRef[] = [
    { id: 3, slug: 'stjarnan', name: 'Stjarnan' },
    { id: 4, slug: 'fh', name: 'FH' },
    { id: 5, slug: 'bjork', name: 'Björk' },
    { id: 6, slug: 'fotbolti', name: 'Fótbolti' },
    { id: 7, slug: 'korfubolti', name: 'Körfubolti' },
  ];
  const hidden = pseudoCategoryIds(categories, brands, teams);

  it('hides categories named after a brand, at any depth', () => {
    expect(hidden.has(1814)).toBe(true);
    expect(hidden.has(687)).toBe(true);
  });

  it('hides categories named after a club, or ending in a club name', () => {
    expect(hidden.has(2546)).toBe(true);
    expect(hidden.has(686)).toBe(true);
    expect(hidden.has(684)).toBe(true);
  });

  it('hides the Félag/lið clubs root and everything under it', () => {
    expect(hidden.has(2640)).toBe(true);
    expect(hidden.has(9001)).toBe(true);
  });

  it('keeps the sports under Íþrótt even where the club attribute has a stray sport term', () => {
    expect(hidden.has(2630)).toBe(false);
    expect(hidden.has(2635)).toBe(false);
  });

  it('keeps real product types', () => {
    for (const id of [654, 2513, 675, 2539, 685, 2626]) expect(hidden.has(id)).toBe(false);
  });
});

describe('pseudoCategoryIds: the club rule spares sports and real top-level categories (F-13)', () => {
  const categories: CategoryTerm[] = [
    { id: 675, slug: 'aefingarvorur', name: 'Æfingavörur', parent: 0 },
    { id: 10, slug: 'fotbolti-vorur', name: 'Fótbolti', parent: 675 }, // a real category named like a sport, outside Íþrótt
    { id: 11, slug: 'golf-vorur', name: 'Golf', parent: 675 },
    { id: 12, slug: 'islenskur-korfubolti', name: 'Íslenskur körfubolti', parent: 675 },
    { id: 13, slug: 'handbolti', name: 'Handbolti', parent: 0 }, // a top-level product root (it has sub-categories)
    { id: 14, slug: 'handbolti-skor', name: 'Handboltaskór', parent: 13 },
    { id: 2546, slug: 'stjarnan', name: 'Stjarnan', parent: 0 }, // top level but a leaf: still a club bucket
    { id: 686, slug: 'fh', name: 'FH', parent: 675 },
    { id: 684, slug: 'fimleikafelagid-bjork', name: 'Fimleikafélagið Björk', parent: 675 },
    { id: 1814, slug: 'didriksons', name: 'Didriksons', parent: 0 },
    { id: 2541, slug: 'sale', name: 'NETTILBOD', parent: 0 },
    { id: 2542, slug: 'sumar', name: 'Sumar', parent: 0 },
  ];
  const brands: TermRef[] = [{ id: 1, slug: 'didriksons', name: 'Didriksons' }];
  // pa_felag-lid holds stray sport terms (Fótbolti, Körfubolti, and here Golf) and a stray product-type term.
  const teams: TermRef[] = ['Stjarnan', 'FH', 'Björk', 'Fótbolti', 'Körfubolti', 'Golf', 'Handbolti'].map((name, i) => ({ id: 100 + i, slug: `t${i}`, name }));
  const sports: TermRef[] = ['Fótbolti', 'Körfubolti', 'Golf'].map((name, i) => ({ id: 200 + i, slug: `s${i}`, name }));
  const hidden = pseudoCategoryIds(categories, brands, teams, sports);

  it('does not treat a club term that is also a sport as a club, inside or outside Íþrótt', () => {
    expect(hidden.has(10)).toBe(false);
    expect(hidden.has(11)).toBe(false);
    expect(hidden.has(12)).toBe(false); // "… körfubolti" no longer matches by suffix either
  });

  it('never hides a top-level category that has sub-categories (a product root) by the club rule', () => {
    expect(hidden.has(13)).toBe(false);
    expect(hidden.has(14)).toBe(false);
  });

  it('still hides the real clubs (Stjarnan, FH, Fimleikafélagið Björk) and brands', () => {
    for (const id of [2546, 686, 684, 1814]) expect(hidden.has(id)).toBe(true);
  });

  it('hides NETTILBOD (slug sale, the Útsala toggle covers it) by an explicit slug list, but keeps Sumar', () => {
    expect([...HIDDEN_SHOP_CATEGORY_SLUGS]).toEqual(['sale']);
    expect(hidden.has(2541)).toBe(true);
    expect(hidden.has(2542)).toBe(false);
  });

  it('keeps the old behaviour without a sports list', () => {
    const old = pseudoCategoryIds(categories, brands, teams);
    expect(old.has(10)).toBe(true);
    expect(old.has(13)).toBe(false);
  });
});

describe('sizeBlocks', () => {
  const size = (slug: string, group: string, count: number, active = false) => ({ slug, name: slug, group, count, active });

  it('splits sizes into shoe, letter, kids, other blocks in that order with Icelandic headings', () => {
    const blocks = sizeBlocks([size('xs', 'letter', 2), size('42', 'shoe', 5), size('3', 'other', 1), size('110', 'kids', 1)]);
    expect(blocks.map((b) => b.group)).toEqual(['shoe', 'letter', 'kids', 'other']);
    expect(blocks.map((b) => b.heading)).toEqual(['Skóstærðir', 'Fatastærðir', 'Barnastærðir', 'Annað']);
    expect(SIZE_GROUP_HEADINGS.other).toBe('Annað');
  });

  it('keeps the input order inside a block', () => {
    const blocks = sizeBlocks([size('40', 'shoe', 1), size('41', 'shoe', 1), size('42', 'shoe', 1)]);
    expect(blocks[0].options.map((o) => o.slug)).toEqual(['40', '41', '42']);
  });

  it('shows every size when there are few, so nothing is minor', () => {
    const blocks = sizeBlocks(Array.from({ length: 28 }, (_, i) => size(String(20 + i), 'shoe', 1)), 24);
    expect(blocks[0].options.every((o) => !o.minor)).toBe(true);
  });

  it('marks all but the best-stocked sizes as minor, in place, and never a selected size', () => {
    const many = Array.from({ length: 40 }, (_, i) => size(String(17 + i), 'shoe', i >= 19 && i < 29 ? 100 : 1));
    many[0] = size('17', 'shoe', 0, true); // selected, no stock left in this context
    const [block] = sizeBlocks(many, 12);
    const shown = block.options.filter((o) => !o.minor).map((o) => o.slug);
    expect(shown).toEqual(['17', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '18']
      .sort((a, b) => Number(a) - Number(b)));
    expect(block.options.map((o) => o.slug)).toEqual(many.map((o) => o.slug));
  });

  it('marks a block minor when none of its sizes are shown', () => {
    const sizes = [...Array.from({ length: 30 }, (_, i) => size(String(17 + i), 'shoe', 10)), size('m', 'letter', 1)];
    const blocks = sizeBlocks(sizes, 24);
    expect(blocks.find((b) => b.group === 'letter')?.minor).toBe(true);
    expect(blocks.find((b) => b.group === 'shoe')?.minor).toBe(false);
  });
});

describe('coversEnough (near-empty Íþrótt / Félag/Lið / Litur groups are left out)', () => {
  const g = (counts: number[], active = false, showCounts = true) => ({
    showCounts,
    options: counts.map((count, i) => ({ count, active: active && i === 0 })),
  });

  it('keeps a group whose options together cover at least 10% of the products in view', () => {
    expect(coversEnough(g([20, 15, 10]), 400)).toBe(true); // 45 of 400
    expect(coversEnough(g([40]), 400)).toBe(true); // exactly 10%
  });

  it('leaves out a group covering less, even if many options exist', () => {
    expect(coversEnough(g([3]), 400)).toBe(false);
    expect(coversEnough(g([5, 5, 5, 5, 5, 5, 5]), 400)).toBe(false); // 35 of 400
  });

  it('caps the sum at the total (a product with two values counts twice)', () => {
    expect(coversEnough(g([9, 9]), 10)).toBe(true);
  });

  it('keeps a group with an active option, so the selection stays removable', () => {
    expect(coversEnough(g([1], true), 400)).toBe(true);
  });

  it('keeps the group when unsure: no counts, or no total', () => {
    expect(coversEnough(g([1], false, false), 400)).toBe(true);
    expect(coversEnough(g([1]), undefined)).toBe(true);
    expect(coversEnough(g([1]), 0)).toBe(true);
  });
});

describe('isPlainColour', () => {
  it('keeps one-colour terms', () => {
    expect(isPlainColour({ slug: 'svartur', name: 'Svartur' })).toBe(true);
    expect(isPlainColour({ slug: 'dusty-pink', name: 'Ljósbleikur' })).toBe(true);
  });
  it('drops a colour merged into another (Mahagony Red is Rauður)', () => {
    expect(isPlainColour({ slug: 'mahagony-red', name: 'Mahagony Red' })).toBe(false);
  });
  it('drops two-colour terms and ISLAND', () => {
    expect(isPlainColour({ slug: 'blar-hvitur', name: 'Blár/hvítur' })).toBe(false);
    expect(isPlainColour({ slug: 'hvitt-svart', name: 'Hvítt/svart' })).toBe(false);
    expect(isPlainColour({ slug: 'island', name: 'ISLAND' })).toBe(false);
  });
});

describe('colourTermIds', () => {
  const colours = [
    { id: 1, slug: 'raudur', name: 'Rauður' },
    { id: 2, slug: 'mahagony-red', name: 'Mahagony Red' },
    { id: 3, slug: 'blar', name: 'Blár' },
  ];
  it('adds the terms merged into a chosen colour', () => {
    expect(colourTermIds(['raudur'], [1], colours)).toEqual([1, 2]);
    expect(colourTermIds(['blar', 'raudur'], [3, 1], colours)).toEqual([3, 1, 2]);
  });
  it('leaves other colours alone and adds nothing missing from the term list', () => {
    expect(colourTermIds(['blar'], [3], colours)).toEqual([3]);
    expect(colourTermIds(['raudur'], [1], [colours[0]])).toEqual([1]);
  });
  it('never repeats an id', () => {
    expect(colourTermIds(['raudur', 'mahagony-red'], [1, 2], colours)).toEqual([1, 2]);
  });
});

describe('colourSwatch', () => {
  it('gives one colour for a known colour term', () => {
    expect(colourSwatch('svartur')).toEqual(['#1b1b1b']);
    expect(colourSwatch('dokkblatt')).toEqual(['#1e2a52']);
  });

  it('splits a two-colour term (BLÁR/HVÍTUR = blar-hvitur, HVÍTT/SVART = hvitt-svart)', () => {
    expect(colourSwatch('blar-hvitur')).toEqual(['#2f6fed', '#f4f4f4']);
    expect(colourSwatch('hvitt-svart')).toEqual(['#f4f4f4', '#1b1b1b']);
  });

  it('has no swatch for a pattern or an unknown term', () => {
    expect(colourSwatch('mynstrad')).toBeUndefined();
    expect(colourSwatch('graenn-glimmer')).toBeUndefined();
    expect(colourSwatch('a-b-c')).toBeUndefined();
  });
});

describe('countWord', () => {
  it('uses the Icelandic singular after numbers ending in 1 (but not 11)', () => {
    expect(countWord(1)).toBe('1 vara');
    expect(countWord(21)).toBe('21 vara');
    expect(countWord(11)).toBe('11 vörur');
    expect(countWord(125)).toBe('125 vörur');
    expect(countWord(0)).toBe('0 vörur');
  });
});

describe('filterTitle', () => {
  it('appends the active filter labels after an en dash', () => {
    expect(filterTitle('Skór', ['Nike', '42'])).toBe('Skór – Nike, 42');
  });
  it('leaves the title alone without filters', () => {
    expect(filterTitle('Skór', [])).toBe('Skór');
  });
  it('names at most four filters, then "+N" (F-18)', () => {
    expect(filterTitle('Skór', ['Nike', 'Konur', '42', 'Útsala'])).toBe('Skór – Nike, Konur, 42, Útsala');
    expect(filterTitle('Skór', ['Nike', 'Adidas', 'Konur', '42', '43', 'Útsala'])).toBe('Skór – Nike, Adidas, Konur, 42 +2');
  });
});

describe('activeFilterList (chips, title labels)', () => {
  interface Src { slug: string; name: string; active: boolean; key?: FilterKey; children: Src[] }
  const o = (slug: string, name: string, active: boolean, extra: Partial<Pick<Src, 'key' | 'children'>> = {}): Src => ({
    slug, name, active, children: [], ...extra,
  });
  const groups = [
    { key: 'utsala' as FilterKey, options: [o('1', 'Útsala', true, { key: 'utsala' }), o('1', 'Aðeins vörur á lager', true, { key: 'lager' })] },
    { key: 'staerd' as FilterKey, options: [o('42', '42', true), o('43', '43', false)] },
    { key: 'kyn' as FilterKey, options: [o('konur', 'Konur', true)] },
    { key: 'brand' as FilterKey, options: [o('nike', 'Nike', true), o('adidas', 'Adidas', false)] },
    {
      key: 'product-category' as FilterKey,
      options: [o('fatnadur', 'Fatnaður', false, { children: [o('buxur', 'Buxur', true)] })],
    },
  ];
  it('lists every active value in title order, with its URL key, slug and label (lager as "Á lager")', () => {
    expect(activeFilterList(groups)).toEqual([
      { key: 'brand', slug: 'nike', label: 'Nike' },
      { key: 'kyn', slug: 'konur', label: 'Konur' },
      { key: 'product-category', slug: 'buxur', label: 'Buxur' },
      { key: 'staerd', slug: '42', label: '42' },
      { key: 'utsala', slug: '1', label: 'Útsala' },
      { key: 'lager', slug: '1', label: 'Á lager' },
    ]);
  });
  it('is empty without a selection', () => {
    expect(activeFilterList([{ key: 'brand', options: [o('nike', 'Nike', false)] }])).toEqual([]);
  });
});

describe('pickNote: no pick the caps refuse is offered (review 33)', () => {
  const counts = (perKey: Partial<Record<FilterKey, number>>) => pickCounts(
    Object.fromEntries(Object.entries(perKey).map(([k, n]) => [k, Array.from({ length: n ?? 0 }, (_, i) => `v${i}`)])) as Partial<Record<FilterKey, string[]>>,
  );

  it('counts the six comma lists per key and in all, and nothing else', () => {
    const c = counts({ brand: 2, kyn: 1 });
    expect(c.perKey.get('brand')).toBe(2);
    expect(c.perKey.get('litur')).toBe(0);
    expect(c.total).toBe(3);
    expect(pickCounts({ staerd: ['42', '43'], utsala: ['1'] } as Partial<Record<FilterKey, string[]>>).total).toBe(0);
  });

  it('is undefined while a filter has room and the total is under 12', () => {
    expect(pickNote('brand', counts({ brand: 5, kyn: 6 }))).toBeUndefined();
    expect(pickNote('brand', counts({ brand: 5 }))).toBeUndefined();
  });

  it('gives the per-filter reason once the filter holds 6, for that filter only', () => {
    const c = counts({ brand: 6 });
    expect(pickNote('brand', c)).toMatch(/^Mest er hægt að velja 6 í þessum flokki/);
    expect(pickNote('litur', c)).toBeUndefined();
  });

  it('gives the total reason once 12 are picked in all, for every capped filter', () => {
    const c = counts({ brand: 5, kyn: 4, litur: 3 });
    expect(c.total).toBe(12);
    for (const key of ['brand', 'kyn', 'litur', 'team', 'product-category', 'ithrott'] as FilterKey[]) {
      expect(pickNote(key, c)).toMatch(/^Mest er hægt að velja 12 síur í einu/);
    }
  });

  it('never blocks the size, price and flag filters', () => {
    const c = counts({ brand: 6, kyn: 6 });
    expect(pickNote('staerd', c)).toBeUndefined();
    expect(pickNote('verd', c)).toBeUndefined();
    expect(pickNote('utsala', c)).toBeUndefined();
  });
});

describe('searchOnlyQuery: a redirect for an over-picked URL keeps the search text', () => {
  it('is the search text alone, encoded', () => {
    expect(searchOnlyQuery('hlaupa skór')).toBe('s=hlaupa+sk%C3%B3r');
  });
  it('is empty without a search', () => {
    expect(searchOnlyQuery(null)).toBe('');
  });
});
