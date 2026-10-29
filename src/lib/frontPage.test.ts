// normaliseFrontPage: the one boundary for mos/v1/front-page. A missing field gets its empty default, so an older
// mu-plugin or a removed ACF field can't throw in planHome / the site chrome and 500 every page (LC-15). Image URLs
// pass through unchanged (CO-13 skipped: see audit.md).
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.example' }));
const { normaliseFrontPage } = await import('./frontPage');
const { planHome } = await import('./homeLayout');

const img = (url: string) => ({ url, width: 10, height: 20, alt: 'x' });

describe('normaliseFrontPage', () => {
  it('keeps hero, banner and logo image URLs as WordPress sent them', () => {
    const fp = normaliseFrontPage({
      logos: { header: img('http://localhost:10025/wp-content/uploads/logo.webp'), footer: null },
      hero: { slides: [{ id: 1, name: 'S', href: '/v/', price: '', regular_price: '', sale_price: '', on_sale: false, price_html: '', image: img('http://127.0.0.1:10025/wp-content/uploads/s.jpg') }], heading: 'H', text: '', buttons: [] },
      banners: [{ image: img('http://localhost:10025/wp-content/uploads/2026/10/H24616.jpg'), title: 'B', href: '/b/' }, null, { image: null, title: 'P', href: '' }],
    });
    expect(fp.logos.header?.url).toBe('http://localhost:10025/wp-content/uploads/logo.webp');
    expect(fp.logos.footer).toBeNull();
    expect(fp.hero.slides[0].image).toEqual({ url: 'http://127.0.0.1:10025/wp-content/uploads/s.jpg', width: 10, height: 20, alt: 'x' });
    expect(fp.banners[0]?.image?.url).toBe('http://localhost:10025/wp-content/uploads/2026/10/H24616.jpg');
    expect(fp.banners[1]).toBeNull();
    expect(fp.banners[2]?.image).toBeNull();
  });

  it('drops an image without a URL', () => {
    const fp = normaliseFrontPage({ logos: { header: { url: '', width: 1, height: 1 }, footer: 'x' } });
    expect(fp.logos).toEqual({ header: null, footer: null });
  });

  it('defaults every missing field, so planHome and the chrome never throw on a partial answer', () => {
    for (const raw of [{}, null, 'oops', { hero: {}, campaign: null, footer: {}, logos: {} }, { hero: { slides: [{ name: 'x' }], buttons: [{}] } }]) {
      const fp = normaliseFrontPage(raw);
      expect(fp.campaign).toEqual({ text: '', text_right: '', notice: '' });
      expect(fp.footer).toEqual({ address: '', directions_label: '', directions_href: '', email: '', phone: '', company_line: '' });
      expect(Array.isArray(fp.rows) && Array.isArray(fp.banners)).toBe(true);
      expect(() => planHome(fp.hero, fp.banners)).not.toThrow();
    }
  });

  it('keeps the values it was given', () => {
    const fp = normaliseFrontPage({
      campaign: { text: 'Frí sending', text_right: 'R', notice: 'N' },
      hero: { slides: [], heading: 'Nýtt', text: 'T', buttons: [{ label: 'Skoða', href: '/verslun/' }] },
      rows: [{ title: 'Nýjar', source: 'newest', category: null, count: 8 }],
      shipping_bar: { goal: 10000, message: 'm', success: 's', color: '#000', locations: ['minicart'], include_taxes: true },
      footer: { address: 'A', directions_label: 'D', directions_href: 'https://maps.example/', email: 'e@x.is', phone: '1', company_line: 'C' },
    });
    expect(fp.campaign.text).toBe('Frí sending');
    expect(fp.hero).toMatchObject({ heading: 'Nýtt', text: 'T', buttons: [{ label: 'Skoða', href: '/verslun/' }] });
    expect(fp.rows).toHaveLength(1);
    expect(fp.shipping_bar?.goal).toBe(10000);
    expect(fp.footer.email).toBe('e@x.is');
  });
});
