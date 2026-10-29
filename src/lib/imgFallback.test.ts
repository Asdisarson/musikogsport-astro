// CO-14: the product-photo placeholder fallback lives in /img-fallback.js (an external file, allowed by
// `script-src 'self'`), not in an inline onerror attribute that an enforced CSP blocks. Same behaviour as the old
// attribute: a failed srcset candidate first falls back to the plain src, then a failed src becomes the placeholder,
// once (no loop on a missing placeholder). The shipped file is run here against a fake document.
import { describe, expect, it } from 'vitest';
import source from '../../public/img-fallback.js?raw';
const PLACEHOLDER = '/placeholder.svg';

class FakeImg {
  tagName = 'IMG';
  attrs = new Map<string, string>();
  complete = false;
  naturalWidth = 0;
  constructor(attrs: Record<string, string>) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  hasAttribute(n: string) {
    return this.attrs.has(n);
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  removeAttribute(n: string) {
    this.attrs.delete(n);
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  get src() {
    return `https://shop.test${this.attrs.get('src') ?? ''}`;
  }
  set src(v: string) {
    this.attrs.set('src', v);
  }
}

function boot(existing: FakeImg[] = []) {
  const listeners: { type: string; fn: (e: { target: unknown }) => void; capture: unknown }[] = [];
  const doc = {
    addEventListener: (type: string, fn: (e: { target: unknown }) => void, capture: unknown) => listeners.push({ type, fn, capture }),
    querySelectorAll: (sel: string) => (sel === 'img[data-fallback]' ? existing.filter((i) => i.hasAttribute('data-fallback')) : []),
  };
  new Function('document', source)(doc);
  const fire = (target: unknown) => listeners.filter((l) => l.type === 'error').forEach((l) => l.fn({ target }));
  return { listeners, fire };
}

describe('public/img-fallback.js', () => {
  it('listens for image errors on the document in the capture phase (error does not bubble)', () => {
    const { listeners } = boot();
    expect(listeners).toHaveLength(1);
    expect(listeners[0].type).toBe('error');
    expect(listeners[0].capture).toBe(true);
  });

  it('drops the srcset first, then swaps the src for the placeholder, then stops', () => {
    const { fire } = boot();
    const img = new FakeImg({ src: '/wp-content/uploads/a.jpg', srcset: '/a-300.jpg 300w', 'data-fallback': '' });
    fire(img);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.getAttribute('src')).toBe('/wp-content/uploads/a.jpg');
    fire(img);
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
    fire(img); // the placeholder itself failed: leave it
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
  });

  it('only touches opted-in images', () => {
    const { fire } = boot();
    const other = new FakeImg({ src: '/logo.webp' });
    fire(other);
    expect(other.getAttribute('src')).toBe('/logo.webp');
    fire({ tagName: 'SCRIPT' });
    fire(null);
  });

  it('also fixes opted-in images that had already failed before it ran', () => {
    const broken = Object.assign(new FakeImg({ src: '/x.jpg', 'data-fallback': '' }), { complete: true, naturalWidth: 0, currentSrc: 'https://shop.test/x.jpg' });
    const fine = Object.assign(new FakeImg({ src: '/y.jpg', 'data-fallback': '' }), { complete: true, naturalWidth: 300, currentSrc: 'https://shop.test/y.jpg' });
    const loading = Object.assign(new FakeImg({ src: '/z.jpg', 'data-fallback': '' }), { currentSrc: '' });
    // a lazy image not requested yet: nothing tried, nothing to fix
    const lazy = Object.assign(new FakeImg({ src: '/w.jpg', 'data-fallback': '' }), { complete: true, naturalWidth: 0, currentSrc: '' });
    boot([broken, fine, loading, lazy]);
    expect(broken.getAttribute('src')).toBe(PLACEHOLDER);
    expect(fine.getAttribute('src')).toBe('/y.jpg');
    expect(loading.getAttribute('src')).toBe('/z.jpg');
    expect(lazy.getAttribute('src')).toBe('/w.jpg');
  });
});
