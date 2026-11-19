import { describe, expect, it } from 'vitest';
import { choiceHint, isSizeAttribute, optionImages, optionState, pricesVary, resolveVariation, sortSizeOptions, type VariationLike } from './variations';

const v = (id: number, attrs: Record<string, string>, stock = 'instock', price = '10000', regular = price): VariationLike => ({
  id,
  attributes: Object.entries(attrs).map(([name, option]) => ({ name, option })),
  price,
  regular_price: regular,
  stock_status: stock,
});

describe('resolveVariation', () => {
  const vars = [v(1, { Stærðir: '40', Litur: 'Svartur' }), v(2, { Stærðir: '41', Litur: 'Svartur' })];

  it('returns the variation matching every chosen attribute', () => {
    expect(resolveVariation(vars, ['Stærðir', 'Litur'], { Stærðir: '41', Litur: 'Svartur' })?.id).toBe(2);
  });

  it('returns null until every attribute is chosen', () => {
    expect(resolveVariation(vars, ['Stærðir', 'Litur'], { Stærðir: '41' })).toBeNull();
  });

  it('treats an empty variation option as "any" (Woo wildcard)', () => {
    const any = [v(7, { Stærðir: '', Litur: 'Rauður' })];
    expect(resolveVariation(any, ['Stærðir', 'Litur'], { Stærðir: '44', Litur: 'Rauður' })?.id).toBe(7);
  });

  // WC REST leaves an "Any Stærðir" attribute out of the variation entirely. Product 228384 in menu order:
  // 246166 (any, 14.490), 228385 (28, 8.694, in stock), …, 228396 (38, sold out).
  const kids = [v(246166, {}, 'instock', '14490'), v(228385, { Stærðir: '28' }, 'instock', '8694', '14490'), v(228396, { Stærðir: '38' }, 'outofstock', '8694', '14490')];

  it('treats an attribute missing from the variation as "any"', () => {
    expect(resolveVariation([v(246166, {})], ['Stærðir'], { Stærðir: '38' })?.id).toBe(246166);
  });

  it('takes the first matching variation in menu order, as WooCommerce and live do (price included)', () => {
    expect(resolveVariation(kids, ['Stærðir'], { Stærðir: '28' })?.id).toBe(246166);
    expect(resolveVariation(kids, ['Stærðir'], { Stærðir: '38' })?.id).toBe(246166);
  });

  it('keeps menu order even when the first match is sold out (WooCommerce then shows it as Uppselt)', () => {
    const exactFirst = [v(2, { Stærðir: '38' }, 'outofstock'), v(1, {}, 'instock')];
    expect(resolveVariation(exactFirst, ['Stærðir'], { Stærðir: '38' })?.id).toBe(2);
  });
});

describe('optionState', () => {
  const vars = [
    v(1, { Stærðir: '40', Litur: 'Svartur' }),
    v(2, { Stærðir: '41', Litur: 'Svartur' }, 'outofstock'),
    v(3, { Stærðir: '41', Litur: 'Hvítur' }),
  ];

  it('is instock when some variation with that option can be bought', () => {
    expect(optionState(vars, 'Stærðir', '41', {})).toBe('instock');
  });

  it('respects the other attributes already chosen', () => {
    expect(optionState(vars, 'Stærðir', '41', { Litur: 'Svartur' })).toBe('outofstock');
    expect(optionState(vars, 'Stærðir', '40', { Litur: 'Hvítur' })).toBe('none');
  });

  it('counts an in-stock "any" variation (attribute missing in REST) for every option', () => {
    const kids = [v(246166, {}), v(228396, { Stærðir: '38' }, 'outofstock')];
    expect(optionState(kids, 'Stærðir', '38', {})).toBe('instock');
  });

  it('follows the variation WooCommerce would pick once every other attribute is chosen', () => {
    // Menu order: a sold-out exact 38 first, an in-stock "any" after it. Picking 38 resolves to the sold-out
    // one (as on live), so its swatch must be crossed out; 40 only matches the "any" variation.
    const vars = [v(1, { Stærðir: '38' }, 'outofstock'), v(2, {}, 'instock')];
    expect(optionState(vars, 'Stærðir', '38', {}, ['Stærðir'])).toBe('outofstock');
    expect(optionState(vars, 'Stærðir', '40', {}, ['Stærðir'])).toBe('instock');
  });

  it('ignores the attribute’s own current choice so the user can switch options', () => {
    expect(optionState(vars, 'Stærðir', '40', { Stærðir: '41', Litur: 'Svartur' })).toBe('instock');
  });
});

describe('pricesVary', () => {
  it('is false when every variation costs the same (live then shows no separate variation price)', () => {
    expect(pricesVary([v(1, {}), v(2, {})])).toBe(false);
  });

  it('is true when a price or a regular price differs', () => {
    expect(pricesVary([v(1, {}), v(2, {}, 'instock', '12000')])).toBe(true);
    expect(pricesVary([v(1, {}), v(2, {}, 'instock', '10000', '15000')])).toBe(true);
  });
});

