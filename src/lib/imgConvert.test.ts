import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://musikogsport.is' }));
import { cachePathFor, createGate, encodeLight, LightError, makeLight, parseLightRequest, writeCached } from './imgConvert';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'img-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseLightRequest', () => {
  it('accepts a listed width, avif or webp, and a JPEG or PNG under the uploads folder', () => {
    expect(parseLightRequest('450', 'avif', '2026/04/IMG_3344-scaled-1.jpg')).toEqual({ width: 450, format: 'avif', rel: '2026/04/IMG_3344-scaled-1.jpg' });
    expect(parseLightRequest('2048', 'webp', '2026/04/a.PNG')?.width).toBe(2048);
  });

  it('refuses widths off the allow-list, other formats and other extensions', () => {
    expect(parseLightRequest('451', 'webp', '2026/04/a.jpg')).toBeNull();
    expect(parseLightRequest('0450', 'webp', '2026/04/a.jpg')).toBeNull();
    expect(parseLightRequest('450', 'gif', '2026/04/a.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', '2026/04/a.webp')).toBeNull();
    expect(parseLightRequest('450', 'webp', '2026/04/a.php')).toBeNull();
  });

  it('refuses traversal, absolute, encoded, hidden and over-deep paths', () => {
    expect(parseLightRequest('450', 'webp', '../../wp-config.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', '2026/../../a.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', '/etc/a.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', '2026/%2e%2e/a.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', '2026\\a.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', '.hidden/a.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', 'a/b/c/d/e/f/g/h.jpg')).toBeNull();
    expect(parseLightRequest('450', 'webp', '2026/a\nb.jpg')).toBeNull();
  });
});

describe('cachePathFor', () => {
  it('is stable per width, format and path, and stays inside the cache directory', () => {
    const a = cachePathFor(dir, 450, 'avif', '2026/04/a.jpg');
    expect(a).toBe(cachePathFor(dir, 450, 'avif', '2026/04/a.jpg'));
    expect(a).not.toBe(cachePathFor(dir, 450, 'webp', '2026/04/a.jpg'));
    expect(a.startsWith(dir + '/')).toBe(true);
    expect(a.endsWith('.avif')).toBe(true);
  });
});

describe('encodeLight', () => {
  let png: Buffer;
  beforeAll(async () => {
    png = await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#808080' } }).png().toBuffer();
  });

  it('encodes AVIF and WebP at the asked width', async () => {
    const avif = await encodeLight(png, 450, 'avif');
    expect(avif.contentType).toBe('image/avif');
    expect(avif.data.subarray(4, 12).toString('latin1')).toContain('ftyp');
    const meta = await sharp(avif.data).metadata();
    expect(meta.width).toBe(450);

    const webp = await encodeLight(png, 720, 'webp');
    expect(webp.contentType).toBe('image/webp');
    expect(webp.data.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect((await sharp(webp.data).metadata()).width).toBe(720);
  });

  it('never enlarges: a source narrower than the width keeps its own width', async () => {
    const out = await encodeLight(png, 1536, 'webp');
    expect((await sharp(out.data).metadata()).width).toBe(1000);
  });

  it('refuses a source that is not a JPEG or PNG', async () => {
    const webp = await sharp(png).webp().toBuffer();
    await expect(encodeLight(webp, 450, 'avif')).rejects.toThrow();
  });
});

describe('createGate', () => {
  it('runs at most the given number at once and queues the rest in order', async () => {
    const gate = createGate(2, 10);
    let running = 0;
    let peak = 0;
    const task = (n: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n;
    };
    const out = await Promise.all([1, 2, 3, 4, 5].map((n) => gate.run(`k${n}`, task(n))));
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('shares one run between callers with the same key while it is in flight', async () => {
    const gate = createGate(2, 10);
    let calls = 0;
    const work = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return 'x';
    };
    const [a, b] = await Promise.all([gate.run('same', work), gate.run('same', work)]);
    expect([a, b]).toEqual(['x', 'x']);
    expect(calls).toBe(1);
  });

  it('refuses at once when the queue is full', async () => {
    const gate = createGate(1, 1);
    const hold = new Promise((r) => setTimeout(r, 20));
    const first = gate.run('a', () => hold);
    const second = gate.run('b', async () => 'b');
    await expect(gate.run('c', async () => 'c')).rejects.toThrow('queue full');
    await Promise.all([first, second]);
  });

  it('keeps going after a failed task', async () => {
    const gate = createGate(1, 5);
    await expect(gate.run('bad', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await gate.run('good', async () => 'ok')).toBe('ok');
  });
});

describe('writeCached', () => {
  it('writes the file whole, creating its folder, and leaves no temporary file behind', async () => {
    const file = cachePathFor(dir, 360, 'webp', 'sub/x.jpg');
    await writeCached(file, Buffer.from('payload'));
    expect((await readFile(file)).toString()).toBe('payload');
    const { readdir } = await import('node:fs/promises');
    const names = await readdir(join(dir, '360-webp'));
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false);
  });
});

describe('makeLight', () => {
  const req = { width: 450, format: 'avif' as const, rel: '2026/04/a.png' };
  let source: Buffer;
  beforeAll(async () => {
    source = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#303030' } }).png().toBuffer();
  });

  it('converts a fetched original and keeps the result on disk', async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(new Uint8Array(source), { status: 200 }));
    const gate = createGate(2, 5);
    const out = await makeLight(req, { origin: 'http://wp.test', dir, gate, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.contentType).toBe('image/avif');
    expect(fetchImpl.mock.calls[0][0]).toBe('http://wp.test/wp-content/uploads/2026/04/a.png');
    expect((await readFile(cachePathFor(dir, 450, 'avif', req.rel))).length).toBe(out.data.length);
  });

  it('answers a missing original (404 or a redirect from WordPress) with 404, not a server error', async () => {
    const gate = createGate(2, 5);
    for (const status of [404, 302]) {
      const fetchImpl = (async () => new Response(null, { status, headers: status === 302 ? { Location: 'http://x.test/' } : {} })) as unknown as typeof fetch;
      await expect(makeLight({ ...req, rel: `2026/04/missing${status}.png` }, { origin: 'http://wp.test', dir, gate, fetchImpl })).rejects.toMatchObject({ status: 404 });
    }
  });

  it('refuses a fetched file that is not a JPEG or PNG', async () => {
    const webp = await sharp(source).webp().toBuffer();
    const fetchImpl = (async () => new Response(new Uint8Array(webp), { status: 200 })) as unknown as typeof fetch;
    const err = await makeLight({ ...req, rel: '2026/04/really.png' }, { origin: 'http://wp.test', dir, gate: createGate(2, 5), fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LightError);
    expect((err as LightError).status).toBe(404);
  });
});
