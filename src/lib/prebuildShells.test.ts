// scripts/prebuild_shells.mjs: its arguments (--base=value and --base value, a usage message instead of a stack trace)
// and its self-check and tally (a repeat with a 200 answer, a refused page counted apart from a kept one).
import { describe, expect, it } from 'vitest';
import { UsageError, isBad, nextPause, parseArgs, readOptions, storeProblem, tally } from '../../scripts/prebuild_shells.mjs';

describe('prebuild_shells: arguments (review 14)', () => {
  it('accepts --base=value and --base value alike', () => {
    expect(readOptions(['--base=https://new.musikogsport.is', '--allow-remote']).base.origin).toBe('https://new.musikogsport.is');
    const spaced = readOptions(['--base', 'https://new.musikogsport.is', '--allow-remote', '--delay', '1000']);
    expect(spaced.base.origin).toBe('https://new.musikogsport.is');
    expect(spaced.allowRemote).toBe(true);
    expect(spaced.delayMs).toBe(1000);
  });

  it('gives a usage message, not a stack trace, for a missing or bad value', () => {
    expect(() => readOptions(['--base'])).toThrow(UsageError);
    expect(() => readOptions(['--base'])).toThrow(/--base needs a value/);
    expect(() => readOptions(['--base=not a url'])).toThrow(/not a URL/);
    expect(() => readOptions(['--delay', 'soon'])).toThrow(/--delay needs a number/);
    expect(() => readOptions(['https://stray.example'])).toThrow(/unexpected argument/);
  });

  it('parses the flag forms', () => {
    expect(parseArgs(['--allow-remote', '--limit=30'])).toEqual({ 'allow-remote': 'true', limit: '30' });
  });
});

describe('prebuild_shells: the self-check and the tally (review 12, 13)', () => {
  it('the first answer must be a 200 with a store state', () => {
    expect(storeProblem({ status: 500, shell: 'miss', ms: 5 })).toMatch(/answered 500/);
    expect(storeProblem({ status: 200, shell: 'refused', ms: 5 })).toMatch(/refused/);
    expect(storeProblem({ status: 200, shell: '-', ms: 5 })).toMatch(/"-"/);
    expect(storeProblem({ status: 200, shell: 'miss', ms: 5 })).toBeNull();
    expect(storeProblem({ status: 200, shell: 'hit', ms: 5 })).toBeNull();
  });

  it('counts a page rendered and kept as miss, and one the store refused apart from it', () => {
    expect(tally({ status: 200, shell: 'miss', ms: 5 }, 3000)).toBe('miss');
    expect(tally({ status: 200, shell: 'refused', ms: 5 }, 3000)).toBe('refused');
    expect(tally({ status: 200, shell: 'hit', ms: 5 }, 3000)).toBe('hit');
    expect(tally({ status: 500, shell: 'miss', ms: 5 }, 3000)).toBe('bad');
    expect(tally({ status: 404, shell: 'skip', ms: 5 }, 3000)).toBeNull();
  });

  it('a repeat or a main-loop render that is bad doubles the pause, a good one halves it back to the delay', () => {
    expect(isBad({ status: 503, shell: '-', ms: 5 }, 3000)).toBe(true);
    expect(nextPause(500, true, 500)).toBe(1000);
    expect(nextPause(1000, false, 500)).toBe(500);
    expect(nextPause(20000, true, 500)).toBe(30000);
  });
});
