// sweepSnapshot.ts: the sitemap sweep's copy on disk, so a newly started server process answers from it.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSnapshot, writeSnapshot } from './sweepSnapshot';

describe('sweepSnapshot', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mos-snap-test-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('reads back what was written, with the time it was written', async () => {
    await writeSnapshot('products', [{ slug: 'a' }], { dir, now: () => 1234 });
    expect(await readSnapshot('products', { dir, now: () => 5000 })).toEqual({ at: 1234, val: [{ slug: 'a' }] });
  });

  it('nothing written: null', async () => {
    expect(await readSnapshot('products', { dir })).toBeNull();
  });

  it('a damaged or foreign file is null, not an error', async () => {
    await writeFile(join(dir, 'mos-sweep-products.json'), '{"at": "soon", "val": 1');
    expect(await readSnapshot('products', { dir })).toBeNull();
    await writeFile(join(dir, 'mos-sweep-products.json'), JSON.stringify({ at: 'soon', val: [] }));
    expect(await readSnapshot('products', { dir })).toBeNull();
  });

  it('a snapshot older than a week is not used', async () => {
    await writeSnapshot('products', ['x'], { dir, now: () => 0 });
    expect(await readSnapshot('products', { dir, now: () => 8 * 24 * 60 * 60 * 1000 })).toBeNull();
  });

  it('a directory that cannot be written is logged, not thrown', async () => {
    await expect(writeSnapshot('products', ['x'], { dir: join(dir, 'missing', 'deeper') })).resolves.toBeUndefined();
  });

  it('leaves no half-written file behind and keeps the name inside the directory', async () => {
    await writeSnapshot('../escape', ['x'], { dir });
    expect(await readSnapshot('../escape', { dir })).toEqual({ at: expect.any(Number), val: ['x'] });
    expect(JSON.parse(await readFile(join(dir, 'mos-sweep-escape.json'), 'utf8')).val).toEqual(['x']);
  });
});
