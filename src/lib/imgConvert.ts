// Light-image conversion for src/pages/img: a WordPress JPEG or PNG in the uploads folder, re-encoded as AVIF or WebP
// at one of the allow-listed widths, kept on disk. SERVER-ONLY (sharp, node:fs).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CROP_WIDTHS, LIGHT_WIDTHS, PHONE_CROP, originalUrl } from './img';
import { log } from './logger';

export type LightFormat = 'avif' | 'webp';
export interface LightRequest {
  width: number;
  format: LightFormat;
  /** The path under /wp-content/uploads/, e.g. 2026/04/a.jpg. */
  rel: string;
  /** The phone crop (lib/img PHONE_CROP): the URL's width carries a trailing `c`. */
  crop?: true;
}

const MAX_DEPTH = 6;
const MAX_PATH = 300;
const LIGHT_EXT = /\.(jpe?g|png)$/i;
// Browsers ask for a few images at once; sharp takes a core per encode. Two at a time keeps a page of misses from
// starving the storefront's own requests.
const CONCURRENCY = 2;
const MAX_WAITING = 40;
/** WordPress' originals are a few MB; a larger file is not a web image and is not fetched. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const FETCH_MS = 10_000;
const TOTAL_MS = 25_000;

/** Why a conversion did not produce an image: the HTTP status the route answers with. */
export class LightError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The request parts, validated; null for anything the endpoint does not serve. */
export function parseLightRequest(width: string, format: string, rel: string): LightRequest | null {
  const m = width.match(/^([1-9]\d*)(c?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const crop = m[2] === 'c';
  if (!((crop ? CROP_WIDTHS : LIGHT_WIDTHS) as readonly number[]).includes(w)) return null;
  if (format !== 'avif' && format !== 'webp') return null;
  if (!rel || rel.length > MAX_PATH || rel.startsWith('/') || /[\\%?#]|[\u0000-\u001f\u007f]/.test(rel)) return null;
  const parts = rel.split('/');
  if (parts.length > MAX_DEPTH) return null;
  for (const p of parts) if (!p || p === '.' || p === '..' || p.startsWith('.')) return null;
  if (!LIGHT_EXT.test(rel)) return null;
  return crop ? { width: w, format, rel, crop: true } : { width: w, format, rel };
}

/** Where a conversion is kept: one folder per width (cropped or not) and format, one file per path (hashed, so no name is unsafe). */
export function cachePathFor(dir: string, width: number, format: LightFormat, rel: string, crop = false): string {
  const name = createHash('sha256').update(rel).digest('hex').slice(0, 40);
  return join(dir, `${width}${crop ? 'c' : ''}-${format}`, `${name}.${format}`);
}

/** Re-encode a JPEG or PNG at `width` (never larger than the source), first cut to the phone crop when `crop`.
 *  Throws for any other input. */
export async function encodeLight(input: Buffer, width: number, format: LightFormat, crop = false): Promise<{ data: Buffer; contentType: string }> {
  // Loaded when first needed, as photoBgServer does: sharp is a native module the server should not load up front.
  const { default: sharp } = await import('sharp');
  const meta = await sharp(input, { limitInputPixels: 60_000_000 }).metadata();
  if (meta.format !== 'jpeg' && meta.format !== 'png') throw new LightError(404, 'not a jpeg or png');
  let upright = sharp(input, { limitInputPixels: 60_000_000 }).rotate();
  if (crop) {
    // the size as shown: EXIF orientations 5 to 8 lie on their side in the file
    const turned = (meta.orientation ?? 1) >= 5;
    const w = (turned ? meta.height : meta.width) ?? 0;
    const h = (turned ? meta.width : meta.height) ?? 0;
    if (!(w > 0 && h > 0)) throw new LightError(404, 'size unknown');
    const cropW = Math.min(w, Math.round((h * PHONE_CROP.w) / PHONE_CROP.h));
    const cropH = Math.min(h, Math.round((cropW * PHONE_CROP.h) / PHONE_CROP.w));
    upright = upright.extract({ left: Math.floor((w - cropW) / 2), top: 0, width: cropW, height: cropH });
  }
  const base = upright.resize({ width, withoutEnlargement: true });
  if (format === 'avif') {
    return { data: await base.avif({ quality: 62, effort: 4 }).toBuffer(), contentType: 'image/avif' };
  }
  return { data: await base.webp({ quality: 82 }).toBuffer(), contentType: 'image/webp' };
}

/** Bounded concurrency with a queue, and one shared run for callers that ask for the same key at the same time. */
export function createGate(concurrency: number, maxWaiting: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const inflight = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const shared = inflight.get(key) as Promise<T> | undefined;
      if (shared) return shared;
      // A 429 (not a 503): a full queue is the server asking the caller to slow down, not an outage, and the route logs
      // only 5xx.
      if (active >= concurrency && waiting.length >= maxWaiting) return Promise.reject(new LightError(429, 'queue full'));
      const p = (async () => {
        if (active < concurrency) active++;
        else await new Promise<void>((resolve) => waiting.push(resolve)); // the finishing run hands over its slot
        try {
          return await task();
        } finally {
          const next = waiting.shift();
          if (next) next();
          else active--;
        }
      })();
      inflight.set(key, p);
      const forget = () => {
        if (inflight.get(key) === p) inflight.delete(key);
      };
      p.then(forget, forget);
      return p;
    },
  };
}

/** The kept file's bytes, or null when there is none (or it cannot be read: the caller converts again). */
export async function readCached(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') log.warn('image cache not read', { err });
    return null;
  }
}

/** Written beside the target and renamed, so a reader never sees half a file. A failure is logged, not thrown. */
export async function writeCached(file: string, data: Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (err) {
    log.warn('image cache not written', { err });
  }
}

/** The original from WordPress: its uploads folder on `origin` (the storefront's own WordPress connection). */
async function fetchSource(origin: string, rel: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const url = `${origin.replace(/\/+$/, '')}/wp-content/uploads/${rel.split('/').map(encodeURIComponent).join('/')}`;
  // WordPress answers a missing upload with a redirect (to the site's own address), so redirects are not followed:
  // any 3xx means there is no such original here.
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_MS), redirect: 'manual' });
  if (res.status === 404 || (res.status >= 300 && res.status < 400)) {
    await res.body?.cancel();
    throw new LightError(404, 'no such original');
  }
  if (!res.ok) throw new LightError(502, `original answered ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_SOURCE_BYTES) throw new LightError(502, 'original too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_SOURCE_BYTES) throw new LightError(502, 'original too large');
  return buf;
}

export interface MakeDeps {
  origin: string;
  dir: string;
  gate: ReturnType<typeof createGate>;
  fetchImpl?: typeof fetch;
}

/** Convert one request, keep the result on disk, and return it. Throws LightError (or a plain Error for the queue). */
export async function makeLight(req: LightRequest, deps: MakeDeps): Promise<{ data: Buffer; contentType: string }> {
  const file = cachePathFor(deps.dir, req.width, req.format, req.rel, req.crop);
  const work = async () => {
    const source = await fetchSource(deps.origin, req.rel, deps.fetchImpl ?? fetch);
    const out = await encodeLight(source, req.width, req.format, req.crop);
    await writeCached(file, out.data);
    return out;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LightError(503, 'conversion timed out')), TOTAL_MS);
  });
  try {
    return await Promise.race([deps.gate.run(file, work), limit]);
  } finally {
    clearTimeout(timer);
  }
}

export interface MissDeps {
  /** Whether this visitor may start a conversion now (the per-visitor miss limit). */
  allowConvert: boolean;
  /** Starts the conversion (makeLight). Its promise may reject, and it may throw at once. */
  convert: () => Promise<unknown>;
  /** Logs a server-side failure (a status of 500 or more). */
  warn: (status: number, err: unknown) => void;
}

/** The answer to a picture that is not kept yet: a 302 to the original on the media host, at once, with no-store, so
 *  the visitor never waits for a conversion. Within the miss limit the conversion goes on in the background, and its
 *  failure is caught here so it is never an unhandled rejection. A refused or missing original and a full queue are
 *  quiet; the next visit gets the kept file or the same redirect. A server-side failure is logged. */
export function answerMiss(req: LightRequest, deps: MissDeps): Response {
  const target = originalUrl(req.rel);
  if (target === null) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (deps.allowConvert) {
    // the Promise constructor turns a throw at once into a rejection, so one catch covers both
    void new Promise<unknown>((resolve) => resolve(deps.convert())).catch((err: unknown) => {
      const status = err instanceof LightError ? err.status : 503;
      if (status >= 500) deps.warn(status, err);
    });
  }
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

export { CONCURRENCY, MAX_WAITING };
