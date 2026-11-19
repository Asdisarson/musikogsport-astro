import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://musikogsport.is' }));
import { phoneCropSources, lightSources, mainSources, mediaSrcset, modestCandidate, productImage, PLACEHOLDER } from './img';

describe('productImage', () => {
  it('gives the first image’s src and srcset, both on the media host', () => {
    const img = productImage({
      name: 'Skór',
      images: [{ src: 'http://localhost:10025/wp-content/uploads/a.jpg', srcset: 'http://localhost:10025/wp-content/uploads/a-720x720.jpg 720w', alt: '' }],
    });
    expect(img).toEqual({
      src: 'https://musikogsport.is/wp-content/uploads/a.jpg',
      srcset: 'https://musikogsport.is/wp-content/uploads/a-720x720.jpg 720w',
      alt: 'Skór',
    });
  });

  it('has no srcset without one, and the placeholder without an image', () => {
    expect(productImage({ images: [{ src: 'https://musikogsport.is/a.jpg', srcset: false }] }).srcset).toBe('');
    expect(productImage({ name: 'X', images: [] })).toEqual({ src: PLACEHOLDER, srcset: '', alt: 'X' });
  });
});

describe('mediaSrcset', () => {
  it('rewrites every local candidate to the media host and keeps the width descriptors', () => {
    const local =
      'http://localhost:10025/wp-content/uploads/a.jpeg 1110w, http://localhost:10025/wp-content/uploads/a-720x584.jpeg 720w, http://127.0.0.1:10025/wp-content/uploads/a-150x122.jpeg 150w';
    expect(mediaSrcset(local)).toBe(
      'https://musikogsport.is/wp-content/uploads/a.jpeg 1110w, https://musikogsport.is/wp-content/uploads/a-720x584.jpeg 720w, https://musikogsport.is/wp-content/uploads/a-150x122.jpeg 150w',
    );
  });

  it('leaves a production srcset as it is', () => {
    const prod = 'https://musikogsport.is/wp-content/uploads/a.jpeg 1110w, https://musikogsport.is/wp-content/uploads/a-720x584.jpeg 720w';
    expect(mediaSrcset(prod)).toBe(prod);
  });

  it('is empty when WordPress has no sub-sizes (false) or the field is missing or blank', () => {
    expect(mediaSrcset(false)).toBe('');
    expect(mediaSrcset(undefined)).toBe('');
    expect(mediaSrcset(null)).toBe('');
    expect(mediaSrcset('  ')).toBe('');
  });

  it('is empty for a lone URL without a width descriptor (nothing for the browser to choose from)', () => {
    expect(mediaSrcset('http://localhost:10025/wp-content/uploads/a.jpeg')).toBe('');
  });
});

describe('lightSources', () => {
  const up = 'https://musikogsport.is/wp-content/uploads/2026/04/a';

  it('keeps every pixel of a JPEG candidate: the next width up on the allow-list, described by its own width', () => {
    const got = lightSources({ src: `${up}.jpg`, srcset: `${up}-720x720.jpg 720w, ${up}.jpg 1110w`, width: 1110 });
    expect(got).toEqual({
      avif: '/img/720/avif/v2/2026/04/a-720x720.jpg 720w, /img/1536/avif/v2/2026/04/a.jpg 1110w',
      webp: '/img/720/webp/v2/2026/04/a-720x720.jpg 720w, /img/1536/webp/v2/2026/04/a.jpg 1110w',
    });
  });

  it('caps a candidate wider than the largest width there, and drops candidates below the smallest width', () => {
    expect(lightSources({ srcset: `${up}-150x150.png 150w, ${up}-2000.png 2000w, ${up}-2500.png 2500w` })?.avif).toBe(
      '/img/2048/avif/v2/2026/04/a-2000.png 2000w, /img/2048/avif/v2/2026/04/a-2500.png 2048w',
    );
  });

  it('leaves WebP and AVIF originals out, and returns null when nothing is left to convert', () => {
    expect(lightSources({ srcset: `${up}.webp 1110w` })).toBeNull();
    expect(lightSources({ srcset: `${up}.avif 720w, ${up}.jpg 1110w` })?.webp).toBe('/img/1536/webp/v2/2026/04/a.jpg 1110w');
  });

  it('skips paths outside the uploads folder, other extensions and URLs with a query string', () => {
    expect(lightSources({ srcset: 'https://musikogsport.is/other/a.jpg 720w' })).toBeNull();
    expect(lightSources({ srcset: `${up}.gif 720w` })).toBeNull();
    expect(lightSources({ srcset: `${up}.jpg?v=2 720w` })).toBeNull();
  });

  it('uses the single src at the next width up from its intrinsic one when there is no srcset, with no descriptor', () => {
    expect(lightSources({ src: `${up}.jpg`, srcset: '', width: 1600 })).toEqual({
      avif: '/img/2048/avif/v2/2026/04/a.jpg',
      webp: '/img/2048/webp/v2/2026/04/a.jpg',
    });
  });

  it('is null without a srcset and without a known width', () => {
    expect(lightSources({ src: `${up}.jpg` })).toBeNull();
    expect(lightSources({})).toBeNull();
  });

  it('maps localhost and production hosts alike: only the path matters', () => {
    expect(lightSources({ srcset: 'http://localhost:10025/wp-content/uploads/2026/04/a.jpg 1110w' })?.avif).toBe('/img/1536/avif/v2/2026/04/a.jpg 1110w');
  });
});

