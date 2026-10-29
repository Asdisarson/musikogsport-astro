import { describe, expect, it } from 'vitest';
import { passwordProblem, qtyFromInput } from './validate';

describe('qtyFromInput', () => {
  it('reads a typed whole number', () => {
    expect(qtyFromInput('3')).toBe(3);
    expect(qtyFromInput(' 4 ')).toBe(4);
    expect(qtyFromInput('12')).toBe(12);
  });

  it('falls back to 1 for an empty, zero or nonsense field', () => {
    for (const t of ['', '0', '-2', 'abc']) expect(qtyFromInput(t)).toBe(1);
  });

  it('drops decimals and caps at the cart maximum', () => {
    expect(qtyFromInput('2.7')).toBe(2);
    expect(qtyFromInput('150')).toBe(99);
  });
});

describe('passwordProblem', () => {
  it('accepts 8 to 200 characters, counted as code points the way WordPress counts (mb_strlen)', () => {
    expect(passwordProblem('abcdefgh')).toBeNull();
    expect(passwordProblem('😀'.repeat(8))).toBeNull();
    expect(passwordProblem('x'.repeat(200))).toBeNull();
  });

  it('calls a password short below 8 code points (4 emoji are 8 UTF-16 units, but 4 characters)', () => {
    expect(passwordProblem('abc')).toBe('short');
    expect(passwordProblem('😀😀😀😀')).toBe('short');
  });

  it('calls a password of mostly spaces short: only the trimmed characters count towards the minimum', () => {
    expect(passwordProblem('        ')).toBe('short');
    expect(passwordProblem('  abc   ')).toBe('short');
  });

  it('calls it long above 200, padding included: WordPress refuses to hash more than 4096 bytes', () => {
    expect(passwordProblem('x'.repeat(201))).toBe('long');
    expect(passwordProblem('abcdefgh' + ' '.repeat(4100))).toBe('long');
    expect(passwordProblem('x'.repeat(5_000_000))).toBe('long');
  });
});
