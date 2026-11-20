// refreshContent: WordPress pokes the storefront when the Forsíða is saved, so a new picture shows on the next page
// view instead of after the minute's cache. No key: the poke carries no data, and at most one refresh runs per window.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.example' }));
// The stored pages carry the header, menus and bar, so a refresh marks them all stale (review 24). The mark records how
// many front-page reads had happened when it was made: it must come after the refetch.
const marks = vi.hoisted(() => ({ calls: 0, frontReadsAtMark: [] as number[] }));
vi.mock('./shellRuntime', () => ({
  invalidateAllPages: async () => {
    marks.calls++;
    marks.frontReadsAtMark.push(frontCalls);
    return true;
  },
}));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const img = (name: string) => ({ url: `http://wp.test/wp-content/uploads/${name}`, width: 10, height: 10, alt: '' });

let footerLogo = 'old.webp';
let frontCalls = 0;
let now = 0;

beforeEach(() => {
  vi.resetModules(); // the caches and the window are module state
  footerLogo = 'old.webp';
  frontCalls = 0;
  marks.calls = 0;
  marks.frontReadsAtMark = [];
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/menu/location/')) return json({ items: [] });
    frontCalls++;
    return json({ logos: { header: null, footer: img(footerLogo) } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('refreshContent', () => {
  it('answers false and keeps the content when WordPress cannot be read', async () => {
    const { loadFrontPage } = await import('./frontPage');
    const { refreshContent } = await import('./contentRefresh');
    await loadFrontPage();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await refreshContent()).toBe(false);
    expect((await loadFrontPage())?.logos.footer?.url).toContain('old.webp');
  });

  it('marks every stored page stale once the content is refetched, so the next visit renders it with the new chrome', async () => {
    const { refreshContent } = await import('./contentRefresh');
    footerLogo = 'new.webp';
    expect(await refreshContent()).toBe(true);
    expect(marks.calls).toBe(1);
    expect(marks.frontReadsAtMark).toEqual([frontCalls]); // after the refetch, not before it
  });

  // A poke that changes nothing (an editor saves without a change, or a stranger pokes) marks nothing: the stored pages
  // are not all rendered again for it.
  it('marks nothing when the refetch found the content unchanged', async () => {
    const { refreshContent } = await import('./contentRefresh');
    expect(await refreshContent()).toBe(true);
    expect(marks.calls).toBe(1); // the first poke of a process always marks
    now += 5000;
    expect(await refreshContent()).toBe(true);
    expect(marks.calls).toBe(1);
    footerLogo = 'new.webp';
    now += 5000;
    expect(await refreshContent()).toBe(true);
    expect(marks.calls).toBe(2);
  });

  it('marks the stored pages even when WordPress could not be read: the chrome may have been refetched in part', async () => {
    const { refreshContent } = await import('./contentRefresh');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await refreshContent()).toBe(false);
    expect(marks.calls).toBe(1);
  });

  it('makes the next read of the front page and the chrome see what WordPress has now', async () => {
    const { loadFrontPage } = await import('./frontPage');
    const { loadSiteChrome } = await import('./siteChrome');
    const { refreshContent } = await import('./contentRefresh');
    expect((await loadSiteChrome()).logos.footer?.url).toContain('old.webp');

    footerLogo = 'new.webp';
    expect(await refreshContent()).toBe(true);
    footerLogo = 'newer.webp'; // a later save gets its own refetch, not the finished one
    now += 5000;
    await refreshContent();
    expect((await loadFrontPage())?.logos.footer?.url).toContain('newer.webp');
    footerLogo = 'new.webp';
    now += 5000;
    await refreshContent();
    expect((await loadFrontPage())?.logos.footer?.url).toContain('new.webp');
    expect((await loadSiteChrome()).logos.footer?.url).toContain('new.webp');
  });

  it('a poke inside the window is not dropped: it waits for the window to end, and pokes that wait share one refetch', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] }); // Date.now stays the spy above
    try {
      const { loadFrontPage } = await import('./frontPage');
      const { refreshContent, REFRESH_WINDOW_MS } = await import('./contentRefresh');
      const first = refreshContent();
      await vi.advanceTimersByTimeAsync(0);
      await first;
      const after = frontCalls;

      footerLogo = 'new.webp'; // saved right after the first refetch
      now += 10;
      let done = 0;
      const pokes = [refreshContent(), refreshContent()].map((p) => p.then(() => done++));
      await vi.advanceTimersByTimeAsync(REFRESH_WINDOW_MS - 11);
      expect([done, frontCalls]).toEqual([0, after]); // still inside the window: nothing fetched yet
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all(pokes);
      expect(done).toBe(2);
      expect(frontCalls).toBe(after + 1); // one refetch for both pokes (the chrome reads the front page just fetched)
      expect((await loadFrontPage())?.logos.footer?.url).toContain('new.webp');
    } finally {
      vi.useRealTimers();
    }
  });
});
