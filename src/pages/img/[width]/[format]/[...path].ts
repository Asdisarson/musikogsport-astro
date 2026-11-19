// /img/<width>/<avif|webp>/<version>/<uploads path>: a WordPress JPEG or PNG as AVIF or WebP at an allow-listed width (see
// lib/img lightSources). A width followed by `c` is the phone crop of the photo (lib/img phoneCropSources). Path only, no query string: a Cloudflare rule challenges query URLs for visitors outside
// Iceland. The result is kept on disk and served immutable; anything refused or failed answers with a short no-store
// status, and the page's <img> falls back to the original (public/img-fallback.js).
import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONCURRENCY, LightError, MAX_WAITING, cachePathFor, createGate, makeLight, parseLightRequest, readCached } from '../../../../lib/imgConvert';
import { LIGHT_VERSION } from '../../../../lib/img';
import { createLimiter } from '../../../../lib/rateLimit';
import { runtimeEnv, log } from '../../../../lib/logger';
import { visitorKey } from '../../../../lib/visitor';

export const prerender = false;

// Converted files: MOS_IMG_CACHE_DIR when set, else a folder in the system temp directory (lost on a reboot: the
// next request converts again).
// One folder per LIGHT_VERSION, so pictures made the old way are never served under a new URL.
const DIR = join(runtimeEnv('MOS_IMG_CACHE_DIR') || join(tmpdir(), 'mos-img'), LIGHT_VERSION);
const gate = createGate(CONCURRENCY, MAX_WAITING);
// Only cache misses count: a kept file costs nothing to serve. 60 conversions a minute per visitor.
const misses = createLimiter(60, 60_000);

const TYPE = { avif: 'image/avif', webp: 'image/webp' } as const;

function refuse(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET: APIRoute = async (ctx) => {
  const path = ctx.params.path ?? '';
  if (!path.startsWith(`${LIGHT_VERSION}/`)) return refuse(404); // an older page's URL: its <img> falls back to the original
  const req = parseLightRequest(ctx.params.width ?? '', ctx.params.format ?? '', path.slice(LIGHT_VERSION.length + 1));
  if (!req) return refuse(404);
  const headers = { 'Content-Type': TYPE[req.format], 'Cache-Control': 'public, max-age=31536000, immutable' };

  const kept = await readCached(cachePathFor(DIR, req.width, req.format, req.rel, req.crop));
  if (kept) return new Response(new Uint8Array(kept), { headers });

  if (!misses.take(visitorKey(ctx))) return refuse(429);
  try {
    const out = await makeLight(req, { origin: WP_INTERNAL_URL, dir: DIR, gate });
    return new Response(new Uint8Array(out.data), { headers });
  } catch (err) {
    const status = err instanceof LightError ? err.status : 503;
    if (status >= 500) log.warn('image not converted', { path: ctx.url.pathname, status, err });
    return refuse(status);
  }
};
