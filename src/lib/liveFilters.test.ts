import { describe, expect, it } from 'vitest';
import { MAX_LIST_PARAM, MAX_SEARCH_LENGTH, MAX_SIZE_PARAM, PRICE_PRESETS, clearFilterHref, clearFiltersHref, parseLiveFilters, presetBounds, pricePreset, sizeIndexDecision, toStoreFilter, toggleFilterHref, type CatalogTerms } from './liveFilters';

const terms: CatalogTerms = {
  categories: [
    { id: 654, slug: 'fatnadur', parent: 0, name: 'Fatnaður' },
    { id: 673, slug: 'buxur-leggings', parent: 654, name: 'Buxur & leggings' },
    { id: 653, slug: 'skor', parent: 0, name: 'Skór' },
    { id: 2644, slug: 'kyn', parent: 0, name: 'Kyn' },
    { id: 2617, slug: 'karlar', parent: 2644, name: 'Karlar' },
    { id: 2618, slug: 'konur', parent: 2644, name: 'Konur' },
    { id: 2620, slug: 'born', parent: 2644, name: 'Börn' },
  ],
  brands: [
    { id: 11, slug: 'casall', name: 'Casall' },
    { id: 12, slug: 'move-active', name: 'Move Active' },
  ],
  teams: [{ id: 700, slug: 'liverpool', name: 'Liverpool' }],
  sports: [
    { id: 627, slug: 'sund', name: 'Sund' },
    { id: 629, slug: 'fotbolti', name: 'Fótbolti' },
  ],
  colours: [
    { id: 364, slug: 'svartur', name: 'Svartur' },
    { id: 363, slug: 'blar', name: 'Blár' },
  ],
  sizes: [
    { slug: '42', label: '42', group: 'shoe', sort: 42 },
    { slug: '42-5', label: '42,5', group: 'shoe', sort: 42.5 },
    { slug: 'm', label: 'M', group: 'letter', sort: 6 },
  ],
};

const parse = (qs: string) => parseLiveFilters(new URLSearchParams(qs));

describe('parseLiveFilters', () => {
  it('reads live query params as csv lists', () => {
    const s = parse('kyn=konur&brand=casall,move-active&team=liverpool&product-category=buxur-leggings&orderby=price&s=nike');
    expect(s).toEqual({
      kyn: ['konur'],
      brand: ['casall', 'move-active'],
      team: ['liverpool'],
      productCategory: ['buxur-leggings'],
      staerd: [],
      ithrott: [],
      litur: [],
      verd: null,
      utsala: false,
      lager: false,
      orderby: 'price',
      search: 'nike',
    });
  });

  it('defaults to date ordering and no filters', () => {
    expect(parse('')).toEqual({
      kyn: [], brand: [], team: [], productCategory: [], staerd: [], ithrott: [], litur: [], verd: null, utsala: false, lager: false,
      orderby: 'date', search: null,
    });
  });

  it('ignores unknown orderby values', () => {
    expect(parse('orderby=title').orderby).toBe('date');
    // names every object inherits are not orderings either
    for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) expect(parse(`orderby=${key}`).orderby, key).toBe('date');
  });
});

describe('toStoreFilter', () => {
  it('puts kyn in the extra AND clause and keeps the archive category as the main clause', () => {
    const { filter } = toStoreFilter(parse('kyn=konur'), terms, 654);
    expect(filter.categoryIds).toEqual([654]);
    expect(filter.andCategoryIds).toEqual([2618]);
  });

  it('lets product-category replace the archive category (it is narrower)', () => {
    const { filter } = toStoreFilter(parse('kyn=konur&product-category=buxur-leggings'), terms, 654);
    expect(filter.categoryIds).toEqual([673]);
    expect(filter.andCategoryIds).toEqual([2618]);
  });

  it('only accepts children of Kyn as kyn values', () => {
    const { filter } = toStoreFilter(parse('kyn=fatnadur,born'), terms);
    expect(filter.andCategoryIds).toEqual([2620]);
  });

  it('maps brand slugs to ids and team to the pa_felag-lid attribute', () => {
    const { filter } = toStoreFilter(parse('brand=casall,nope&team=liverpool'), terms);
    expect(filter.brandIds).toEqual([11]);
    expect(filter.attributes).toEqual([{ taxonomy: 'pa_felag-lid', termIds: [700] }]);
  });

  it('maps live orderby values to Store API orderby/order', () => {
    expect(toStoreFilter(parse(''), terms).filter).toMatchObject({ orderby: 'date', order: 'desc' });
    expect(toStoreFilter(parse('orderby=price'), terms).filter).toMatchObject({ orderby: 'price', order: 'asc' });
    expect(toStoreFilter(parse('orderby=price-desc'), terms).filter).toMatchObject({ orderby: 'price', order: 'desc' });
    expect(toStoreFilter(parse('orderby=popularity'), terms).filter).toMatchObject({ orderby: 'popularity', order: 'desc' });
    expect(toStoreFilter(parse('orderby=rating'), terms).filter).toMatchObject({ orderby: 'rating', order: 'desc' });
    expect(toStoreFilter(parse('orderby=menu_order'), terms).filter).toMatchObject({ orderby: 'menu_order', order: 'asc' });
  });

  it('reports only resolved slugs as active, with a total count', () => {
    const { active, activeCount } = toStoreFilter(parse('kyn=konur,xx&brand=casall'), terms);
    expect(active).toEqual({ kyn: ['konur'], brand: ['casall'] });
    expect(activeCount).toBe(2);
  });

  it('passes the search term through', () => {
    expect(toStoreFilter(parse('s=nike+air'), terms).filter.search).toBe('nike air');
  });
});

