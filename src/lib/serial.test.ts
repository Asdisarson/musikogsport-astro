import { describe, expect, it } from 'vitest';
import { createSerial } from './serial';

describe('createSerial', () => {
  it('runs calls one after another, in call order, even when one fails', async () => {
    const run = createSerial();
    const log: string[] = [];
    const task = (id: string, ms: number, fail = false) =>
      run(async () => {
        log.push(`start ${id}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`end ${id}`);
        if (fail) throw new Error(id);
        return id;
      });
    const a = task('a', 20, true);
    const b = task('b', 5);
    const c = task('c', 1);
    await expect(a).rejects.toThrow('a');
    expect(await b).toBe('b');
    expect(await c).toBe('c');
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});
