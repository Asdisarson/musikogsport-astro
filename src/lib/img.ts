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

interface HasImages {
  images?: WooImage[];
  name?: string;
}

/** First image src (rewritten to production, or placeholder), its srcset (mediaSrcset; '' without sub-sizes) and
 *  a sensible alt. The src stays the fallback for a failed candidate (public/img-fallback.js). */
export function productImage(p: HasImages): { src: string; srcset: string; alt: string } {
  const first = p.images?.[0];
  return {
    src: first?.src ? mediaUrl(first.src) : PLACEHOLDER,
    srcset: mediaSrcset(first?.srcset),
    alt: first?.alt || p.name || '',
  };
}
