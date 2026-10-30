import { describe, expect, it } from 'vitest';
import { variationText } from './cartView';

describe('variationText', () => {
  it('names any size attribute "Stærð", like the product page’s "Veldu stærð"', () => {
    expect(variationText([{ attribute: 'Stærðir', value: '42.5' }])).toBe('Stærð: 42.5');
    expect(variationText([{ attribute: 'Skóstærð', value: '40' }])).toBe('Stærð: 40');
  });
  it('keeps other attributes as named, joined with commas', () => {
    expect(variationText([{ attribute: 'Litur', value: 'Rauður' }, { attribute: 'Stærðir', value: 'M' }])).toBe('Litur: Rauður, Stærð: M');
  });
  it('is empty without a variation', () => {
    expect(variationText([])).toBe('');
  });
});