describe('toggleFilterHref / clearFiltersHref', () => {
  const params = new URLSearchParams('kyn=konur&orderby=price');

  it('adds a value to a facet and drops pagination by returning the base path', () => {
    expect(toggleFilterHref('/voruflokkur/skor/', params, 'brand', 'casall')).toBe('/voruflokkur/skor/?kyn=konur&orderby=price&brand=casall');
  });

  it('removes a value that is already active', () => {
    expect(toggleFilterHref('/verslun/', params, 'kyn', 'konur')).toBe('/verslun/?orderby=price');
  });

  it('clears every facet but keeps the sort order', () => {
    const p = new URLSearchParams('kyn=konur&brand=casall&team=liverpool&product-category=skor&orderby=price');
    expect(clearFiltersHref('/verslun/', p)).toBe('/verslun/?orderby=price');
  });
});

describe('parseLiveFilters: size, price, sale, stock and sport keys', () => {
  it('reads staerd and ithrott as csv lists, lower-cased, dropping slugs with stray characters', () => {
    const s = parse('staerd=42,42-5,M,<x>,42&ithrott=sund');
    expect(s.staerd).toEqual(['42', '42-5', 'm']);
    expect(s.ithrott).toEqual(['sund']);
  });

  it('accepts only the four price presets', () => {
    expect(parse('verd=5000-10000').verd).toBe('5000-10000');
    expect(parse('verd=20000-').verd).toBe('20000-');
    expect(parse('verd=1-2').verd).toBeNull();
    expect(parse('verd=0-5000,20000-').verd).toBeNull();
  });

  it('reads utsala and lager as flags that must be exactly 1', () => {
    expect(parse('utsala=1&lager=1')).toMatchObject({ utsala: true, lager: true });
    expect(parse('utsala=0&lager=yes')).toMatchObject({ utsala: false, lager: false });
  });
});

describe('PRICE_PRESETS', () => {
  it('cover whole krónur without overlapping at the boundaries', () => {
    expect(PRICE_PRESETS.map((p) => [p.key, p.min, p.max])).toEqual([
      ['0-5000', undefined, 4999],
      ['5000-10000', 5000, 9999],
      ['10000-20000', 10000, 19999],
      ['20000-', 20000, undefined],
    ]);
    expect(PRICE_PRESETS.map((p) => p.label)).toEqual(['Undir 5.000 kr.', '5.000–10.000 kr.', '10.000–20.000 kr.', 'Yfir 20.000 kr.']);
  });
});

describe('toStoreFilter: size, price, sale, stock and sport', () => {
  it('maps sizes to mos_size slugs, also ones the cached size list does not have yet (a size added since)', () => {
    const { filter, active } = toStoreFilter(parse('staerd=42,99,m'), terms);
    expect(filter.sizeSlugs).toEqual(['42', '99', 'm']);
    expect(active.staerd).toEqual(['42', '99', 'm']);
  });

  it('ignores staerd entirely when the size index is not available', () => {
    const { filter, active } = toStoreFilter(parse('staerd=42'), { ...terms, sizes: undefined });
    expect(filter.sizeSlugs).toBeUndefined();
    expect(active.staerd).toBeUndefined();
  });

  it('maps a price preset to min/max price', () => {
    expect(toStoreFilter(parse('verd=0-5000'), terms).filter).toMatchObject({ maxPrice: 4999 });
    expect(toStoreFilter(parse('verd=0-5000'), terms).filter.minPrice).toBeUndefined();
    expect(toStoreFilter(parse('verd=10000-20000'), terms).filter).toMatchObject({ minPrice: 10000, maxPrice: 19999 });
    expect(toStoreFilter(parse('verd=20000-'), terms).filter).toMatchObject({ minPrice: 20000 });
    expect(toStoreFilter(parse('verd=20000-'), terms).active.verd).toEqual(['20000-']);
  });

  it('maps utsala to on_sale and lager to in-stock only', () => {
    const { filter, active, activeCount } = toStoreFilter(parse('utsala=1&lager=1'), terms);
    expect(filter.onSale).toBe(true);
    expect(filter.stockStatus).toEqual(['instock']);
    expect(active).toEqual({ utsala: ['1'], lager: ['1'] });
    expect(activeCount).toBe(2);
  });

  it('adds ithrott as a second attribute clause next to team', () => {
    const { filter } = toStoreFilter(parse('team=liverpool&ithrott=sund,fotbolti,nope'), terms);
    expect(filter.attributes).toEqual([
      { taxonomy: 'pa_felag-lid', termIds: [700] },
      { taxonomy: 'pa_ithrott', termIds: [627, 629] },
    ]);
  });

  it('adds litur as its own attribute clause (OR within the colours) and marks the colours active', () => {
    const { filter, active, activeCount } = toStoreFilter(parse('ithrott=sund&litur=blar,svartur,nope'), terms);
    expect(filter.attributes).toEqual([
      { taxonomy: 'pa_ithrott', termIds: [627] },
      { taxonomy: 'pa_litur', termIds: [363, 364] },
    ]);
    expect(active.litur).toEqual(['blar', 'svartur']);
    expect(activeCount).toBe(3);
  });
});

