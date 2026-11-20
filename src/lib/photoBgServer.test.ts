import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://media.example.test' }));

// fetch is stubbed in every case, so no host is contacted. Each photo name is used once: the sampler's cache is
// process-wide and remembers outcomes between tests.
import { samplePhotoEdges, settlePhotos } from './photoBgServer';

const photo = (name: string) => `https://media.example.test/wp-content/uploads/${name}.jpg`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('samplePhotoEdges', () => {
  it('reads a missing file as a decided null (the photo settles and its page can be kept)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(samplePhotoEdges(photo('sampler-404'))).resolves.toBeNull();
  });

  it('throws for a server error, so the photo is tried again rather than decided', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    await expect(samplePhotoEdges(photo('sampler-503'))).rejects.toThrow('HTTP 503');
  });

  it('throws for a 403, which a bot challenge or WAF can return for a file that exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })));
    await expect(samplePhotoEdges(photo('sampler-403'))).rejects.toThrow('HTTP 403');
  });

  it('throws for a rate limit, which is the host failing for now', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 429 })));
    await expect(samplePhotoEdges(photo('sampler-429'))).rejects.toThrow('HTTP 429');
  });

  it('throws for a refused or reset connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(samplePhotoEdges(photo('sampler-reset'))).rejects.toThrow('fetch failed');
  });

  it('reads a file sharp cannot decode as a decided null (a retry would fail the same way)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));
    await expect(samplePhotoEdges(photo('sampler-garbage'))).resolves.toBeNull();
  });
});

describe('settlePhotos', () => {
  it('is false while a photo fails fast, so its page is not kept as complete', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await settlePhotos([{ src: photo('settle-fast-fail') }], 200)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is true once a photo is decided as unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    expect(await settlePhotos([{ src: photo('settle-404') }], 2000)).toBe(true);
  });
});
