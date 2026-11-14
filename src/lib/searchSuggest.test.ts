// The search field's live suggestions: which categories and brands a typed text names (the same matching rules as
// the product search in wp-mu-plugins/mos-search.php, kept small), and the query a text is worth asking with.
import { describe, expect, it } from 'vitest';
import { SUGGEST_MIN_LENGTH, suggestQuery, suggestTerms, wordMatches } from './searchSuggest';

const terms = [
  { name: 'Peysur', path: '/voruflokkur/fatnadur/peysur/', count: 302 },
  { name: 'Töskur', path: '/voruflokkur/toskur/', count: 156 },
  { name: 'Fótboltaskór', path: '/voruflokkur/skor/fotboltaskor/', count: 156 },
  { name: 'Hlaupaskór', path: '/voruflokkur/skor/hlaupaskor/', count: 9 },
  { name: 'Sokkar & nærfatnaður', path: '/voruflokkur/sokkar/', count: 120 },
  { name: 'Nike', path: '/brand/nike/', count: 700 },
  { name: 'Tómur flokkur', path: '/voruflokkur/tomur/', count: 0 },
];
const names = (q: string, limit = 5) => suggestTerms(q, terms, limit).map((t) => t.name);

describe('wordMatches', () => {
  it('matches the start of a word, or its end plus an ending', () => {
    expect(wordMatches('sko', 'skor')).toBe(true);
    expect(wordMatches('peys', 'peysur')).toBe(true);
    expect(wordMatches('skor', 'fotboltaskor')).toBe(true);
    expect(wordMatches('sokk', 'fotboltasokkar')).toBe(true);
  });

  it('does not match inside another word', () => {
    expect(wordMatches('task', 'fotboltaskor')).toBe(false);
    expect(wordMatches('bolt', 'fotboltaskor')).toBe(false);
    expect(wordMatches('ke', 'nike')).toBe(false);
  });
});

describe('suggestTerms', () => {
  it('finds a category by any form of its name, however it is typed', () => {
    expect(names('peysa')).toEqual(['Peysur']);
    expect(names('PEYSUR')).toEqual(['Peysur']);
    expect(names('taska')).toEqual(['Töskur']);
    expect(names('toskur')).toEqual(['Töskur']);
  });

  it('finds every category a word ends, the bigger first', () => {
    expect(names('skór')).toEqual(['Fótboltaskór', 'Hlaupaskór']);
    expect(names('sko')).toEqual(['Fótboltaskór', 'Hlaupaskór']);
  });

  it('needs every typed word in the name', () => {
    expect(names('sokkar nærfatnaður')).toEqual(['Sokkar & nærfatnaður']);
    expect(names('nike skór')).toEqual([]);
  });

  it('leaves out empty categories, keeps to the limit, and finds nothing for nothing', () => {
    expect(names('tómur')).toEqual([]);
    expect(names('skor', 1)).toEqual(['Fótboltaskór']);
    expect(names('  ')).toEqual([]);
    expect(names('a')).toEqual([]);
  });
});

describe('suggestQuery', () => {
  it('trims and caps the text; too short a text asks nothing', () => {
    expect(suggestQuery('  nike  skór ')).toBe('nike skór');
    expect(suggestQuery('n')).toBe('');
    expect(suggestQuery(null)).toBe('');
    expect(suggestQuery('x'.repeat(500)).length).toBeLessThanOrEqual(80);
    expect(SUGGEST_MIN_LENGTH).toBe(2);
  });
});
