// Read-only client for WordPress content pages (wp/v2/pages). SERVER-ONLY.
// Used to surface long-form, non-fact-sensitive WP content (e.g. the size guide)
// in the headless storefront. Legal/fact-sensitive pages are authored natively.
import { WP_INTERNAL_URL } from 'astro:env/server';
import { sanitizeHtml } from './sanitize';
import { stripShortcodes } from './decode';
import { rewriteMediaHosts } from './img';

export interface WpPage {
  title: string;
  /** Sanitised, shortcode-stripped, media-host-rewritten HTML, safe for set:html. */
  html: string;
  modified?: string;
}

interface WpPageRaw {
  title?: { rendered?: string };
  content?: { rendered?: string };
  modified?: string;
}

/** Fetch a published WP page by slug. Returns null if missing or WP is unreachable. */
export async function getWpPageBySlug(slug: string): Promise<WpPage | null> {
  try {
    const url = `${WP_INTERNAL_URL}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&status=publish&_fields=title,content,modified`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as WpPageRaw[];
    const page = data?.[0];
    if (!page) return null;
    return {
      title: page.title?.rendered ?? '',
      html: sanitizeHtml(rewriteMediaHosts(stripShortcodes(page.content?.rendered ?? ''))),
      modified: page.modified,
    };
  } catch {
    return null;
  }
}
