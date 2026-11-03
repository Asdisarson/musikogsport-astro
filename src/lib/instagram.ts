// The home page's "Músík og Sport á Instagram" row (mos/v1/instagram, wp-mu-plugins/mos-instagram.php) — SERVER-ONLY.
// WordPress fetches the posts and mirrors their pictures; this only reads its answer, cached in-process for ten
// minutes (WordPress itself refreshes at most hourly), last good value served on failure. No posts — not connected,
// Instagram down before anything was fetched, or WordPress unreachable — is not an error: the row becomes a
// "Fylgdu okkur" banner.
import { WP_INTERNAL_URL } from 'astro:env/server';
import { createCachedLoader } from './cache';
import { upstreamJson } from './upstream';

export interface InstagramPost {
  id: string;
  /** The post on www.instagram.com (/p/, /reel/ or /tv/). */
  href: string;
  /** One plain line, already cut to an excerpt by WordPress; may be empty. */
  caption: string;
  image: { url: string; width: number; height: number; alt: string };
}

export interface InstagramFeed {
  posts: InstagramPost[];
}

const URL_INSTAGRAM = `${WP_INTERNAL_URL}/wp-json/mos/v1/instagram`;
const MAX_POSTS = 12;
const POST_HREF = /^https:\/\/www\.instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]{1,64}\/?$/;
const IMAGE_URL = /^https?:\/\/[^/\s]+\/\S*$/i;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The answer in the shape the home page expects whatever arrives: only posts with an Instagram post link and an
 *  http(s) picture (dropped, never repaired), at most 12, once each. The picture URL passes through unchanged, like
 *  the front page's (frontPage.ts): the mirrored files exist only on the WordPress that answered. Pure. */
export function normaliseInstagram(raw: unknown): InstagramFeed {
  const items = obj(raw).posts;
  const posts: InstagramPost[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(items) ? items : []) {
    if (posts.length >= MAX_POSTS) break;
    const p = obj(item);
    const id = str(p.id);
    const href = str(p.href);
    const image = obj(p.image);
    const url = str(image.url);
    if (!id || seen.has(id) || !POST_HREF.test(href) || !IMAGE_URL.test(url)) continue;
    seen.add(id);
    posts.push({
      id,
      href,
      caption: str(p.caption),
      image: { url, width: Number(image.width) || 0, height: Number(image.height) || 0, alt: str(image.alt) || 'Mynd af Instagram' },
    });
  }
  return { posts };
}

async function fetchInstagram(): Promise<InstagramFeed> {
  return normaliseInstagram(await upstreamJson<unknown>(URL_INSTAGRAM, 4000, 'instagram'));
}

// Ten minutes fresh, then served stale while one refresh runs; an outage is retried once a minute at most.
const load = createCachedLoader({ load: fetchInstagram, ttlMs: 10 * 60 * 1000, failMemoMs: 60 * 1000 });

/** The posts to show; empty when there are none to show (the row falls back to its follow banner). Never throws. */
export async function loadInstagram(): Promise<InstagramPost[]> {
  try {
    return (await load()).value?.posts ?? [];
  } catch {
    return [];
  }
}
