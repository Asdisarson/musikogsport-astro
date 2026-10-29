// The media host comes from MOS_MEDIA_BASE_URL (astro:env/client), not a constant: after DNS cutover the apex
// serves the storefront and WordPress media lives on WordPress's own host.
import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://wp.musikogsport.is' }));

const { MEDIA_BASE_URL, mediaUrl, rewriteMediaHosts, productImage } = await import('./img');
const { isMediaFile } = await import('./photoBg');

describe('media host from MOS_MEDIA_BASE_URL', () => {
  it('is the configured host', () => {
    expect(MEDIA_BASE_URL).toBe('https://wp.musikogsport.is');
  });

  it('rewrites local media URLs onto it', () => {
    expect(mediaUrl('http://localhost:10025/wp-content/uploads/a.jpg')).toBe('https://wp.musikogsport.is/wp-content/uploads/a.jpg');
    expect(rewriteMediaHosts('<img src="http://127.0.0.1:10025/wp-content/uploads/b.jpg">')).toBe('<img src="https://wp.musikogsport.is/wp-content/uploads/b.jpg">');
    expect(productImage({ images: [{ src: 'http://localhost/wp-content/uploads/c.jpg' } as never] }).src).toBe('https://wp.musikogsport.is/wp-content/uploads/c.jpg');
  });

  it('leaves media already on a real host alone', () => {
    expect(mediaUrl('https://wp.musikogsport.is/wp-content/uploads/a.jpg')).toBe('https://wp.musikogsport.is/wp-content/uploads/a.jpg');
  });

  it('is the only host photoBg samples from', () => {
    expect(isMediaFile('https://wp.musikogsport.is/wp-content/uploads/2025/01/a.jpg')).toBe(true);
    expect(isMediaFile('https://musikogsport.is/wp-content/uploads/2025/01/a.jpg')).toBe(false);
  });
});

describe('media host fallback', () => {
  it('drops a trailing slash and falls back to production for an unusable value', async () => {
    const { normaliseMediaBase } = await import('./img');
    expect(normaliseMediaBase('https://wp.musikogsport.is/')).toBe('https://wp.musikogsport.is');
    expect(normaliseMediaBase('')).toBe('https://musikogsport.is');
    expect(normaliseMediaBase('ftp://x')).toBe('https://musikogsport.is');
    expect(normaliseMediaBase(undefined)).toBe('https://musikogsport.is');
  });
});
