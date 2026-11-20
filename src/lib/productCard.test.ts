import { describe, expect, it } from 'vitest';
import { cardLabel, colourCount, colourLabel, isColourAttribute, NEW_PRODUCT_DAYS, productSubtitle, subtitleLink, subtitleParts } from './productCard';
import type { WooAttribute } from './types';

describe('cardLabel', () => {
  const now = new Date('2026-10-20T12:00:00Z');

  it('labels a discounted product "Útsala" in the accent', () => {
    expect(cardLabel({ discounted: true, outOfStock: false })).toEqual({ text: 'Útsala', tone: 'accent' });
  });

  it('gives a plain in-stock product no label', () => {
    expect(cardLabel({ discounted: false, outOfStock: false })).toBeNull();
  });

  it('says "Uppselt" (muted) for a sold-out product, even one on sale', () => {
    expect(cardLabel({ discounted: false, outOfStock: true })).toEqual({ text: 'Uppselt', tone: 'muted' });
    expect(cardLabel({ discounted: true, outOfStock: true })).toEqual({ text: 'Uppselt', tone: 'muted' });
  });

  it(`says "Nýtt" for a product published in the last ${NEW_PRODUCT_DAYS} days, ahead of the sale label`, () => {
    expect(cardLabel({ discounted: false, outOfStock: false, createdAt: '2026-10-01T09:00:00', now })).toEqual({ text: 'Nýtt', tone: 'accent' });
    expect(cardLabel({ discounted: true, outOfStock: false, createdAt: '2026-10-19T09:00:00', now })?.text).toBe('Nýtt');
  });

  it('falls back to the sale label once the product is older than the window', () => {
    expect(cardLabel({ discounted: true, outOfStock: false, createdAt: '2026-09-01T09:00:00', now })?.text).toBe('Útsala');
    expect(cardLabel({ discounted: false, outOfStock: false, createdAt: '2026-09-01T09:00:00', now })).toBeNull();
  });

  it('ignores a missing, unparseable or future date', () => {
    expect(cardLabel({ discounted: false, outOfStock: false, createdAt: null, now })).toBeNull();
    expect(cardLabel({ discounted: false, outOfStock: false, createdAt: 'not a date', now })).toBeNull();
    expect(cardLabel({ discounted: false, outOfStock: false, createdAt: '2027-01-01T00:00:00', now })).toBeNull();
  });
});

describe('colourCount', () => {
  const attr = (name: string, variation: boolean, options: string[]): WooAttribute => ({ id: 0, name, visible: true, variation, options });

  it('counts the options of a "Litur" variation attribute', () => {
    expect(colourCount([attr('Stærðir', true, ['S', 'M', 'L']), attr('Litur', true, ['Svart', 'Bleikur', 'Volt', 'Hvítur'])])).toBe(4);
  });

  it('matches the colour attribute case-insensitively, including the pa_litur taxonomy name', () => {
    expect(colourCount([attr('LITUR', true, ['Blár', 'Fjólublár'])])).toBe(2);
    expect(colourCount([attr('pa_litur', true, ['Blár', 'Rauður'])])).toBe(2);
  });

  it('returns 0 for one colour, a non-variation colour attribute, or none at all', () => {
    expect(colourCount([attr('Litur', true, ['Svart'])])).toBe(0);
    expect(colourCount([attr('Litur', false, ['Svart', 'Hvítt'])])).toBe(0);
    expect(colourCount([attr('Stærðir', true, ['S', 'M'])])).toBe(0);
    expect(colourCount(undefined)).toBe(0);
  });

  it('counts each colour once', () => {
    expect(colourCount([attr('Litur', true, ['Svart', 'Svart', 'Hvítt'])])).toBe(2);
  });
});

describe('colourLabel', () => {
  it('uses the plural "litir"', () => {
    expect(colourLabel(2)).toBe('2 litir');
    expect(colourLabel(11)).toBe('11 litir');
    expect(colourLabel(12)).toBe('12 litir');
  });

  it('uses the singular "litur" for numbers ending in 1 (except 11)', () => {
    expect(colourLabel(21)).toBe('21 litur');
    expect(colourLabel(31)).toBe('31 litur');
    expect(colourLabel(111)).toBe('111 litir');
  });
});

describe('isColourAttribute', () => {
  it('matches Litur, Litir, Colour and the pa_ taxonomy names, any case, padded', () => {
    for (const name of ['Litur', 'LITIR', 'pa_litur', 'Color', 'Colours', ' Litur ']) expect(isColourAttribute(name), name).toBe(true);
  });

  it('is false for other attributes', () => {
    for (const name of ['Stærðir', 'Litaval', 'Aldur', '']) expect(isColourAttribute(name), name).toBe(false);
  });
});

