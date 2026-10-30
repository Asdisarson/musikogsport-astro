import type { APIRoute } from 'astro';
import { listAllProductSlugs } from '../lib/woo';
import { loadCatalogTerms } from '../lib/catalogTerms';
import { categoryChain } from '../lib/categoryTree';
import { categoryPath, productPath } from '../lib/paths';

export const prerender = false;

// Static, indexable routes in live's URL shape (cart/checkout/account/wishlist/api excluded;
// search result pages are Disallowed in robots.txt, so they are not listed either).
const STATIC_PATHS = ['/', '/verslun/', '/hafa-samband/', '/skilmalar/', '/opnunartimi/', '/staerdir/', '/personuvernd/'];

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.href ?? 'https://musikogsport.is/').replace(/\/$/, '');
  const urls: { loc: string; lastmod?: string }[] = STATIC_PATHS.map((p) => ({ loc: `${base}${p}` }));

  // Catalog URLs — degrade gracefully if Woo is unreachable rather than 500 the whole sitemap.
  // (Both loaders serve a stale cache on transient failure, so `degraded` only trips on a true
  // cold start with Woo down — in which case we must NOT long-cache the thin static-only sitemap.)
  let degraded = false;
  const terms = await loadCatalogTerms();
  if (terms.degraded) degraded = true;
  for (const c of terms.categories) {
    if ((terms.counts.get(c.id) ?? 0) > 0) urls.push({ loc: `${base}${categoryPath(categoryChain(terms.categories, c.id))}` });
  }
  try {
    for (const p of await listAllProductSlugs()) {
      urls.push({ loc: `${base}${productPath(p.permalink, p.slug)}`, lastmod: p.modified });
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
