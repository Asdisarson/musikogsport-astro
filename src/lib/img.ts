// Product image helpers. The local WP media library is mostly missing on disk,
// so we rewrite local Woo upload URLs to the production site (same
// /wp-content/uploads/ paths, verified to 200 there). The placeholder remains
// the final fallback (via onerror) for images missing even on production.
import type { WooImage } from './types';

export const PLACEHOLDER = '/placeholder.svg';

// Production host that serves the real uploaded media.
const MEDIA_BASE_URL = 'https://musikogsport.is';

/** Rewrite a local Woo media URL (localhost / 127.0.0.1) to the production host. */
export function mediaUrl(src: string | null | undefined): string {
  if (!src) return '';
  return src.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i, MEDIA_BASE_URL);
}

/** Rewrite every local Woo media host inside an HTML blob (e.g. a WP page body). */
export function rewriteMediaHosts(html: string): string {
  return html.replace(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi, MEDIA_BASE_URL);
}

interface HasImages {
  images?: WooImage[];
  name?: string;
}

/** First image src (rewritten to production, or placeholder) + a sensible alt. */
export function productImage(p: HasImages): { src: string; alt: string } {
  const first = p.images?.[0];
  return {
    src: first?.src ? mediaUrl(first.src) : PLACEHOLDER,
    alt: first?.alt || p.name || '',
  };
}
