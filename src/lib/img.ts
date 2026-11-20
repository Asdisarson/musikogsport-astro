// Product image helpers. The local WP media library is mostly missing on disk,
// so we rewrite local Woo upload URLs to the media host (same /wp-content/uploads/
// paths, verified to 200 on production). The placeholder remains the final
// fallback (public/img-fallback.js) for images missing even there. Client-safe (CartParts uses it).
import { MOS_MEDIA_BASE_URL } from 'astro:env/client';
import type { WooImage } from './types';

export const PLACEHOLDER = '/placeholder.svg';

const DEFAULT_MEDIA_BASE = 'https://musikogsport.is';

/** An http(s) origin-ish base with no trailing slash, else production's. */
export function normaliseMediaBase(value: string | undefined): string {
  const v = (value ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+/i.test(v) ? v : DEFAULT_MEDIA_BASE;
}

// The host that serves the real uploaded media: MOS_MEDIA_BASE_URL (build time; WordPress's public origin once the
// apex points at the storefront), default https://musikogsport.is. photoBg samples photos from this host only.
export const MEDIA_BASE_URL = normaliseMediaBase(MOS_MEDIA_BASE_URL);

/** Rewrite a local Woo media URL (localhost / 127.0.0.1) to the media host. */
export function mediaUrl(src: string | null | undefined): string {
  if (!src) return '';
  return src.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i, MEDIA_BASE_URL);
}

/** Rewrite every local Woo media host inside an HTML blob (e.g. a WP page body). */
export function rewriteMediaHosts(html: string): string {
  return html.replace(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi, MEDIA_BASE_URL);
}

/** A WordPress `srcset` with every candidate rewritten like mediaUrl, or '' when there is nothing to choose from
 *  (WP sends `false` for an image without sub-sizes; a lone URL has no width descriptor). */
export function mediaSrcset(srcset: string | false | null | undefined): string {
  if (!srcset || !/\s\d+w\b/.test(srcset)) return '';
  return rewriteMediaHosts(srcset.trim());
}

/** The src of a card drawn from an uncropped srcset: the smallest candidate at least `min` wide (a modest size the
 *  browser can also fall back to), else `fallback`. Candidates keep the photo's own shape, unlike WP's square crop. */
export function modestCandidate(srcset: string, fallback: string, min = 576): string {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const m = part.trim().match(/^(\S+)\s+(\d+)w$/);
    if (!m) continue;
    const w = Number(m[2]);
    if (w >= min && (!best || w < best.w)) best = { url: m[1], w };
  }
  return best ? best.url : fallback;
}

/** Widths the light-image endpoint (src/pages/img) serves, in CSS px: WordPress' sub-sizes and the card and hero
 *  display sizes. A candidate asks for the next width UP from its own, and the endpoint never enlarges, so the light
 *  picture keeps every pixel of its source; the srcset describes it by the source's own width. */
export const LIGHT_WIDTHS = [360, 450, 720, 1080, 1536, 2048] as const;

/** Part of every light-image URL and of the kept files' folder. The pictures are served `immutable` for a year, so
 *  a change to how they are made (quality, sizing) needs new URLs: bump this. */
export const LIGHT_VERSION = 'v2';

const UPLOADS = '/wp-content/uploads/';
const JPEG_OR_PNG = /\.(jpe?g|png)$/i;

/** The uploads-relative path of a JPEG or PNG under /wp-content/uploads/ with no query, else null. */
function lightRel(src: string): string | null {
  let u: URL;
  try {
    u = new URL(src, 'https://storefront.invalid');
  } catch {
    return null;
  }
  if (u.search || u.hash || !u.pathname.startsWith(UPLOADS) || !JPEG_OR_PNG.test(u.pathname)) return null;
  return u.pathname.slice(UPLOADS.length);
}

/** AVIF and WebP `srcset`s on the storefront's own /img/<width>/<format>/<uploads path> endpoint, for the JPEG and
 *  PNG candidates of a WordPress srcset (or of `src` at `width` when there is no srcset). WebP and AVIF originals
 *  are left out, so nothing is returned for them. Null when there is nothing to convert. Client-safe. */
export function lightSources(input: { src?: string | null; srcset?: string | false | null; width?: number }): { avif: string; webp: string } | null {
  const { src, srcset, width } = input;
  const found: { rel: string; w: number; descriptor: boolean }[] = [];
  if (srcset && /\s\d+w\b/.test(srcset)) {
    for (const part of srcset.split(',')) {
      const m = part.trim().match(/^(\S+)\s+(\d+)w$/);
      const rel = m ? lightRel(m[1]) : null;
      if (m && rel !== null) found.push({ rel, w: Number(m[2]), descriptor: true });
    }
  } else if (src && width && width > 0) {
    const rel = lightRel(src);
    if (rel !== null) found.push({ rel, w: width, descriptor: false });
  }
  // Each candidate asks for the smallest allowed width that holds it (the largest, for a wider one, which the
  // endpoint then scales down to). A candidate under the smallest width is not worth a source.
  const max = LIGHT_WIDTHS[LIGHT_WIDTHS.length - 1];
  const seen = new Set<string>();
  const pick: { rel: string; w: number; ask: number; descriptor: boolean }[] = [];
  for (const f of found.sort((a, b) => a.w - b.w)) {
    if (f.w < LIGHT_WIDTHS[0]) continue;
    const ask = LIGHT_WIDTHS.find((a) => a >= f.w) ?? max;
    const w = Math.min(f.w, max);
    if (seen.has(`${ask}/${f.rel}`)) continue;
    seen.add(`${ask}/${f.rel}`);
    pick.push({ rel: f.rel, w, ask, descriptor: f.descriptor });
  }
  if (pick.length === 0) return null;
  const build = (format: 'avif' | 'webp') =>
    pick.map((p) => `/img/${p.ask}/${format}/${LIGHT_VERSION}/${p.rel}${p.descriptor ? ` ${p.w}w` : ''}`).join(', ');
  return { avif: build('avif'), webp: build('webp') };
}

