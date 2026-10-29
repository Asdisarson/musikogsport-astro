import { describe, expect, it } from 'vitest';
import { createLimiter } from './rateLimit';

describe('createLimiter', () => {
  it('take() allows up to the limit within the window, then refuses', () => {
    let now = 0;
    const l = createLimiter(3, 1000, () => now);
    expect([l.take('a'), l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, true, false]);
  });

  it('counts each key separately', () => {
    const l = createLimiter(1, 1000, () => 0);
    expect(l.take('a')).toBe(true);
    expect(l.take('b')).toBe(true);
    expect(l.take('a')).toBe(false);
  });

  it('starts a fresh window once the old one has passed', () => {
    let now = 0;
    const l = createLimiter(1, 1000, () => now);
    expect(l.take('a')).toBe(true);
    now = 1001;
    expect(l.take('a')).toBe(true);
  });

  it('allowed() only looks: checking never uses up the allowance (failures-only counting)', () => {
    const l = createLimiter(2, 1000, () => 0);
    for (let i = 0; i < 10; i++) expect(l.allowed('a')).toBe(true);
    l.take('a');
    expect(l.allowed('a')).toBe(true);
    l.take('a');
    // `limit` failures recorded: the next attempt is refused (5 wrong passwords → no 6th try).
    expect(l.allowed('a')).toBe(false);
    expect(l.allowed('b')).toBe(true);
  });

  it('forgets recorded failures once the window has passed', () => {
    let now = 0;
    const l = createLimiter(1, 1000, () => now);
    l.take('a');
    expect(l.allowed('a')).toBe(false);
    now = 1001;
    expect(l.allowed('a')).toBe(true);
  });

  it('take() reserves a slot before the slow check, and refund() returns it, so a parallel burst gets only `limit` through', () => {
    const l = createLimiter(3, 1000, () => 0);
    const burst = Array.from({ length: 10 }, () => l.take('a'));
    expect(burst.filter(Boolean)).toHaveLength(3);
    l.refund('a'); // one of them turned out fine (a correct password)
    expect(l.take('a')).toBe(true);
    expect(l.take('a')).toBe(false);
  });

  it('refund() never goes below zero', () => {
    const l = createLimiter(1, 1000, () => 0);
    l.refund('a');
    l.refund('a');
    expect([l.take('a'), l.take('a')]).toEqual([true, false]);
  });

  it('stays bounded: expired keys are dropped as new ones arrive', () => {
    let now = 0;
    const l = createLimiter(1, 1000, () => now);
    for (let i = 0; i < 20000; i++) {
      now = i; // each key expires a second after it was first seen
      l.take(`k${i}`);
    }
    expect(l.size()).toBeLessThanOrEqual(1002);
  });
});

