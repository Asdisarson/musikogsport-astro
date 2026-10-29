import { describe, expect, it } from 'vitest';
import { glueBreaks, nowrapRanges, truncateWords } from './text';

describe('truncateWords', () => {
  it('keeps the first N words and appends "..." like live product cards', () => {
    expect(truncateWords('Nike Vomero Plus Womens Road Running Shoes', 3)).toBe('Nike Vomero Plus...');
    expect(truncateWords('Nike fótboltasokkar – Classic Unisex', 3)).toBe('Nike fótboltasokkar –...');
  });

  it('leaves names with N words or fewer untouched', () => {
    expect(truncateWords('Liða – Tattoo', 3)).toBe('Liða – Tattoo');
    expect(truncateWords('CHARMS', 3)).toBe('CHARMS');
  });

  it('collapses odd whitespace before counting', () => {
    expect(truncateWords('  Nike   Mercurial\nSuperfly 10 Elite ', 3)).toBe('Nike Mercurial Superfly...');
  });
});

describe('nowrapRanges', () => {
  it('marks number ranges so "10-18" never breaks across lines', () => {
    expect(nowrapRanges('Opið virka daga 10-18 & laugardaga 10-16')).toEqual([
      { text: 'Opið virka daga ', nowrap: false },
      { text: '10-18', nowrap: true },
      { text: ' & laugardaga ', nowrap: false },
      { text: '10-16', nowrap: true },
    ]);
  });

  it('treats en dashes and clock times as ranges too', () => {
    expect(nowrapRanges('10–18')).toEqual([{ text: '10–18', nowrap: true }]);
    expect(nowrapRanges('Opið 10:00-18:00')).toEqual([
      { text: 'Opið ', nowrap: false },
      { text: '10:00-18:00', nowrap: true },
    ]);
  });

  it('leaves a spaced dash between words alone, and an empty message empty', () => {
    expect(nowrapRanges('Við erum flutt á Dalshraun 10 - Keyrt inn af Stakkahrauni.')).toEqual([
      { text: 'Við erum flutt á Dalshraun 10 - Keyrt inn af Stakkahrauni.', nowrap: false },
    ]);
    expect(nowrapRanges('')).toEqual([]);
  });
});

describe('glueBreaks', () => {
  it('keeps a spaced dash on the line of the word before it, so a wrapped line never starts with "- "', () => {
    expect(glueBreaks('Opið – lokað')).toBe('Opið – lokað');
  });

  it('keeps a number with the word before it, so "Dalshraun 10" never splits', () => {
    expect(glueBreaks('Dalshraun 10 - Keyrt inn')).toBe('Dalshraun 10 - Keyrt inn');
    expect(glueBreaks('Opið virka daga 10-18')).toBe('Opið virka daga 10-18');
  });

  it('glues the dash to the word before it even when a number follows the dash', () => {
    expect(glueBreaks('Útsala - 20% afsláttur')).toBe('Útsala - 20% afsláttur');
  });

  it('glues every space before a number in a run, not every other one', () => {
    expect(glueBreaks('1 2 3')).toBe('1 2 3');
  });

  it('leaves unspaced hyphens and ranges as they are', () => {
    expect(glueBreaks('10-18 og hlaupa-skór')).toBe('10-18 og hlaupa-skór');
  });
});
