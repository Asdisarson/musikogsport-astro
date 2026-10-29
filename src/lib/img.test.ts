import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://musikogsport.is' }));
import { mediaSrcset, productImage, PLACEHOLDER } from './img';

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