describe('productSubtitle', () => {
  it('joins the first category and the brand term with a middle dot', () => {
    expect(productSubtitle({ category: 'Hlaupaskór', brands: [{ name: 'Hoka' }], name: 'HOKA Restore TC unisex' })).toBe('Hlaupaskór · Hoka');
  });

  it('decodes an entity-encoded brand term', () => {
    expect(productSubtitle({ category: 'Skór', brands: [{ name: 'Smith &amp; Co' }], name: 'Skór' })).toBe('Skór · Smith & Co');
  });

  it('falls back to the brand at the start of the name when there is no brand term', () => {
    expect(productSubtitle({ category: 'Hlaupaskór', brands: [], name: 'ASICS GEL-NIMBUS 28' })).toBe('Hlaupaskór · ASICS');
  });

  it('shows only what it has', () => {
    expect(productSubtitle({ category: 'Boltar', name: 'Fótbolti' })).toBe('Boltar');
    expect(productSubtitle({ brands: [{ name: 'Nike' }], name: 'Nike bolur' })).toBe('Nike');
    expect(productSubtitle({ name: 'Fótbolti' })).toBe('');
  });

  it('does not repeat a brand that is also the category name', () => {
    expect(productSubtitle({ category: 'Hoka', brands: [{ name: 'HOKA' }], name: 'HOKA Clifton' })).toBe('Hoka');
  });
});

describe('subtitleLink', () => {
  const peysur = { name: 'Peysur', path: '/voruflokkur/fatnadur/efri-likami/peysur-efri-likami/' };

  it('links the category at the start of the subtitle and keeps the rest as text', () => {
    expect(subtitleLink('Peysur · Nike', peysur)).toEqual({ name: 'Peysur', href: peysur.path, rest: ' · Nike' });
    expect(subtitleLink('Peysur', peysur)).toEqual({ name: 'Peysur', href: peysur.path, rest: '' });
  });

  it('links nothing when the subtitle does not start with the category (brand only, or none)', () => {
    expect(subtitleLink('Nike', peysur)).toBeNull();
    expect(subtitleLink('Nike', undefined)).toBeNull();
    expect(subtitleLink('', peysur)).toBeNull();
    expect(subtitleLink('Peysur · Nike', { name: 'Peysur', path: '' })).toBeNull();
  });
});

describe('subtitleParts', () => {
  const peysur = { name: 'Peysur', path: '/voruflokkur/fatnadur/efri-likami/peysur-efri-likami/' };
  const nike = { name: 'Nike', path: '/brand/nike/' };

  it('links both the category and the brand, with the separator as text between them', () => {
    expect(subtitleParts('Peysur · Nike', peysur, nike)).toEqual([{ text: 'Peysur', href: peysur.path }, { text: ' · ' }, { text: 'Nike', href: nike.path }]);
  });

  it('links a brand that stands alone', () => {
    expect(subtitleParts('Nike', undefined, nike)).toEqual([{ text: 'Nike', href: nike.path }]);
    expect(subtitleParts('Nike', peysur, nike)).toEqual([{ text: 'Nike', href: nike.path }]);
  });

  it('leaves the brand as text when the product has no brand page (the brand was read from its name)', () => {
    expect(subtitleParts('Peysur · Nike', peysur)).toEqual([{ text: 'Peysur', href: peysur.path }, { text: ' · Nike' }]);
    expect(subtitleParts('Peysur · Nike', peysur, { name: 'Nike', path: '' })).toEqual([{ text: 'Peysur', href: peysur.path }, { text: ' · Nike' }]);
  });

  it('links the brand even when the category has no page', () => {
    expect(subtitleParts('Peysur · Nike', { name: 'Peysur', path: '' }, nike)).toEqual([{ text: 'Peysur · ' }, { text: 'Nike', href: nike.path }]);
  });

  it('links a brand only where the subtitle ends with it', () => {
    expect(subtitleParts('Peysur · Hoka', peysur, nike)).toEqual([{ text: 'Peysur', href: peysur.path }, { text: ' · Hoka' }]);
    expect(subtitleParts('Peysur', peysur, { name: 'Peysur', path: '/brand/peysur/' })).toEqual([{ text: 'Peysur', href: peysur.path }]);
  });

  it('is the subtitle as text when nothing can be linked, and nothing for an empty one', () => {
    expect(subtitleParts('Peysur · Nike')).toEqual([{ text: 'Peysur · Nike' }]);
    expect(subtitleParts('', peysur, nike)).toEqual([]);
  });
});
