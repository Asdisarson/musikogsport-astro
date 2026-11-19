import { describe, expect, it } from 'vitest';
import { buildIdFrom } from './shellRuntime';

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
