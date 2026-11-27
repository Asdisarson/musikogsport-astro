import { describe, expect, it } from 'vitest';
import { cardCategories, categoryChain, categoryHref, resolveCategoryPath, childrenOf, productCrumbTrail, railCategoryLinks, relatedScope } from './categoryTree';
import type { CategoryTerm } from './liveFilters';

const cats: CategoryTerm[] = [
  { id: 653, slug: 'skor', parent: 0, name: 'Skór' },
  { id: 700, slug: 'ithrottaskor', parent: 653, name: 'Íþróttaskór' },
  { id: 701, slug: 'fotboltaskor-ithrottaskor', parent: 700, name: 'Fótboltaskór' },
  { id: 718, slug: 'sale', parent: 0, name: 'NET-LAGERSALA' },
  { id: 9, slug: 'loop', parent: 9, name: 'Self-parented' },
];

describe('categoryChain', () => {
  it('returns slugs root-first', () => {
    expect(categoryChain(cats, 701)).toEqual(['skor', 'ithrottaskor', 'fotboltaskor-ithrottaskor']);
  });

  it('returns a single slug for a top-level category', () => {
    expect(categoryChain(cats, 718)).toEqual(['sale']);
  });

  it('does not loop forever on a corrupt parent pointer', () => {
    expect(categoryChain(cats, 9)).toEqual(['loop']);
  });

  it('returns [] for an unknown id', () => {
    expect(categoryChain(cats, 123)).toEqual([]);
  });
});

describe('cardCategories', () => {
  const tree: CategoryTerm[] = [
    ...cats,
    { id: 800, slug: 'hlaup', parent: 0, name: 'Hlaup' },
    { id: 801, slug: 'hlaup-skor', parent: 653, name: 'Hlaup' },
    { id: 802, slug: 'konur', parent: 0, name: 'Konur' },
  ];

  it('lists each name once, keeping the deepest category of that name', () => {
    expect(cardCategories([{ id: 800, name: 'Hlaup' }, { id: 801, name: 'Hlaup' }], tree, 2)).toEqual([
      { name: 'Hlaup', path: '/voruflokkur/skor/hlaup-skor/' },
    ]);
  });

  it('puts the most specific categories first, drops the ancestors of listed ones, and caps the list', () => {
    // Skór and Íþróttaskór are Fótboltaskór's own parents: listing them would repeat the path, not add information
    const product = [{ id: 653, name: 'Skór' }, { id: 701, name: 'Fótboltaskór' }, { id: 700, name: 'Íþróttaskór' }, { id: 802, name: 'Konur' }];
    expect(cardCategories(product, tree, 2).map((c) => c.name)).toEqual(['Fótboltaskór', 'Konur']);
  });

  it('orders categories of the same depth alphabetically, Icelandic style, with the sale bucket last', () => {
    expect(cardCategories([{ id: 802, name: 'Konur' }, { id: 718, name: 'NET-LAGERSALA' }, { id: 653, name: 'Skór' }], tree, 3).map((c) => c.name)).toEqual([
      'Konur',
      'Skór',
      'NET-LAGERSALA',
    ]);
  });

  it('drops categories that are not in the tree', () => {
    expect(cardCategories([{ id: 123, name: 'Horfið' }], tree, 2)).toEqual([]);
  });

  // Live's gender facets live under the structural "kyn" root (hidden in the archive filters too).
  const withFacets: CategoryTerm[] = [
    ...tree,
    { id: 900, slug: 'kyn', parent: 0, name: 'Kyn' },
    { id: 901, slug: 'karlar', parent: 900, name: 'Karlar' },
    { id: 902, slug: 'konur-kyn', parent: 900, name: 'Konur' },
    { id: 903, slug: 'born', parent: 900, name: 'Börn' },
    { id: 904, slug: 'unisex', parent: 0, name: 'Unisex' },
    { id: 910, slug: 'sund', parent: 0, name: 'Sund' },
    { id: 920, slug: 'stjarnan', parent: 0, name: 'Stjarnan' },
    { id: 921, slug: 'sumar', parent: 0, name: 'Sumar' },
    { id: 820, slug: 'fatnadur', parent: 0, name: 'Fatnaður' },
    { id: 821, slug: 'hlaup', parent: 820, name: 'Hlaup' },
  ];

  it('ranks gender facets after real categories, so the product type stays on the card', () => {
    const product = [{ id: 901, name: 'Karlar' }, { id: 902, name: 'Konur' }, { id: 910, name: 'Sund' }];
    expect(cardCategories(product, withFacets, 2).map((c) => c.name)).toEqual(['Sund', 'Karlar']);
  });

  it('still lists the facets when the product has nothing else', () => {
    expect(cardCategories([{ id: 902, name: 'Konur' }, { id: 901, name: 'Karlar' }], withFacets, 2).map((c) => c.name)).toEqual(['Karlar', 'Konur']);
  });

  it('breaks a same-name, same-depth tie by the lower id, whatever the API order', () => {
    const both = [{ id: 821, name: 'Hlaup' }, { id: 801, name: 'Hlaup' }];
    for (const order of [both, [...both].reverse()]) {
      expect(cardCategories(order, withFacets, 2)).toEqual([{ name: 'Hlaup', path: '/voruflokkur/skor/hlaup-skor/' }]);
    }
  });

  it('ranks the sale bucket below the structural facets, so it never takes a gender facet’s slot (the badge already says sale)', () => {
    const product = [{ id: 718, name: 'NET-LAGERSALA' }, { id: 901, name: 'Karlar' }, { id: 910, name: 'Sund' }];
    expect(cardCategories(product, withFacets, 2).map((c) => c.name)).toEqual(['Sund', 'Karlar']);
  });

  it('ranks the sale bucket below a top-level unisex facet of the same depth', () => {
    const product = [{ id: 718, name: 'NET-LAGERSALA' }, { id: 904, name: 'Unisex' }, { id: 910, name: 'Sund' }];
    expect(cardCategories(product, withFacets, 2).map((c) => c.name)).toEqual(['Sund', 'Unisex']);
  });

  it('ranks the Stjarnan club shop as a real category, ahead of the gender facets', () => {
    const product = [{ id: 920, name: 'Stjarnan' }, { id: 903, name: 'Börn' }, { id: 901, name: 'Karlar' }];
    expect(cardCategories(product, withFacets, 2).map((c) => c.name)).toEqual(['Stjarnan', 'Börn']);
  });

  it('ranks the Sumar category as a real category, ahead of the gender facets', () => {
    const product = [{ id: 921, name: 'Sumar' }, { id: 901, name: 'Karlar' }, { id: 902, name: 'Konur' }];
    expect(cardCategories(product, withFacets, 2).map((c) => c.name)).toContain('Sumar');
  });

  it('breaks a same-name, same-depth tie by the root branch the product’s other categories share', () => {
    const product = [{ id: 820, name: 'Fatnaður' }, { id: 821, name: 'Hlaup' }, { id: 801, name: 'Hlaup' }];
    for (const order of [product, [...product].reverse()]) {
      expect(cardCategories(order, withFacets, 2)).toEqual([{ name: 'Hlaup', path: '/voruflokkur/fatnadur/hlaup/' }]);
    }
  });

  it('lets a real category beat a structural facet of the same name', () => {
    const product = [{ id: 902, name: 'Konur' }, { id: 802, name: 'Konur' }, { id: 910, name: 'Sund' }, { id: 653, name: 'Skór' }];
    for (const order of [product, [...product].reverse()]) {
      expect(cardCategories(order, withFacets, 3).find((c) => c.name === 'Konur')?.path).toBe('/voruflokkur/konur/');
    }
  });
});