/** The phone crop (src/pages/img, a width followed by `c`): the top of the photo, centred, at 5:6. The home hero on a
 *  phone is a tall box that shows only the middle of its wide photo (global.css `.hero`: min(585px, 150vw) high, cover,
 *  top centre), so the rest is never downloaded. 5:6 is that box at 480px wide, the widest screen that gets the crop;
 *  a narrower screen cuts further in from the same crop. */
export const PHONE_CROP = { w: 5, h: 6, maxScreen: 480 } as const;
/** The widths a crop is served at. */
export const CROP_WIDTHS = [360, 450, 720, 1080] as const;

/** The crop's width for a photo of this height. */
export const phoneCropWidth = (height: number): number => Math.round((height * PHONE_CROP.w) / PHONE_CROP.h);

/** AVIF and WebP srcsets of the phone crop of one JPEG or PNG, with the `media` and `sizes` they are for; null when
 *  the photo is not wider than the crop, too small, of unknown size, or not a media-library JPEG or PNG. Client-safe. */
export function phoneCropSources(input: { src?: string | null; width?: number; height?: number }): { avif: string; webp: string; media: string; sizes: string } | null {
  const { src, width = 0, height = 0 } = input;
  const rel = src ? lightRel(src) : null;
  if (rel === null || !(width > 0 && height > 0)) return null;
  const full = phoneCropWidth(height);
  if (width <= full || full < CROP_WIDTHS[0]) return null;
  // every listed width the crop fills, then the crop at its own width (asked for by the next width up: never enlarged)
  const pick: { ask: number; w: number }[] = CROP_WIDTHS.filter((w) => w <= full).map((w) => ({ ask: w, w }));
  const up = CROP_WIDTHS.find((w) => w > full);
  if (up !== undefined && !pick.some((p) => p.w === full)) pick.push({ ask: up, w: full });
  const build = (format: 'avif' | 'webp') => pick.map((p) => `/img/${p.ask}c/${format}/${LIGHT_VERSION}/${rel} ${p.w}w`).join(', ');
  // the width it is drawn at: the hero's height times 5:6
  const drawn = (h: number) => (h * PHONE_CROP.w) / PHONE_CROP.h;
  return { avif: build('avif'), webp: build('webp'), media: `(max-width: ${PHONE_CROP.maxScreen}px)`, sizes: `min(${Math.round(drawn(585))}px, ${Math.round(drawn(150))}vw)` };
}

/** The original on the media host for an uploads-relative path, where a visitor is sent while its light picture is
 *  being made (src/pages/img answers 302 with no-store). Each segment is encoded, so no character ends the path or
 *  starts a query; a `.`, `..` or empty segment could leave the uploads folder, so it is refused (null). `rel` comes
 *  from parseLightRequest already; the check here is for whatever calls this next. */
export function originalUrl(rel: string, base: string = MEDIA_BASE_URL): string | null {
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  return `${base}${UPLOADS}${segments.map(encodeURIComponent).join('/')}`;
}

interface HasImages {
  images?: WooImage[];
  name?: string;
}

/** First image src (rewritten to production, or placeholder), its srcset (mediaSrcset; '' without sub-sizes) and
 *  a sensible alt. The src stays the fallback for a failed candidate (public/img-fallback.js). */
/** The width the product page's main photo is asked for when the purchase island swaps in a variation's photo:
 *  one candidate, enough for the 532px tile on a 2x screen. */
export const MAIN_SWAP_WIDTH = 1080;

/** The <source> srcsets for the product page's main photo after a swap to `src`, or null when that photo gets none
 *  (already WebP/AVIF, or not a media-library file): the caller then removes the old sources, or the browser would
 *  keep showing the previous photo's. */
export function mainSources(src: string | null | undefined): { avif: string; webp: string } | null {
  return lightSources({ src, width: MAIN_SWAP_WIDTH });
}

export function productImage(p: HasImages): { src: string; srcset: string; alt: string } {
  const first = p.images?.[0];
  return {
    src: first?.src ? mediaUrl(first.src) : PLACEHOLDER,
    srcset: mediaSrcset(first?.srcset),
    alt: first?.alt || p.name || '',
  };
}