describe('toggleFilterHref: single-valued price and flag keys', () => {
  it('replaces the price preset, and clears it when the active one is clicked', () => {
    const p = new URLSearchParams('verd=0-5000&brand=nike');
    expect(toggleFilterHref('/verslun/', p, 'verd', '5000-10000')).toBe('/verslun/?verd=5000-10000&brand=nike');
    expect(toggleFilterHref('/verslun/', p, 'verd', '0-5000')).toBe('/verslun/?brand=nike');
  });

  it('switches utsala and lager on and off', () => {
    const on = toggleFilterHref('/verslun/', new URLSearchParams('orderby=price'), 'utsala', '1');
    expect(on).toBe('/verslun/?orderby=price&utsala=1');
    expect(toggleFilterHref('/verslun/', new URLSearchParams('utsala=1&lager=1'), 'lager', '1')).toBe('/verslun/?utsala=1');
  });

  it('toggles a size within the staerd list', () => {
    const p = new URLSearchParams('staerd=42');
    expect(toggleFilterHref('/voruflokkur/skor/', p, 'staerd', '43')).toBe('/voruflokkur/skor/?staerd=42%2C43');
    expect(toggleFilterHref('/voruflokkur/skor/', p, 'staerd', '42')).toBe('/voruflokkur/skor/');
  });

  it('clearFiltersHref clears the new keys too, keeping sort and search', () => {
    const p = new URLSearchParams('staerd=42&verd=0-5000&utsala=1&lager=1&ithrott=sund&s=nike&orderby=price');
    expect(clearFiltersHref('/', p)).toBe('/?s=nike&orderby=price');
  });
});

describe('clearFilterHref (per-group "Hreinsa")', () => {
  it('drops one key, keeping the other filters, sort and search, on page 1', () => {
    const p = new URLSearchParams('brand=nike,adidas&kyn=konur&s=x&orderby=price&page=3');
    expect(clearFilterHref('/voruflokkur/skor/', p, 'brand')).toBe('/voruflokkur/skor/?kyn=konur&s=x&orderby=price');
    expect(clearFilterHref('/verslun/', new URLSearchParams('verd=0-5000'), 'verd')).toBe('/verslun/');
  });
  it('leaves the URL alone when the key is not set', () => {
    expect(clearFilterHref('/verslun/', new URLSearchParams('brand=nike'), 'staerd')).toBe('/verslun/?brand=nike');
  });
});