describe('choiceHint', () => {
  it('asks for a size while a size attribute is unchosen', () => {
    expect(choiceHint(['Stærðir'], {})).toBe('Veldu stærð');
    expect(choiceHint(['Stærð'], { Stærð: '' })).toBe('Veldu stærð');
  });

  it('is null once every attribute is chosen', () => {
    expect(choiceHint(['Stærðir'], { Stærðir: '41' })).toBeNull();
    expect(choiceHint(['Stærðir', 'Litur'], { Stærðir: '41', Litur: 'Svartur' })).toBeNull();
  });

  it('names the first unchosen attribute: a size, else a generic option', () => {
    expect(choiceHint(['Litur', 'Stærðir'], { Litur: 'Svartur' })).toBe('Veldu stærð');
    expect(choiceHint(['Litur', 'Stærðir'], { Stærðir: '41' })).toBe('Veldu valkost');
  });

  it('is null for a product without variation attributes', () => {
    expect(choiceHint([], {})).toBeNull();
  });

  // R4-3: Woo attribute names seen beyond "Stærð(ir)": compound Icelandic names and English "Size".
  it('asks for a size when the attribute name contains stærð or size anywhere, any case, padded', () => {
    for (const name of ['Skóstærð', 'Barnastærð', 'Size', 'SIZE', 'Shoe size', 'STÆRÐIR', '  Stærðir  ']) {
      expect(choiceHint([name], {}), name).toBe('Veldu stærð');
    }
  });

  it('keeps the generic hint for attributes that are not a size', () => {
    expect(choiceHint(['Litur'], {})).toBe('Veldu valkost');
    expect(choiceHint(['Color'], {})).toBe('Veldu valkost');
  });

  // R4-2: with availability, the hint only shows when the missing attribute has something to pick.
  describe('with availability', () => {
    const attrs = [
      { name: 'Litur', options: ['Svartur', 'Rauður'] },
      { name: 'Stærðir', options: ['40', '41'] },
    ];
    const names = attrs.map((a) => a.name);

    it('is null when every option of the missing attribute is sold out', () => {
      const vars = [v(1, { Stærðir: '40' }, 'outofstock'), v(2, { Stærðir: '41' }, 'outofstock')];
      expect(choiceHint(['Stærðir'], {}, { attrs: [attrs[1]], variations: vars })).toBeNull();
    });

    it('is null when no variation exists for any option of the missing attribute', () => {
      const vars = [v(1, { Litur: 'Svartur', Stærðir: '40' }), v(2, { Litur: 'Svartur', Stærðir: '41' })];
      expect(choiceHint(names, { Litur: 'Rauður' }, { attrs, variations: vars })).toBeNull();
    });

    it('still asks for a size when one option is in stock', () => {
      const vars = [v(1, { Litur: 'Svartur', Stærðir: '40' }, 'outofstock'), v(2, { Litur: 'Svartur', Stærðir: '41' })];
      expect(choiceHint(names, { Litur: 'Svartur' }, { attrs, variations: vars })).toBe('Veldu stærð');
    });

    it('judges the first unchosen attribute, as optionState does for its swatches', () => {
      const vars = [v(1, { Litur: 'Svartur', Stærðir: '40' }), v(2, { Litur: 'Rauður', Stærðir: '41' }, 'outofstock')];
      expect(choiceHint(names, {}, { attrs, variations: vars })).toBe('Veldu valkost');
      expect(choiceHint(names, { Stærðir: '41' }, { attrs, variations: vars })).toBeNull();
    });

    it('is null with no variations at all', () => {
      expect(choiceHint(names, {}, { attrs, variations: [] })).toBeNull();
    });

    it('is null when the missing attribute lists no options', () => {
      const vars = [v(1, { Stærðir: '40' })];
      expect(choiceHint(['Stærðir'], {}, { attrs: [{ name: 'Stærðir', options: [] }], variations: vars })).toBeNull();
      expect(choiceHint(['Stærðir'], {}, { attrs: [], variations: vars })).toBeNull();
    });

    it('is still null once everything is chosen', () => {
      const vars = [v(1, { Litur: 'Svartur', Stærðir: '40' })];
      expect(choiceHint(names, { Litur: 'Svartur', Stærðir: '40' }, { attrs, variations: vars })).toBeNull();
    });
  });
});

describe('isSizeAttribute', () => {
  it('matches stærð or size anywhere in the name, any case, padded', () => {
    for (const name of ['Stærð', 'Stærðir', 'Skóstærð', 'Barnastærð', 'Size', 'SIZE', 'Shoe size', '  Stærðir  ']) {
      expect(isSizeAttribute(name), name).toBe(true);
    }
  });

  it('is false for other attributes', () => {
    for (const name of ['Litur', 'Color', 'Aldur', 'Lengd', '']) expect(isSizeAttribute(name), name).toBe(false);
  });
});

