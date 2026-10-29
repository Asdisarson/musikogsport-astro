// loadSiteChrome (LC-16, LC-14): the menus are not thrown away when only the front-page call fails on a cold start;
// the chrome then uses the built-in campaign/footer fallback around the loaded menus.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.example' }));

const menu = { items: [{ id: 1, title: 'Skór', href: '/voruflokkur/skor/', external: false, target: '', classes: [], children: [] }] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.resetModules(); // the chrome and front-page caches are module state
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadSiteChrome', () => {
  it('keeps the loaded menus when the front page is unavailable, with the fallback campaign and footer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/menu/location/') ? json(menu) : json({}, 503))));
    const { loadSiteChrome } = await import('./siteChrome');
    const chrome = await loadSiteChrome();
    expect(chrome.primary.map((i) => i.title)).toEqual(['Skór']);
    expect(chrome.footerMenu.map((i) => i.title)).toEqual(['Skór']);
    expect(chrome.campaign).toEqual({ text: '', textRight: '', notice: '' });
    expect(chrome.footer.email).toBe('musikogsport@musikogsport.is');
    expect(chrome.logos).toEqual({ header: null, footer: null });
  });

  it('uses the front-page data when it loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/menu/location/')
          ? json(menu)
          : json({ campaign: { text: 'Frí sending', text_right: '', notice: '' }, logos: { header: { url: 'http://localhost:10025/wp-content/uploads/l.webp', width: 1, height: 1, alt: '' } }, footer: { email: 'a@b.is' } }),
      ),
    );
    const { loadSiteChrome } = await import('./siteChrome');
    const chrome = await loadSiteChrome();
    expect(chrome.campaign.text).toBe('Frí sending');
    expect(chrome.logos.header?.url).toBe('http://localhost:10025/wp-content/uploads/l.webp');
    expect(chrome.footer.email).toBe('a@b.is');
    expect(chrome.footer.phone).toBe('+(354) 555 2887'); // a blank field takes the fallback
  });

  it('falls back entirely when the primary menu cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 503)));
    const { loadSiteChrome } = await import('./siteChrome');
    const chrome = await loadSiteChrome();
    expect(chrome.primary).toEqual([]);
    expect(chrome.footer.address).toContain('Dalshraun');
  });
});
