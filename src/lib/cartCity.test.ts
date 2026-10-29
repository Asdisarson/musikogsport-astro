import { describe, expect, it } from 'vitest';
import { cartCity } from './cartCity';

describe('cartCity', () => {
  it('treats the Store API dash placeholders (raw or as entities) as no town', () => {
    for (const raw of ['-', '&#8211;', '–', '&#8212;', '—', ' - ']) expect(cartCity(raw)).toBe('');
  });

  it('is empty for a blank or missing town', () => {
    expect(cartCity('')).toBe('');
    expect(cartCity(undefined)).toBe('');
  });

  it('keeps a real town, decoding its entities', () => {
    expect(cartCity('Reykjavík')).toBe('Reykjavík');
    expect(cartCity('A &amp; B')).toBe('A & B');
    expect(cartCity('Hafnar-fjörður')).toBe('Hafnar-fjörður');
  });
});