describe('mainSources', () => {
  it('gives one AVIF and one WebP candidate for a JPEG the island swaps in', () => {
    expect(mainSources('https://wp.example.is/wp-content/uploads/2026/04/red.jpg')).toEqual({
      avif: '/img/1080/avif/v2/2026/04/red.jpg',
      webp: '/img/1080/webp/v2/2026/04/red.jpg',
    });
  });

  it('gives none for a photo that is already light or not a library file, and for no photo', () => {
    expect(mainSources('https://wp.example.is/wp-content/uploads/2026/04/red.webp')).toBeNull();
    expect(mainSources('/placeholder.svg')).toBeNull();
    expect(mainSources(null)).toBeNull();
  });
});

describe('modestCandidate', () => {
  const srcset = 'https://musikogsport.is/a.jpg 1070w, https://musikogsport.is/a-576x720.jpg 576w, https://musikogsport.is/a-864x1080.jpg 864w';
  it('picks the smallest uncropped candidate at least 576 wide', () => {
    expect(modestCandidate(srcset, 'https://musikogsport.is/a.jpg')).toBe('https://musikogsport.is/a-576x720.jpg');
  });
  it('never returns a square crop: it only reads the srcset it is given', () => {
    expect(modestCandidate(srcset, 'x')).not.toMatch(/450x450/);
  });
  it('falls back to the original when no candidate is wide enough or there is no srcset', () => {
    expect(modestCandidate('https://musikogsport.is/a-360x450.jpg 360w', 'https://musikogsport.is/a.jpg')).toBe('https://musikogsport.is/a.jpg');
    expect(modestCandidate('', 'https://musikogsport.is/a.jpg')).toBe('https://musikogsport.is/a.jpg');
  });
});

describe('phoneCropSources', () => {
  const src = 'https://wp.musikogsport.is/wp-content/uploads/2026/08/hero-scaled.jpg';

  it('offers the 5:6 crop of the full photo at the widths it can fill, the last one at its own width', () => {
    const got = phoneCropSources({ src, width: 2048, height: 1152 });
    expect(got?.avif).toBe('/img/360c/avif/v2/2026/08/hero-scaled.jpg 360w, /img/450c/avif/v2/2026/08/hero-scaled.jpg 450w, /img/720c/avif/v2/2026/08/hero-scaled.jpg 720w, /img/1080c/avif/v2/2026/08/hero-scaled.jpg 960w');
    expect(got?.webp).toContain('/img/720c/webp/v2/2026/08/hero-scaled.jpg 720w');
    expect(got?.media).toBe('(max-width: 480px)');
    expect(got?.sizes).toBe('min(488px, 125vw)');
  });

  it('gives nothing for a photo that is not wider than the crop, of unknown size, or not a JPEG or PNG', () => {
    expect(phoneCropSources({ src, width: 800, height: 1200 })).toBeNull();
    expect(phoneCropSources({ src, width: 0, height: 0 })).toBeNull();
    expect(phoneCropSources({ src: src.replace('.jpg', '.webp'), width: 2048, height: 1152 })).toBeNull();
    expect(phoneCropSources({ src: `${src}?x=1`, width: 2048, height: 1152 })).toBeNull();
  });

  it('gives nothing when the crop would be too small to be worth a source', () => {
    expect(phoneCropSources({ src, width: 600, height: 300 })).toBeNull();
  });
});
