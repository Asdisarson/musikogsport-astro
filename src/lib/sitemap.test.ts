// The sitemap's static part (PA-09): every indexable page the footer links to is listed, cart/checkout/account never.
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test', getSecret: () => undefined }));
vi.mock('./woo', () => ({ listAllProductSlugs: vi.fn(async () => []) }));
vi.mock('./catalogTerms', () => ({ loadCatalogTerms: vi.fn(async () => ({ categories: [], counts: new Map(), degraded: false })) }));
const { GET } = await import('../pages/sitemap.xml');

describe('sitemap.xml', () => {
  it('lists the about and privacy pages with the other static pages, and no cart/checkout/account URL', async () => {
    const res = await GET({ site: new URL('https://musikogsport.is') } as never);
    const locs = [...(await (res as Response).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    for (const p of ['/', '/verslun/', '/um-okkur/', '/personuvernd/', '/hafa-samband/', '/skilmalar/']) expect(locs).toContain(p);
    for (const p of ['/karfa/', '/gera-upp/', '/min-sida/', '/oskalisti/']) expect(locs).not.toContain(p);
  });
});
