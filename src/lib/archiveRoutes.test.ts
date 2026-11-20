// The routes that read catalogue terms (the rail's categories, brands, teams, sports and colours, and the product's
// breadcrumbs and category links) mark themselves degraded when those terms are degraded (review 23): a page drawn
// without them is neither stored nor held at the CDN. The pages are not run in a test, so the marking line is pinned
// here, as staerdirPage.test.ts does for its script.
import { describe, expect, it } from 'vitest';
import archiveIndex from '../pages/verslun/index.astro?raw';
import archivePage from '../pages/verslun/page/[n].astro?raw';
import searchPage from '../pages/page/[n].astro?raw';
import productPage from '../pages/verslun/[...path].astro?raw';

const marksDegraded = (src: string) => src.split('\n').some((line) => /terms\.degraded/.test(line) && /markDegraded\(Astro\.response\)/.test(line));

describe('archive routes mark themselves degraded when the catalogue terms are', () => {
  it.each([
    ['/verslun/', archiveIndex],
    ['/verslun/page/N/', archivePage],
    ['/page/N/ (search results)', searchPage],
    ['/verslun/<product>/', productPage],
  ])('%s', (_route, src) => {
    expect(marksDegraded(src)).toBe(true);
  });
});
