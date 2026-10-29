// The Icelandic number agreement rule, written once (it was in facets.countWord and productCard.colourLabel, and
// missing in CartButton's label and the orders table).
import { describe, expect, it } from 'vitest';
import { isSingular, countWord } from './plural';

describe('isSingular', () => {
  it('is true after a number ending in 1, except 11 (1, 21, 101, 111 no)', () => {
    for (const n of [1, 21, 31, 101, 121, 1001]) expect(isSingular(n)).toBe(true);
    for (const n of [0, 2, 5, 10, 11, 12, 20, 111, 211, 1011]) expect(isSingular(n)).toBe(false);
  });
});

describe('countWord', () => {
  it('picks the singular or plural form for the number', () => {
    expect(countWord(1, 'vara', 'vörur')).toBe('1 vara');
    expect(countWord(21, 'vara', 'vörur')).toBe('21 vara');
    expect(countWord(11, 'vara', 'vörur')).toBe('11 vörur');
    expect(countWord(0, 'litur', 'litir')).toBe('0 litir');
  });
});
