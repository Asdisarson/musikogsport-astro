// /img/<width>/<avif|webp>/<version>/<uploads path>: a WordPress JPEG or PNG as AVIF or WebP at an allow-listed width (see
// lib/img lightSources). A width followed by `c` is the phone crop of the photo (lib/img phoneCropSources). Path only, no query string: a Cloudflare rule challenges query URLs for visitors outside
// Iceland. A kept file is served immutable. A miss never waits for the conversion: the visitor gets a 302 to the
// original on the media host with no-store (so neither browser nor Cloudflare keeps the redirect), and the conversion
// runs in the background through the gate, so the next request gets the kept file. A visitor over the miss limit gets
// the same 302 with no conversion started. The phone crop redirects to the uncropped original too: the page draws it
// with object-fit cover from the top centre, which shows the same region. Anything refused answers with a short
// no-store status (404 for a path this endpoint does not serve); the page's <img> falls back to the original
// (public/img-fallback.js) when a picture cannot be shown.
import type { APIRoute } from 'astro';
import { WP_INTERNAL_URL } from 'astro:env/server';
import { answerMiss, cachePathFor, makeLight, parseLightRequest, readCached } from '../../../../lib/imgConvert';
import { LIGHT_VERSION } from '../../../../lib/img';
import { IMG_DIR, visitorGate } from '../../../../lib/imgRuntime';
import { createLimiter } from '../../../../lib/rateLimit';
import { log } from '../../../../lib/logger';
import { visitorKey } from '../../../../lib/visitor';

export const prerender = false;

// The cache folder and the visitors' conversion gate are process-wide (src/lib/imgRuntime.ts), shared with the nightly warm-up's
// own gate; see there for MOS_IMG_CACHE_DIR.
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

  const kept = await readCached(cachePathFor(IMG_DIR, req.width, req.format, req.rel, req.crop));
  if (kept) return new Response(new Uint8Array(kept), { headers });

  // A miss does not wait for the conversion: see answerMiss.
  return answerMiss(req, {
    allowConvert: misses.take(visitorKey(ctx)),
    convert: () => makeLight(req, { origin: WP_INTERNAL_URL, dir: IMG_DIR, gate: visitorGate }),
    warn: (status, err) => log.warn('image not converted', { path: ctx.url.pathname, status, err }),
  });
};