describe('resolveCategoryPath', () => {
  it('resolves a canonical nested path', () => {
    const r = resolveCategoryPath(cats, ['skor', 'ithrottaskor', 'fotboltaskor-ithrottaskor']);
    expect(r).toMatchObject({ canonical: true, path: '/voruflokkur/skor/ithrottaskor/fotboltaskor-ithrottaskor/' });
    expect(r?.term.id).toBe(701);
  });

  it('flags a wrong or shortened chain as non-canonical and gives the canonical path', () => {
    const r = resolveCategoryPath(cats, ['fotboltaskor-ithrottaskor']);
    expect(r).toMatchObject({ canonical: false, path: '/voruflokkur/skor/ithrottaskor/fotboltaskor-ithrottaskor/' });
  });

  it('returns null when the last slug is not a category', () => {
    expect(resolveCategoryPath(cats, ['skor', 'nope'])).toBeNull();
    expect(resolveCategoryPath(cats, [])).toBeNull();
  });

  it('builds the breadcrumb trail of names', () => {
    expect(resolveCategoryPath(cats, ['skor', 'ithrottaskor'])?.trail).toEqual([
      { name: 'Skór', path: '/voruflokkur/skor/' },
      { name: 'Íþróttaskór', path: '/voruflokkur/skor/ithrottaskor/' },
    ]);
  });
});

describe('childrenOf', () => {
  it('lists direct children', () => {
    expect(childrenOf(cats, 653).map((c) => c.slug)).toEqual(['ithrottaskor']);
  });
});

describe('productCrumbTrail', () => {
  const withGender: CategoryTerm[] = [
    ...cats,
    { id: 2616, slug: 'kyn', parent: 0, name: 'Kyn' },
    { id: 2617, slug: 'karlar', parent: 2616, name: 'Karlar' },
    { id: 2618, slug: 'konur', parent: 2616, name: 'Konur' },
  ];

  it("follows WooCommerce's main term (highest parent id), not the URL's category — live: Heim / Verslun / Kyn / Karlar", () => {
    expect(productCrumbTrail(withGender, [701, 2618, 2617])).toEqual([
      { name: 'Kyn', path: '/voruflokkur/kyn/' },
      { name: 'Karlar', path: '/voruflokkur/kyn/karlar/' },
    ]);
  });

  it('picks the deepest-parented term among top-level and nested categories', () => {
    expect(productCrumbTrail(withGender, [718, 701]).map((t) => t.name)).toEqual(['Skór', 'Íþróttaskór', 'Fótboltaskór']);
  });

  it('is empty when the product has no known category', () => {
    expect(productCrumbTrail(withGender, [])).toEqual([]);
    expect(productCrumbTrail(withGender, [123456])).toEqual([]);
  });
});

