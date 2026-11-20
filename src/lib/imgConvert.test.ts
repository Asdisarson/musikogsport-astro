import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://musikogsport.is' }));
import { answerMiss, cachePathFor, createGate, encodeLight, LightError, makeLight, parseLightRequest, writeCached } from './imgConvert';

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

describe('parseLightRequest: the phone crop', () => {
  it('reads a width followed by c as the phone crop of that width', () => {
    expect(parseLightRequest('720c', 'avif', '2026/04/a.jpg')).toEqual({ width: 720, format: 'avif', rel: '2026/04/a.jpg', crop: true });
    expect(parseLightRequest('720', 'avif', '2026/04/a.jpg')?.crop).toBeUndefined();
  });

  it('refuses any other suffix, and crop widths off the list', () => {
    expect(parseLightRequest('720x', 'avif', '2026/04/a.jpg')).toBeNull();
    expect(parseLightRequest('720cc', 'avif', '2026/04/a.jpg')).toBeNull();
    expect(parseLightRequest('c', 'avif', '2026/04/a.jpg')).toBeNull();
    expect(parseLightRequest('721c', 'avif', '2026/04/a.jpg')).toBeNull();
    expect(parseLightRequest('2048c', 'avif', '2026/04/a.jpg')).toBeNull();
  });
});

describe('cachePathFor', () => {
  it('keeps a cropped picture apart from the uncropped one', () => {
    expect(cachePathFor(dir, 720, 'avif', '2026/04/a.jpg', true)).not.toBe(cachePathFor(dir, 720, 'avif', '2026/04/a.jpg'));
  });

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

  it('crops for a phone: the top, centred, 5:6, then sized to the asked width', async () => {
    // left third red, middle green, right third blue; 1800x600 gives a 500x600 crop out of the green middle
    const strip = (c: string) => sharp({ create: { width: 600, height: 600, channels: 3, background: c } }).png().toBuffer();
    const wide = await sharp({ create: { width: 1800, height: 600, channels: 3, background: '#000' } })
      .composite([{ input: await strip('#ff0000'), left: 0, top: 0 }, { input: await strip('#00ff00'), left: 600, top: 0 }, { input: await strip('#0000ff'), left: 1200, top: 0 }])
      .png().toBuffer();
    const out = await encodeLight(wide, 360, 'webp', true);
    const img = sharp(out.data);
    const meta = await img.metadata();
    expect([meta.width, meta.height]).toEqual([360, 432]);
    const { data } = await img.raw().toBuffer({ resolveWithObject: true });
    expect(data[1]).toBeGreaterThan(200); // green at the left edge: the red third is cut away
    expect(data[0]).toBeLessThan(60);
  });

  it('never enlarges a crop: a short source keeps its own cropped size', async () => {
    const out = await encodeLight(png, 1080, 'webp', true); // 1000x800 -> 667x800
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([667, 800]);
  });

  it('leaves a photo narrower than 5:6 at its full width, cut from the top', async () => {
    const tall = await sharp({ create: { width: 400, height: 1000, channels: 3, background: '#808080' } }).png().toBuffer();
    const meta = await sharp((await encodeLight(tall, 360, 'webp', true)).data).metadata();
    expect([meta.width, meta.height]).toEqual([360, 432]);
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
    // a full queue is the visitor's "slow down" (429), as DEPLOY.md says, not an outage (503)
    const refused = await gate.run('d', async () => 'd').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(LightError);
    expect((refused as LightError).status).toBe(429);
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

describe('answerMiss', () => {
  // a phone crop of a photo whose name needs encoding: the redirect goes to the uncropped original, encoded
  const req = { width: 1080, format: 'avif' as const, rel: '2026/10/a b.jpg', crop: true as const };
  const target = 'https://musikogsport.is/wp-content/uploads/2026/10/a%20b.jpg';
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const ok = async () => ({ data: Buffer.alloc(1), contentType: 'image/avif' });
  const expectRedirect = (res: Response) => {
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(target);
    expect(res.headers.get('cache-control')).toBe('no-store');
  };

  it('within the miss limit: answers the original at once and starts one conversion', async () => {
    const convert = vi.fn(ok);
    const warn = vi.fn();
    expectRedirect(answerMiss(req, { allowConvert: true, convert, warn }));
    expect(convert).toHaveBeenCalledTimes(1);
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });

  it('over the miss limit: answers the same redirect and starts no conversion', async () => {
    const convert = vi.fn(ok);
    expectRedirect(answerMiss(req, { allowConvert: false, convert, warn: vi.fn() }));
    expect(convert).not.toHaveBeenCalled();
  });

  it('a refused or missing original and a full queue are quiet', async () => {
    for (const status of [404, 429]) {
      const warn = vi.fn();
      answerMiss(req, { allowConvert: true, convert: async () => { throw new LightError(status, 'x'); }, warn });
      await flush();
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it('a server-side failure is logged once with its status', async () => {
    const warn = vi.fn();
    answerMiss(req, { allowConvert: true, convert: async () => { throw new LightError(502, 'original answered 500'); }, warn });
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(502);
  });

  it('a plain error is logged as 503, and a conversion that throws at once is caught too', async () => {
    const warn = vi.fn();
    answerMiss(req, { allowConvert: true, convert: async () => { throw new Error('sharp died'); }, warn });
    answerMiss(req, { allowConvert: true, convert: () => { throw new Error('sync'); }, warn });
    await flush();
    expect(warn.mock.calls.map((c) => c[0])).toEqual([503, 503]);
  });

  it('a path that could leave the uploads folder answers 404 and starts nothing', () => {
    const convert = vi.fn(ok);
    expect(answerMiss({ ...req, rel: '2026/../x.jpg' }, { allowConvert: true, convert, warn: vi.fn() }).status).toBe(404);
    expect(convert).not.toHaveBeenCalled();
  });
});
