import type { APIRoute } from 'astro';
import { listAllProductSlugs, listAllCategorySlugs } from '../lib/woo';

export const prerender = false;

// Static, indexable routes (cart/checkout/api are intentionally excluded). `/leita` is also
// excluded: robots.txt Disallows it (thin search-results pages), so listing it in the sitemap
// would only produce a "Submitted URL blocked by robots.txt" conflict in Search Console.
const STATIC_PATHS = [
  '/',
  '/verslun',
  '/skilmalar',
  '/personuvernd',
  '/um-okkur',
  '/hafa-samband',
  '/staerdir',
];

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.href ?? 'https://musikogsport.is/').replace(/\/$/, '');
  const urls: { loc: string; lastmod?: string }[] = STATIC_PATHS.map((p) => ({ loc: `${base}${p}` }));

  // Catalog URLs — degrade gracefully if Woo is unreachable rather than 500 the whole sitemap.
  // (listAll*Slugs serve a stale cache on transient failure, so `degraded` only trips on a true
  // cold start with Woo down — in which case we must NOT long-cache the thin static-only sitemap.)
  let degraded = false;
  try {
    for (const slug of await listAllCategorySlugs()) urls.push({ loc: `${base}/verslun/${slug}` });
  } catch {
    degraded = true;
  }
  try {
    for (const p of await listAllProductSlugs()) {
      urls.push({ loc: `${base}/vara/${p.slug}`, lastmod: p.modified });
    }
  } catch {
    degraded = true;
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${escapeXml(u.loc)}</loc>` +
          (u.lastmod ? `<lastmod>${escapeXml(u.lastmod.slice(0, 10))}</lastmod>` : '') +
          `</url>`,
      )
      .join('\n') +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Healthy: 6h fresh + a day of stale-while-revalidate so a CDN/crawler serves the cached
      // sitemap instantly and refreshes in the background rather than paying the cold Woo sweep.
      // Degraded (cold start + Woo down → static-only): short cache so a transient outage can't
      // freeze a near-empty sitemap into caches for ~30h.
      'Cache-Control': degraded ? 'public, max-age=300' : 'public, max-age=21600, stale-while-revalidate=86400',
    },
  });
};
