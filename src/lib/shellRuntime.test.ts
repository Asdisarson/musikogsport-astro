import { describe, expect, it } from 'vitest';
import { buildIdFrom, createRefreshBackoff, logGate } from './shellRuntime';

describe('shellBuildId: a new build or a new key is a new set of pages (review 3, 18)', () => {
  const base = { client: 'a.js:10', server: 'entry.mjs:5\nchunks/x.mjs:9', key: 'k1' };

  it('is stable for the same parts', () => {
    expect(buildIdFrom(base)).toBe(buildIdFrom({ ...base }));
  });

  it('changes when only the server build changes (no client asset changed)', () => {
    expect(buildIdFrom({ ...base, server: 'entry.mjs:5\nchunks/x.mjs:10' })).not.toBe(buildIdFrom(base));
    expect(buildIdFrom({ ...base, server: 'entry.mjs:5\nchunks/y.mjs:9' })).not.toBe(buildIdFrom(base));
  });

  it('changes when the island key changes, and does not contain it', () => {
    const id = buildIdFrom({ ...base, key: 'secret-key-value' });
    expect(id).not.toBe(buildIdFrom(base));
    expect(id).not.toContain('secret');
    expect(buildIdFrom({ ...base, key: undefined })).not.toBe(buildIdFrom(base));
  });

  it('is a short hex id', () => {
    expect(buildIdFrom(base)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('createRefreshBackoff: a refresh that is not kept backs off like a failure (review 20)', () => {
  it('waits, longer after each failure, and a stored refresh forgets the failures', () => {
    let t = 1_000_000;
    const b = createRefreshBackoff({ now: () => t });
    b.note('k');
    expect(b.backingOff('k')).toBe(true);
    t += 29_000;
    expect(b.backingOff('k')).toBe(true);
    t += 2_000;
    expect(b.backingOff('k')).toBe(false);
    b.note('k'); // second failure in a row: 60 s
    t += 59_000;
    expect(b.backingOff('k')).toBe(true);
    t += 2_000;
    expect(b.backingOff('k')).toBe(false);
    b.clear('k');
    b.note('k'); // counted from the start again: 30 s
    t += 29_000;
    expect(b.backingOff('k')).toBe(true);
  });

  it('keeps each page on its own, and bounds its map', () => {
    let t = 0;
    const b = createRefreshBackoff({ now: () => t, limit: 2 });
    b.note('a');
    b.note('b');
    b.note('c'); // the oldest, a, goes
    expect(b.backingOff('a')).toBe(false);
    expect(b.backingOff('b')).toBe(true);
    expect(b.backingOff('c')).toBe(true);
  });
});

describe('logGate: a repeated refusal is logged at most once a window (review 20)', () => {
  it('lets one line through per window', () => {
    let t = 0;
    const gate = logGate(60_000, () => t);
    expect(gate()).toBe(true);
    expect(gate()).toBe(false);
    t = 59_999;
    expect(gate()).toBe(false);
    t = 60_000;
    expect(gate()).toBe(true);
  });
});
