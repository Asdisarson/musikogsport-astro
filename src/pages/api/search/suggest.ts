import type { APIRoute } from 'astro';
import { storeProducts } from '../../../lib/storeCatalog';
import { loadCatalogTerms } from '../../../lib/catalogTerms';
import { categoryHref } from '../../../lib/categoryTree';
import { productSummary } from '../../../lib/productSummary';
import { suggestQuery, suggestTerms, type SuggestTerm } from '../../../lib/searchSuggest';
import { legacySearchTarget } from '../../../lib/paths';
import { decodeEntities } from '../../../lib/decode';
import { jsonResponse, tooManyRequests } from '../../../lib/http';
import { createLimiter } from '../../../lib/rateLimit';
import { visitorKey } from '../../../lib/visitor';

export const prerender = false;

// What the search field shows while the visitor types: the first products of the search itself (the same search
// the results page runs, so "see all" never disagrees), and the categories and brands the text names. Public catalog
// data only. Limited per visitor: a fast typist asks a few times a second at most (the field waits between keys),
// and each call is one Store API search.
const WINDOW_MS = 60 * 1000;
const requests = createLimiter(120, WINDOW_MS);
const PRODUCTS = 6;
const TERMS = 5;

export const GET: APIRoute = async (ctx) => {
  const query = suggestQuery(ctx.url.searchParams.get('q'));
  if (!query) return jsonResponse({ query: '', total: 0, products: [], terms: [], url: '/verslun/' }, 200);
  if (!requests.take(visitorKey(ctx))) return tooManyRequests(WINDOW_MS / 1000);

  // The terms are cached and never reject (degraded: no category links, no card subtitles). A failed search is an
  // error, not "nothing found": the field then keeps what it showed.
  let found;
  let catalog;
  try {
    [found, catalog] = await Promise.all([storeProducts({ search: query, per_page: PRODUCTS }), loadCatalogTerms()]);
  } catch {
    return jsonResponse({ message: 'Leitin svaraði ekki.' }, 502);
  }
  const named: SuggestTerm[] = [
    ...catalog.categories.map((c) => ({ name: decodeEntities(c.name), path: categoryHref(catalog.categories, c.id) ?? '', count: catalog.counts.get(c.id) ?? 0 })),
    ...catalog.brands.map((b) => ({ name: decodeEntities(b.name), path: `/brand/${b.slug}/`, count: catalog.counts.get(b.id) ?? 0 })),
  ].filter((t) => t.path);
  return jsonResponse(
    {
      query,
      total: found.total,
      products: found.items.map((p) => productSummary(p, catalog.categories)),
      terms: suggestTerms(query, named, TERMS).map(({ name, path }) => ({ name, path })),
      url: legacySearchTarget(query),
    },
    200,
  );
};