describe('optionImages', () => {
  const img = (id: number, attrs: Record<string, string>, src: string | null, stock = 'instock') => ({
    ...v(id, attrs, stock),
    image: src ? { src, alt: '' } : null,
  });

  it("maps each colour to its first variation's own image, in menu order", () => {
    const vars = [
      img(1, { Litur: 'Svartur', Stærð: 'S' }, '/svartur.jpg'),
      img(2, { Litur: 'Svartur', Stærð: 'M' }, '/svartur-2.jpg'),
      img(3, { Litur: 'Rauður', Stærð: 'S' }, '/raudur.jpg', 'outofstock'),
    ];
    expect(optionImages('Litur', ['Svartur', 'Rauður'], vars)).toEqual({ Svartur: '/svartur.jpg', Rauður: '/raudur.jpg' });
  });

  it('skips variations without an image when looking for an option', () => {
    const vars = [img(1, { Litur: 'Svartur' }, null), img(2, { Litur: 'Svartur' }, '/svartur.jpg'), img(3, { Litur: 'Blár' }, '/blar.jpg')];
    expect(optionImages('Litur', ['Svartur', 'Blár'], vars)).toEqual({ Svartur: '/svartur.jpg', Blár: '/blar.jpg' });
  });

  it('is null when an option has no image of its own', () => {
    const vars = [img(1, { Litur: 'Svartur' }, '/svartur.jpg'), img(2, { Litur: 'Blár' }, null)];
    expect(optionImages('Litur', ['Svartur', 'Blár'], vars)).toBeNull();
  });

  it('is null when two options share an image (the parent photo, not a colourway)', () => {
    const vars = [img(1, { Litur: 'Svartur' }, '/parent.jpg'), img(2, { Litur: 'Blár' }, '/parent.jpg')];
    expect(optionImages('Litur', ['Svartur', 'Blár'], vars)).toBeNull();
  });

  it('does not count an "any" variation as a colourway', () => {
    const vars = [img(1, { Litur: '' }, '/any.jpg'), img(2, {}, '/any-2.jpg'), img(3, { Litur: 'Blár' }, '/blar.jpg')];
    expect(optionImages('Litur', ['Svartur', 'Blár'], vars)).toBeNull();
  });

  it('is null with fewer than two options', () => {
    expect(optionImages('Litur', ['Svartur'], [img(1, { Litur: 'Svartur' }, '/svartur.jpg')])).toBeNull();
    expect(optionImages('Litur', [], [])).toBeNull();
  });
});

describe('sortSizeOptions', () => {
  it('puts numeric sizes in ascending order', () => {
    expect(sortSizeOptions(['46', '45', '41', '42', '42.5', '44', '44.5', '43.5'])).toEqual(['41', '42', '42.5', '43.5', '44', '44.5', '45', '46']);
  });
  it('reads decimal commas and thirds', () => {
    expect(sortSizeOptions(['42 2/3', '42', '41,5', '42 1/3'])).toEqual(['41,5', '42', '42 1/3', '42 2/3']);
  });
  it('keeps the shop order when any size is not a number', () => {
    expect(sortSizeOptions(['M', 'S', 'L'])).toEqual(['M', 'S', 'L']);
    expect(sortSizeOptions(['40', 'One size'])).toEqual(['40', 'One size']);
  });
  it('does not change its input', () => {
    const input = ['2', '1'];
    sortSizeOptions(input);
    expect(input).toEqual(['2', '1']);
  });
});

// Stock is not in the page (it comes from /api/live/product): a variation without a stock_status is unknown, and an
// unknown option must stay selectable, never struck through as sold out.
describe('unknown stock (pending live answer)', () => {
  const pending = (id: number, attrs: Record<string, string>): VariationLike => ({
    id,
    attributes: Object.entries(attrs).map(([name, option]) => ({ name, option })),
    price: '10000',
    regular_price: '10000',
    stock_status: undefined as unknown as string,
  });
  const vars = [pending(1, { Stærðir: '40' }), pending(2, { Stærðir: '41' })];

  it('reports an option as pending, not sold out', () => {
    expect(optionState(vars, 'Stærðir', '41', {}, ['Stærðir'])).toBe('pending');
  });

  it('keeps a pending option selectable in the hint (choiceHint does not hide it)', () => {
    expect(choiceHint(['Stærðir'], {}, { attrs: [{ name: 'Stærðir', options: ['40', '41'] }], variations: vars })).toBe('Veldu stærð');
  });

  it('a known sold-out option stays outofstock even next to unknown ones', () => {
    const mixed = [pending(1, { Stærðir: '40' }), v(2, { Stærðir: '41' }, 'outofstock')];
    expect(optionState(mixed, 'Stærðir', '41', {}, ['Stærðir'])).toBe('outofstock');
  });
});
