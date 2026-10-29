// getWpPage (LC-03, LC-14): content pages cached per slug, a missing slug remembered, concurrent cold requests for one
// slug sharing a call, and a failure remembered briefly (stale copy served, else WpUnavailable) so a slow WordPress
// isn't asked again by every request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/server', () => ({ WP_INTERNAL_URL: 'http://wp.test' }));
const { getWpPage, WpUnavailable } = await import('./wp');

const fetchMock = vi.fn<typeof fetch>();
let n = 0;
const slug = () => `side-${++n}`;
const page = (s: string, text = 'Halló') => new Response(JSON.stringify({ id: 3, slug: s, title: 'Síða', content: `<p>${text}</p>` }), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(5_000_000);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getWpPage', () => {
  it('parses the page and caches it for a minute', async () => {
    const s = slug();
    fetchMock.mockImplementation(async () => page(s));
    const got = await getWpPage(s);
    expect(got).toMatchObject({ id: 3, slug: s, title: 'Síða' });
    expect(got?.rows[0].cols[0].blocks).toEqual([{ type: 'html', html: '<p>Halló</p>' }]);
    await getWpPage(s);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`http://wp.test/wp-json/mos/v1/page/${s}`);
  });

  it('answers null for a missing slug and remembers it', async () => {
    const s = slug();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 404 }));
    expect(await getWpPage(s)).toBeNull();
    expect(await getWpPage(s)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent cold callers of a slug', async () => {
    const s = slug();
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (release = r)));
    const a = getWpPage(s);
    const b = getWpPage(s);
    release(page(s));
    expect((await a)?.slug).toBe(s);
    expect((await b)?.slug).toBe(s);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws WpUnavailable on a cold failure and remembers it for a few seconds', async () => {
    const s = slug();
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
    await expect(getWpPage(s)).rejects.toBeInstanceOf(WpUnavailable);
    await expect(getWpPage(s)).rejects.toBeInstanceOf(WpUnavailable);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(5_000_000 + 30_000);
    fetchMock.mockImplementation(async () => page(s));
    expect((await getWpPage(s))?.slug).toBe(s);
  });

  it('serves the stale copy when a refresh fails, without asking again during the memo', async () => {
    const s = slug();
    fetchMock.mockImplementation(async () => page(s, 'Gamalt'));
    await getWpPage(s);
    vi.setSystemTime(5_000_000 + 61_000); // stale
    fetchMock.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    expect((await getWpPage(s))?.rows[0].cols[0].blocks[0]).toEqual({ type: 'html', html: '<p>Gamalt</p>' });
    expect((await getWpPage(s))?.title).toBe('Síða');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
