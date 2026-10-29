// WordPress content pages (live's /hafa-samband/, /skilmalar/, /opnunartimi/, /staerdir/ …) —
// SERVER-ONLY. Raw content comes from mos/v1/page/<slug> and is parsed from WPBakery shortcodes
// (see wpbakery.ts). Cached in-process per slug: a page for a minute, a missing slug for 15 seconds, in
// separate bounded maps (any /<slug>/ URL reaches this, and junk slugs must not push real pages out).
// null when missing; WpUnavailable when WordPress can't answer and there is no earlier copy to serve.
import { WP_INTERNAL_URL } from 'astro:env/server';
import { createTtlMap } from './cache';
import { parseWpBakery, type Row } from './wpbakery';
import { upstreamGet } from './upstream';
import { log } from './logger';

export interface WpPage {
  id: number;
  slug: string;
  title: string;
  rows: Row[];
}

const PAGE_TTL_MS = 60 * 1000;
const MISSING_TTL_MS = 15 * 1000;
/** A failed load is remembered this long per slug: the stale copy (or WpUnavailable) without asking again. */
const FAILED_TTL_MS = 15 * 1000;
const clock = () => Date.now();
const pages = createTtlMap<string, WpPage>(200, clock);
const missing = createTtlMap<string, true>(500, clock);
const failed = createTtlMap<string, true>(200, clock);
/** Loads in flight by slug: concurrent cold requests for one page share a call. */
const inflight = new Map<string, Promise<WpPage | null>>();

export class WpUnavailable extends Error {}

export async function getWpPage(slug: string): Promise<WpPage | null> {
  const hit = pages.get(slug);
  if (hit?.fresh) return hit.value;
  if (missing.get(slug)?.fresh) return null;
  if (failed.get(slug)?.fresh) {
    if (hit) return hit.value;
    throw new WpUnavailable(`page ${slug} unavailable`);
  }
  let load = inflight.get(slug);
  if (!load) {
    load = fetchPage(slug).finally(() => inflight.delete(slug));
    inflight.set(slug, load);
  }
  try {
    return await load;
  } catch {
    if (hit) return hit.value; // stale beats an error page
    throw new WpUnavailable(`page ${slug} unavailable`);
  }
}

async function fetchPage(slug: string): Promise<WpPage | null> {
  try {
    const res = await upstreamGet(`${WP_INTERNAL_URL}/wp-json/mos/v1/page/${encodeURIComponent(slug)}`, 5000);
    if (res.status === 404) {
      missing.set(slug, true, MISSING_TTL_MS);
      return null;
    }
    if (!res.ok) throw new Error(`page ${slug} -> ${res.status}`);
    const data = (await res.json()) as { id: number; slug: string; title: string; content: string };
    const value: WpPage = { id: data.id, slug: data.slug, title: data.title, rows: parseWpBakery(data.content) };
    pages.set(slug, value, PAGE_TTL_MS);
    return value;
  } catch (err) {
    log.warn('[wp-page] load failed', { slug, err });
    failed.set(slug, true, FAILED_TTL_MS);
    throw err;
  }
}
