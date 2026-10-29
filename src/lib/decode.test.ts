// decodeEntities / stripShortcodes (LC-14), the C0-control guard (LC-21), and formatISK/scaleMinor (LC-14).
import { describe, expect, it } from 'vitest';
import { decodeEntities, stripShortcodes } from './decode';
import { formatISK, formatStoreMoney, scaleMinor } from './format';
import { splitBrand } from './brand';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities in one pass', () => {
    expect(decodeEntities('Hlaup &amp; útivist')).toBe('Hlaup & útivist');
    expect(decodeEntities('&lt;b&gt; &quot;x&quot; &apos;y&apos; a&nbsp;b')).toBe('<b> "x" \'y\' a b');
    expect(decodeEntities('&#8211; &#x2014; &#X1F600;')).toBe('– — 😀');
    expect(decodeEntities('&amp;lt;')).toBe('&lt;'); // single pass
  });

  it('leaves unknown names, out-of-range and malformed references as they are', () => {
    expect(decodeEntities('&AMP; &foo; &#9999999; & x')).toBe('&AMP; &foo; &#9999999; & x');
    expect(decodeEntities(null)).toBe('');
    expect(decodeEntities(undefined)).toBe('');
    expect(decodeEntities('')).toBe('');
  });

  it('never produces a NUL or other C0 control character, tab and newline excepted (LC-21)', () => {
    expect(decodeEntities('a&#0;b')).toBe('a&#0;b');
    expect(decodeEntities('a&#x1;b&#27;c')).toBe('a&#x1;b&#27;c');
    expect(decodeEntities('a&#127;b')).toBe('a&#127;b');
    expect(decodeEntities('a&#9;b&#10;c')).toBe('a\tb\nc');
  });
});

describe('stripShortcodes', () => {
  it('removes shortcode tags and keeps the text between them', () => {
    expect(stripShortcodes('[vc_row][vc_column]Halló[/vc_column][/vc_row]')).toBe('Halló');
    expect(stripShortcodes('a [b] c')).toBe('a  c');
    expect(stripShortcodes(null)).toBe('');
  });
});

describe('formatISK', () => {
  it('formats whole krónur with dot grouping', () => {
    expect(formatISK(37990)).toBe('37.990 kr.');
    expect(formatISK('1234567')).toBe('1.234.567 kr.');
    expect(formatISK(0)).toBe('0 kr.');
    expect(formatISK(-500)).toBe('-500 kr.');
    expect(formatISK(999.6)).toBe('1.000 kr.');
  });
  it('is empty for nothing or not a number', () => {
    for (const v of [null, undefined, '', 'abc', Number.NaN, Infinity]) expect(formatISK(v as never)).toBe(v === '' ? '0 kr.' : '');
  });
  it('scales Store API minor units', () => {
    expect(scaleMinor('37990', 0)).toBe(37990);
    expect(scaleMinor('3799000', 2)).toBe(37990);
    expect(scaleMinor('x', 2)).toBe(0);
    expect(formatStoreMoney('3799000', 2)).toBe('37.990 kr.');
  });
});

describe('splitBrand', () => {
  it('splits a known brand off the start, longest match first', () => {
    expect(splitBrand('ASICS GEL-NIMBUS 28')).toEqual({ brand: 'ASICS', rest: 'GEL-NIMBUS 28' });
    expect(splitBrand('New Balance 1080v14')).toEqual({ brand: 'NEW BALANCE', rest: '1080v14' });
    expect(splitBrand('Hoka &amp; co Clifton')).toEqual({ brand: 'HOKA', rest: '& co Clifton' });
  });
  it('does not guess', () => {
    expect(splitBrand('Nike')).toEqual({ rest: 'Nike' });
    expect(splitBrand('Nikelodeon bolur')).toEqual({ rest: 'Nikelodeon bolur' });
  });
});
