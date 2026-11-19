import { describe, expect, it } from 'vitest';
import { coalesce, coalesceSize } from './liveCoalesce';

describe('coalesce', () => {
  it('shares one load between simultaneous callers for the same key', async () => {
    let calls = 0;
    const load = () => new Promise<number>((r) => setTimeout(() => r(++calls), 5));
    const [a, b] = await Promise.all([coalesce('k', load), coalesce('k', load)]);
    expect(calls).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
  it('does not keep the answer: a later call loads again', async () => {
    let calls = 0;
    const load = async () => ++calls;
    await coalesce('k2', load);
    await coalesce('k2', load);
    expect(calls).toBe(2);
    expect(coalesceSize()).toBe(0);
  });
  it('different keys do not share', async () => {
    let calls = 0;
    const load = async () => ++calls;
    await Promise.all([coalesce('a', load), coalesce('b', load)]);
    expect(calls).toBe(2);
  });
  it('a failed load is passed to every caller and then forgotten', async () => {
    const fail = () => Promise.reject(new Error('down'));
    await expect(Promise.all([coalesce('f', fail), coalesce('f', fail)])).rejects.toThrow('down');
    expect(coalesceSize()).toBe(0);
    await expect(coalesce('f', async () => 3)).resolves.toBe(3);
  });
});
