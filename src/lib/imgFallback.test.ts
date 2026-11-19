// CO-14: the product-photo placeholder fallback lives in /img-fallback.js (an external file, allowed by
// `script-src 'self'`), not in an inline onerror attribute that an enforced CSP blocks. A failed srcset candidate first
// falls back to the plain src, then a failed src becomes the placeholder, once (no loop on a missing placeholder).
// The shipped file is run here against a fake document. The placeholder waits for a probe of the img's own src: one
// failure can be reported more than once (the capture listener, the already-broken scan, a stale event after the
// sources went), and only a src that really fails in its own probe may replace the photo.
import { describe, expect, it } from 'vitest';
import source from '../../public/img-fallback.js?raw';
const PLACEHOLDER = '/placeholder.svg';
const flush = () => new Promise((r) => setTimeout(r, 0));

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
    const v = this.attrs.get('src') ?? '';
    return v.startsWith('http') ? v : `https://shop.test${v}`;
  }
  set src(v: string) {
    this.attrs.set('src', v);
  }
}

function boot(existing: FakeImg[] = [], probeLoads = false) {
  const listeners: { type: string; fn: (e: { target: unknown }) => void; capture: unknown }[] = [];
  const probes: string[] = [];
  class FakeProbe {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(v: string) {
      probes.push(v);
      queueMicrotask(() => (probeLoads ? this.onload?.() : this.onerror?.()));
    }
  }
  const doc = {
    addEventListener: (type: string, fn: (e: { target: unknown }) => void, capture: unknown) => listeners.push({ type, fn, capture }),
    querySelectorAll: (sel: string) => (sel === 'img[data-fallback]' ? existing.filter((i) => i.hasAttribute('data-fallback')) : []),
  };
  new Function('document', 'Image', source)(doc, FakeProbe);
  const fire = (target: unknown) => listeners.filter((l) => l.type === 'error').forEach((l) => l.fn({ target }));
  return { listeners, fire, probes };
}

describe('public/img-fallback.js', () => {
  it('listens for image errors on the document in the capture phase (error does not bubble)', () => {
    const { listeners } = boot();
    expect(listeners).toHaveLength(1);
    expect(listeners[0].type).toBe('error');
    expect(listeners[0].capture).toBe(true);
  });

  it('drops the srcset first, then tests the src itself, then swaps in the placeholder, then stops', async () => {
    const { fire, probes } = boot();
    const img = new FakeImg({ src: '/wp-content/uploads/a.jpg', srcset: '/a-300.jpg 300w', 'data-fallback': '' });
    fire(img);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.getAttribute('src')).toBe('/wp-content/uploads/a.jpg');
    fire(img);
    await flush();
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
    fire(img); // the placeholder itself failed: leave it
    await flush();
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
    expect(probes).toEqual(['https://shop.test/wp-content/uploads/a.jpg']);
  });

  it('only touches opted-in images', () => {
    const { fire } = boot();
    const other = new FakeImg({ src: '/logo.webp' });
    fire(other);
    expect(other.getAttribute('src')).toBe('/logo.webp');
    fire({ tagName: 'SCRIPT' });
    fire(null);
  });

  it('also fixes opted-in images that had already failed before it ran', async () => {
    const broken = Object.assign(new FakeImg({ src: '/x.jpg', 'data-fallback': '' }), { complete: true, naturalWidth: 0, currentSrc: 'https://shop.test/x.jpg' });
    const fine = Object.assign(new FakeImg({ src: '/y.jpg', 'data-fallback': '' }), { complete: true, naturalWidth: 300, currentSrc: 'https://shop.test/y.jpg' });
    const loading = Object.assign(new FakeImg({ src: '/z.jpg', 'data-fallback': '' }), { currentSrc: '' });
    // a lazy image not requested yet: nothing tried, nothing to fix
    const lazy = Object.assign(new FakeImg({ src: '/w.jpg', 'data-fallback': '' }), { complete: true, naturalWidth: 0, currentSrc: '' });
    boot([broken, fine, loading, lazy]);
    await flush();
    expect(broken.getAttribute('src')).toBe(PLACEHOLDER);
    expect(fine.getAttribute('src')).toBe('/y.jpg');
    expect(loading.getAttribute('src')).toBe('/z.jpg');
    expect(lazy.getAttribute('src')).toBe('/w.jpg');
  });
});