describe('railCategoryLinks', () => {
  const tree: CategoryTerm[] = [
    ...cats,
    { id: 702, slug: 'hlaupaskor', parent: 653, name: 'Hlaupaskór' },
    { id: 703, slug: 'tomur', parent: 653, name: 'Tómur' },
    { id: 2616, slug: 'kyn', parent: 0, name: 'Kyn' },
    { id: 2617, slug: 'karlar', parent: 2616, name: 'Karlar' },
    { id: 15, slug: 'uncategorized', parent: 0, name: 'Óflokkað' },
    { id: 800, slug: 'fatnadur', parent: 0, name: 'Fatnaður' },
  ];
  // Íþróttaskór has no products of its own, but Fótboltaskór below it does.
  const counts = new Map([
    [653, 40], [700, 0], [701, 12], [702, 9], [703, 0], [718, 5], [2616, 30], [2617, 30], [15, 3], [800, 0], [9, 0],
  ]);

  it('lists the top-level categories with products on the shop, structural roots hidden', () => {
    expect(railCategoryLinks(tree, counts)).toEqual([
      { name: 'Skór', path: '/voruflokkur/skor/' },
      { name: 'NET-LAGERSALA', path: '/voruflokkur/sale/' },
    ]);
  });

  it("lists a category's children by their canonical paths, keeping one whose products sit deeper", () => {
    expect(railCategoryLinks(tree, counts, 653)).toEqual([
      { name: 'Íþróttaskór', path: '/voruflokkur/skor/ithrottaskor/' },
      { name: 'Hlaupaskór', path: '/voruflokkur/skor/hlaupaskor/' },
    ]);
  });

  it('is empty for a leaf category or an unknown id', () => {
    expect(railCategoryLinks(tree, counts, 701)).toEqual([]);
    expect(railCategoryLinks(tree, counts, 123456)).toEqual([]);
  });

  it('shows the children of a structural root when that root is the scope', () => {
    expect(railCategoryLinks(tree, counts, 2616)).toEqual([{ name: 'Karlar', path: '/voruflokkur/kyn/karlar/' }]);
  });

  it('survives a self-parented category', () => {
    expect(railCategoryLinks(tree, counts, 9)).toEqual([]);
  });

  it('leaves out hidden (pseudo) categories when given them', () => {
    expect(railCategoryLinks(tree, counts, 0, new Set([653]))).toEqual([{ name: 'NET-LAGERSALA', path: '/voruflokkur/sale/' }]);
    expect(railCategoryLinks(tree, counts, 653, new Set([702]))).toEqual([{ name: 'Íþróttaskór', path: '/voruflokkur/skor/ithrottaskor/' }]);
    expect(railCategoryLinks(tree, counts, 0, new Set())).toEqual(railCategoryLinks(tree, counts));
  });
});

describe('relatedScope', () => {
  const tree: CategoryTerm[] = [
    ...cats,
    { id: 800, slug: 'kyn', parent: 0, name: 'Kyn' },
    { id: 801, slug: 'karlar', parent: 800, name: 'Karlar' },
    { id: 802, slug: 'konur', parent: 800, name: 'Konur' },
    { id: 900, slug: 'fatnadur', parent: 0, name: 'Fatnaður' },
    { id: 901, slug: 'hlaup', parent: 900, name: 'Hlaup' },
    { id: 950, slug: 'uncategorized', parent: 0, name: 'Óflokkað' },
  ];

  it('picks the deepest product-type category and the Kyn audiences', () => {
    expect(relatedScope([801, 718, 901, 701, 653], tree)).toEqual({ categoryId: 701, audienceIds: [801] });
  });
  it('never scopes to Kyn, an unsorted bucket or the sale bucket', () => {
    expect(relatedScope([801, 802, 950, 718], tree)).toEqual({ categoryId: undefined, audienceIds: [801, 802] });
  });
  it('breaks a depth tie by the lower id, and skips categories missing from the tree', () => {
    expect(relatedScope([901, 700, 12345], tree)).toEqual({ categoryId: 700, audienceIds: [] });
  });
});

describe('categoryHref', () => {
  const terms = [
    { id: 1, name: 'Skór', slug: 'skor', parent: 0 },
    { id: 2, name: 'Hlaupaskór', slug: 'hlaupaskor', parent: 1 },
  ] as CategoryTerm[];

  it('is the /voruflokkur/ path of a known category', () => {
    expect(categoryHref(terms, 2)).toBe('/voruflokkur/skor/hlaupaskor/');
  });

  it('is null for a category the term list does not have (degraded terms), never /voruflokkur//', () => {
    expect(categoryHref([], 2)).toBeNull();
    expect(categoryHref(terms, 99)).toBeNull();
  });
});