describe('review fixes: size param normalisation (F-5, F-6, F-7)', () => {
  it('caps staerd at the size plugin\'s limit (MOS_SIZE_MAX_PARAM = 60)', () => {
    expect(MAX_SIZE_PARAM).toBe(60);
    const many = Array.from({ length: 75 }, (_, i) => String(i + 1)).join(',');
    const s = parse(`staerd=${many}`);
    expect(s.staerd).toHaveLength(60);
    expect(s.staerd[59]).toBe('60');
  });

  it('removes a size by its chip even when the URL spells it in upper case', () => {
    const p = new URLSearchParams('staerd=M&brand=nike');
    expect(toggleFilterHref('/verslun/', p, 'staerd', 'm')).toBe('/verslun/?brand=nike');
    expect(toggleFilterHref('/verslun/', p, 'staerd', 'M')).toBe('/verslun/?brand=nike');
  });

  it('drops duplicate and invalid size values when it rewrites the list', () => {
    const p = new URLSearchParams('staerd=42,42,<x>,M');
    expect(toggleFilterHref('/verslun/', p, 'staerd', '43')).toBe('/verslun/?staerd=42%2Cm%2C43');
    expect(toggleFilterHref('/verslun/', p, 'staerd', '42')).toBe('/verslun/?staerd=m');
  });

  it('drops duplicates in other lists too, but keeps values it cannot judge (brands are checked later)', () => {
    const p = new URLSearchParams('brand=nike, nike,no-such-brand');
    expect(toggleFilterHref('/verslun/', p, 'brand', 'nike')).toBe('/verslun/?brand=no-such-brand');
  });

  it('keeps the existing hrefs byte-identical in the normal case', () => {
    expect(toggleFilterHref('/voruflokkur/skor/', new URLSearchParams('staerd=42'), 'staerd', '43')).toBe('/voruflokkur/skor/?staerd=42%2C43');
    expect(toggleFilterHref('/voruflokkur/skor/', new URLSearchParams('kyn=konur&orderby=price'), 'brand', 'casall')).toBe(
      '/voruflokkur/skor/?kyn=konur&orderby=price&brand=casall',
    );
  });

  it('still ignores staerd entirely without the size index, and drops nothing when it exists', () => {
    expect(toStoreFilter(parse('staerd=new-size'), { ...terms, sizes: undefined }).active.staerd).toBeUndefined();
    expect(toStoreFilter(parse('staerd=new-size'), terms).filter.sizeSlugs).toEqual(['new-size']);
  });
});

describe('presetBounds: price presets in the currency\'s minor unit (F-17)', () => {
  const p = (key: string) => pricePreset(key)!;
  it('is the whole-krónur bounds for a currency without a minor unit (ISK)', () => {
    expect(presetBounds(p('0-5000'), 0)).toEqual({ min: undefined, max: 4999 });
    expect(presetBounds(p('5000-10000'), 0)).toEqual({ min: 5000, max: 9999 });
    expect(presetBounds(p('20000-'), 0)).toEqual({ min: 20000, max: undefined });
  });

  it('scales to minor units without a gap below the next preset (2 decimals: 4999.99 is under 5000)', () => {
    expect(presetBounds(p('0-5000'), 2)).toEqual({ min: undefined, max: 499999 });
    expect(presetBounds(p('5000-10000'), 2)).toEqual({ min: 500000, max: 999999 });
    expect(presetBounds(p('20000-'), 2)).toEqual({ min: 2000000, max: undefined });
  });

  it('toStoreFilter sends the scaled bounds', () => {
    expect(toStoreFilter(parse('verd=5000-10000'), terms, undefined, 2).filter).toMatchObject({ minPrice: 500000, maxPrice: 999999 });
    expect(toStoreFilter(parse('verd=5000-10000'), terms).filter).toMatchObject({ minPrice: 5000, maxPrice: 9999 });
  });
});

describe('sizeIndexDecision: a missing size plugin vs a size list that failed to load (F-8)', () => {
  it('applies the size filter when the list loaded', () => {
    expect(sizeIndexDecision(true, 'ok')).toBe('apply');
    expect(sizeIndexDecision(false, 'ok')).toBe('apply');
  });
  it('ignores staerd where the plugin is not installed (404): the site still works without it', () => {
    expect(sizeIndexDecision(true, 'absent')).toBe('ignore');
  });
  it('answers 503 when sizes were asked for and the list failed for another reason, instead of dropping the filter', () => {
    expect(sizeIndexDecision(true, 'down')).toBe('unavailable');
  });
  it('carries on without the Stærð group when no size was asked for', () => {
    expect(sizeIndexDecision(false, 'down')).toBe('ignore');
  });
});

describe('parseLiveFilters caps (LC-05)', () => {
  it('caps the search text (it goes to WooCommerce and into the title) by characters, not UTF-16 units', () => {
    expect(MAX_SEARCH_LENGTH).toBe(100);
    expect(parse(`s=${'a'.repeat(5000)}`).search).toHaveLength(100);
    const emoji = parse(`s=${encodeURIComponent('😀'.repeat(150))}`).search!;
    expect(Array.from(emoji)).toHaveLength(100);
    expect(emoji.endsWith('😀')).toBe(true);
    expect(parse('s=  sk%C3%B3r  ').search).toBe('skór');
  });

  it('caps every comma list', () => {
    expect(MAX_LIST_PARAM).toBe(50);
    const many = Array.from({ length: 5000 }, (_, i) => `b${i}`).join(',');
    for (const key of ['brand', 'kyn', 'team', 'product-category', 'ithrott'] as const) {
      const state = parse(`${key}=${many}`);
      const list = { brand: state.brand, kyn: state.kyn, team: state.team, 'product-category': state.productCategory, ithrott: state.ithrott }[key];
      expect(list).toHaveLength(50);
      expect(list[0]).toBe('b0');
    }
  });
});