// The double-event case: one failure reported twice must not decide the photo twice.
describe('public/img-fallback.js with repeated error events', () => {
  it('probes the src once for one failure delivered twice, and keeps the src when the probe loads', async () => {
    const { fire, probes } = boot([], true);
    const img = new FakeImg({ src: '/wp-content/uploads/c.jpg', 'data-fallback': '' });
    fire(img);
    fire(img); // the same failure again (capture listener and island handler, or the already-broken scan)
    await flush();
    expect(probes).toHaveLength(1);
    expect(img.src).toBe('https://shop.test/wp-content/uploads/c.jpg');
  });

  it('a stale error after the sources were dropped keeps the photo when its src loads', async () => {
    const { fire, probes } = boot([], true);
    const { pic, img } = pictured({ src: '/wp-content/uploads/d.jpg', srcset: '/d-300.jpg 300w', 'data-fallback': '' });
    fire(img); // the light sources go
    fire(img); // stale event for the same failure: the srcset goes
    fire(img); // the src itself is now tried, and its probe loads
    await flush();
    expect(pic.children.some((c) => c instanceof FakeSource)).toBe(false);
    expect(img.src).toBe('https://shop.test/wp-content/uploads/d.jpg');
    expect(probes).toEqual(['https://shop.test/wp-content/uploads/d.jpg']);
  });

  it('a src that loads in its probe but then fails again gets the placeholder: one reload, no loop', async () => {
    const { fire, probes } = boot([], true);
    const img = new FakeImg({ src: '/wp-content/uploads/e.jpg', 'data-fallback': '' });
    fire(img);
    await flush();
    expect(img.src).toBe('https://shop.test/wp-content/uploads/e.jpg'); // reloaded once
    fire(img); // the reload failed too
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
    fire(img);
    expect(probes).toHaveLength(1);
  });

  it('a src whose own probe fails becomes the placeholder', async () => {
    const { fire } = boot([], false);
    const img = new FakeImg({ src: '/wp-content/uploads/f.jpg', 'data-fallback': '' });
    fire(img);
    await flush();
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
  });
});

// An <img> inside <picture> with light <source>s: when the chosen source fails (the conversion endpoint refused it),
// the browser must stop choosing that source, or it keeps the broken one. The sources go first, then the usual steps.
class FakeSource {
  tagName = 'SOURCE';
  parentNode: FakePicture | null = null;
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
}
class FakePicture {
  tagName = 'PICTURE';
  children: (FakeSource | FakeImg)[] = [];
  parentNode = null;
  querySelectorAll(sel: string) {
    return sel === 'source' ? this.children.filter((c): c is FakeSource => c instanceof FakeSource) : [];
  }
}
function pictured(attrs: Record<string, string>) {
  const pic = new FakePicture();
  const img = Object.assign(new FakeImg(attrs), { parentNode: pic as unknown as null });
  pic.children.push(Object.assign(new FakeSource(), { parentNode: pic }), Object.assign(new FakeSource(), { parentNode: pic }), img);
  return { pic, img };
}

describe('public/img-fallback.js inside <picture>', () => {
  it('removes the light sources on the first error (the img itself has not been tried yet), then the srcset, then the placeholder', async () => {
    const { fire } = boot();
    const { pic, img } = pictured({ src: '/wp-content/uploads/a.jpg', srcset: '/a-300.jpg 300w', 'data-fallback': '' });
    fire(img);
    expect(pic.children.some((c) => c instanceof FakeSource)).toBe(false);
    expect(img.hasAttribute('srcset')).toBe(true);
    expect(img.getAttribute('src')).toBe('/wp-content/uploads/a.jpg');
    fire(img);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.getAttribute('src')).toBe('/wp-content/uploads/a.jpg');
    fire(img);
    await flush();
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
  });

  it('removes the sources even when the img has no srcset of its own', async () => {
    const { fire } = boot();
    const { pic, img } = pictured({ src: '/wp-content/uploads/b.jpg', 'data-fallback': '' });
    fire(img);
    expect(pic.children.some((c) => c instanceof FakeSource)).toBe(false);
    expect(img.getAttribute('src')).toBe('/wp-content/uploads/b.jpg');
    fire(img);
    await flush();
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
  });
});
