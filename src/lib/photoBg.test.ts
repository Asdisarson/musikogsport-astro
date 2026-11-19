import { describe, expect, it, vi } from 'vitest';

vi.mock('astro:env/client', () => ({ MOS_MEDIA_BASE_URL: 'https://musikogsport.is' }));
import { applyPhotoFit, cardFill, cardFillAttrs, cardFillProps, createPhotoBgCache, edgeColour, isMediaFile, photoBgAttrs, photoBgProps, photoBgStyle, photoFit, photoFitAttrs, readEdges, sampleCandidate, subSizeAspect, tileAspect, waitWithin, type CardFill, type PhotoEdges, type RawPixels } from './photoBg';

/** A w×h RGBA image filled with `bg`, then `paint(x, y)` may return a different pixel. */
function image(w: number, h: number, bg: number[], paint?: (x: number, y: number) => number[] | undefined): RawPixels {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = paint?.(x, y) ?? bg;
      data.set([p[0], p[1], p[2], p[3] ?? 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h, channels: 4 };
}
// a dark "product" in the middle of the frame, clear of the edges
const centred = (w: number, h: number) => (x: number, y: number) =>
  x > w * 0.25 && x < w * 0.75 && y > h * 0.25 && y < h * 0.75 ? [30, 30, 30] : undefined;
// deterministic JPEG-like noise of ±n
const noisy = (bg: number[], n: number) => (x: number, y: number) => bg.map((v, i) => v + (((x * 7 + y * 13 + i * 5) % (2 * n + 1)) - n));

describe('edgeColour', () => {
  it('gives a uniform grey backdrop its own colour', () => {
    expect(edgeColour(image(300, 300, [0xec, 0xec, 0xec], centred(300, 300)))).toBe('#ececec');
  });

  it('keeps the bluish grey of the adidas studio shots', () => {
    expect(edgeColour(image(360, 360, [0xe8, 0xee, 0xef], centred(360, 360)))).toBe('#e8eeef');
  });

  it('tolerates JPEG noise around a flat backdrop', () => {
    expect(edgeColour(image(240, 300, [0xea, 0xea, 0xea], noisy([0xea, 0xea, 0xea], 2)))).toBe('#eaeaea');
  });

  it('leaves white and near-white photos to the default tile (multiply hides them)', () => {
    expect(edgeColour(image(300, 300, [255, 255, 255], centred(300, 300)))).toBeNull();
    expect(edgeColour(image(300, 300, [0xfd, 0xfd, 0xfe], centred(300, 300)))).toBeNull();
    // one step darker would leave a visible box under multiply (245·252/255 ≈ 242), so it gets its colour
    expect(edgeColour(image(300, 300, [0xfc, 0xfc, 0xfc], centred(300, 300)))).toBe('#fcfcfc');
  });

  it('gives up on a transparent edge (the tile shows through it already)', () => {
    expect(edgeColour(image(300, 300, [0, 0, 0, 0], centred(300, 300)))).toBeNull();
    // a cut-out product whose backdrop is mostly opaque grey but transparent along one side
    expect(edgeColour(image(300, 300, [0xec, 0xec, 0xec], (x) => (x > 280 ? [0, 0, 0, 0] : undefined)))).toBeNull();
  });

  it('gives up when the subject runs into the frame (non-uniform edge)', () => {
    // a model cropped by the bottom edge: the lower 20% of the frame, 40% of its width, is the subject
    const cropped = (x: number, y: number) => (y > 240 && x > 90 && x < 210 ? [60, 40, 30] : undefined);
    expect(edgeColour(image(300, 300, [0xec, 0xec, 0xec], cropped))).toBeNull();
    // a full-bleed scene: every pixel different
    expect(edgeColour(image(200, 200, [0, 0, 0], (x, y) => [x, y, (x + y) % 256]))).toBeNull();
  });

  it('gives up on a gradient backdrop whose sides disagree', () => {
    // top edge #eeeeee fading to #e0e0e0 at the bottom: each side is uniform-ish, but they don't agree
    const fade = (_x: number, y: number) => {
      const v = Math.round(0xee - (0xee - 0xe0) * (y / 299));
      return [v, v, v];
    };
    expect(edgeColour(image(300, 300, [0, 0, 0], fade))).toBeNull();
  });

  it('ignores the outermost pixel (resize and JPEG edge artefacts)', () => {
    const rim = (x: number, y: number) => (x === 0 || y === 0 || x === 299 || y === 299 ? [255, 255, 255] : undefined);
    expect(edgeColour(image(300, 300, [0xe9, 0xef, 0xf0], rim))).toBe('#e9eff0');
  });

  it('reads 3-channel (opaque) pixels too', () => {
    const rgba = image(100, 100, [0xee, 0xee, 0xee]);
    const rgb = new Uint8Array(100 * 100 * 3);
    for (let i = 0; i < 100 * 100; i++) rgb.set(rgba.data.subarray(i * 4, i * 4 + 3), i * 3);
    expect(edgeColour({ data: rgb, width: 100, height: 100, channels: 3 })).toBe('#eeeeee');
  });
});

describe('sampleCandidate', () => {
  const src = 'https://musikogsport.is/wp-content/uploads/2025/01/a-scaled.jpg';
  const u = (name: string) => `https://musikogsport.is/wp-content/uploads/2025/01/${name}`;
  it('picks the narrowest srcset candidate at least 300px wide (a 50px one is mostly JPEG noise)', () => {
    const srcset = `${u('a-720x720.jpg')} 720w, ${u('a-50x50.jpg')} 50w, ${u('a-150x150.jpg')} 150w, ${u('a-360x360.jpg')} 360w, ${src} 2560w`;
    expect(sampleCandidate(src, srcset)).toBe(u('a-360x360.jpg'));
  });
  it('takes the widest candidate when every one is narrower than that', () => {
    expect(sampleCandidate(src, `${u('a-50x50.jpg')} 50w, ${u('a-150x150.jpg')} 150w`)).toBe(u('a-150x150.jpg'));
  });
  it('falls back to the src without a usable srcset', () => {
    expect(sampleCandidate(src)).toBe(src);
    expect(sampleCandidate(src, '')).toBe(src);
    expect(sampleCandidate(src, 'garbage')).toBe(src);
  });
});

describe('isMediaFile', () => {
  it('accepts only https uploads on the production media host', () => {
    expect(isMediaFile('https://musikogsport.is/wp-content/uploads/2025/01/a.jpg')).toBe(true);
    expect(isMediaFile('http://musikogsport.is/wp-content/uploads/a.jpg')).toBe(false);
    expect(isMediaFile('https://musikogsport.is.evil.com/wp-content/uploads/a.jpg')).toBe(false);
    expect(isMediaFile('https://user@evil.com/wp-content/uploads/a.jpg')).toBe(false);
    expect(isMediaFile('https://musikogsport.is:8443/wp-content/uploads/a.jpg')).toBe(false);
    expect(isMediaFile('https://musikogsport.is/wp-json/wc/v3/orders')).toBe(false);
    expect(isMediaFile('https://musikogsport.is/wp-content/uploads/../../wp-json/x')).toBe(false);
    expect(isMediaFile('/placeholder.svg')).toBe(false);
    expect(isMediaFile('')).toBe(false);
  });
});

describe('photoBgStyle', () => {
  it('is the CSS variable for a known colour, and nothing otherwise', () => {
    expect(photoBgStyle('#e8eeef')).toBe('--photo-bg:#e8eeef');
    expect(photoBgStyle(null)).toBeUndefined();
    expect(photoBgStyle(undefined)).toBeUndefined();
    expect(photoBgStyle('red;background:url(x)')).toBeUndefined();
  });
  it('marks the tile (multiply off) only alongside a colour', () => {
    expect(photoBgAttrs('#ececec')).toEqual({ 'data-photo-bg': '', style: '--photo-bg:#ececec' });
    expect(photoBgAttrs(null)).toEqual({});
    expect(photoBgProps('#ececec')).toEqual({ 'data-photo-bg': '', style: { '--photo-bg': '#ececec' } });
    expect(photoBgProps('url(x)')).toEqual({});
  });
});

describe('createPhotoBgCache', () => {
  const A = 'https://musikogsport.is/wp-content/uploads/a.jpg';
  const B = 'https://musikogsport.is/wp-content/uploads/b.jpg';
  const setup = (sample: (url: string) => Promise<string | null>, concurrency = 4) => {
    let now = 0;
    const urls: string[] = [];
    const cache = createPhotoBgCache({
      sample: (url) => {
        urls.push(url);
        return sample(url);
      },
      now: () => now,
      ttlMs: 1000,
      errorTtlMs: 100,
      concurrency,
      warn: () => {},
    });
    return { cache, urls, tick: (ms: number) => (now += ms) };
  };

  it('answers a miss with undefined at once, samples in the background, then serves the colour', async () => {
    const s = setup(async () => '#eaeaea');
    expect(s.cache.lookup(A)).toBeUndefined();
    await s.cache.idle();
    expect(s.cache.lookup(A)).toBe('#eaeaea');
    expect(s.urls).toEqual([A]);
  });

  it('samples a small srcset candidate but caches under the src', async () => {
    const s = setup(async () => '#eaeaea');
    const small = 'https://musikogsport.is/wp-content/uploads/a-360x360.jpg';
    s.cache.lookup(A, `${small} 360w, https://musikogsport.is/wp-content/uploads/a-720x720.jpg 720w, https://musikogsport.is/wp-content/uploads/a-50x50.jpg 50w`);
    await s.cache.idle();
    expect(s.urls).toEqual([small]);
    expect(s.cache.lookup(A)).toBe('#eaeaea');
  });

  it('caches a decided null, and coalesces concurrent misses into one sample', async () => {
    const s = setup(async () => null);
    s.cache.lookup(A);
    s.cache.lookup(A);
    s.cache.lookup(A);
    await s.cache.idle();
    expect(s.cache.lookup(A)).toBeNull();
    expect(s.urls).toHaveLength(1);
  });

  it('never fetches a URL off the media host', async () => {
    const s = setup(async () => '#eaeaea');
    expect(s.cache.lookup('https://evil.example/wp-content/uploads/a.jpg')).toBeNull();
    expect(s.cache.lookup(A, 'https://evil.example/wp-content/uploads/a-400x400.jpg 400w')).toBeUndefined();
    await s.cache.idle();
    expect(s.urls).toEqual([A]); // the off-host srcset candidate is ignored for the src itself
  });

  it('remembers a failure only briefly, then tries again', async () => {
    let fail = true;
    const s = setup(async () => {
      if (fail) throw new Error('timeout');
      return '#e8eeef';
    });
    s.cache.lookup(A);
    await s.cache.idle();
    expect(s.cache.lookup(A)).toBeNull(); // default while the error is remembered; no new sample
    await s.cache.idle();
    expect(s.urls).toHaveLength(1);
    fail = false;
    s.tick(101);
    expect(s.cache.lookup(A)).toBeNull(); // stale value served while it re-samples
    await s.cache.idle();
    expect(s.cache.lookup(A)).toBe('#e8eeef');
  });

  // The settle contract (photoBgServer.settlePhotos): undefined means "still being read" and is the only state that
  // makes a page incomplete. A photo that can never be read (404, missing file, off-host URL) must settle, or its
  // page would never be stored and every visit would render it again.
  it('settles a photo that can never be read (failed sample or off-host URL), but not one still being read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const s = setup(async (url) => {
      if (url === A) {
        await gate;
        throw new Error('HTTP 404');
      }
      return '#eaeaea';
    });
    expect(s.cache.lookup(A)).toBeUndefined(); // still being read: not settled
    expect(s.cache.lookup('https://evil.example/wp-content/uploads/a.jpg')).not.toBeUndefined();
    release();
    await s.cache.idle();
    expect(s.cache.lookup(A)).toBeNull(); // the 404 is a decided null, so it settles
  });

  it('keeps a known colour when a re-sample after the TTL fails (LC-11)', async () => {
    let fail = false;
    const s = setup(async () => {
      if (fail) throw new Error('media host blip');
      return '#eaeaea';
    });
    s.cache.lookup(A);
    await s.cache.idle();
    fail = true;
    s.tick(1001); // expired: re-sampled, and that fails
    expect(s.cache.lookup(A)).toBe('#eaeaea');
    await s.cache.idle();
    expect(s.cache.lookup(A)).toBe('#eaeaea'); // not flipped back to the default tile
    expect(s.urls).toHaveLength(2); // and not re-sampled again while the error is remembered
  });

  it('serves a stale colour while refreshing it after the TTL', async () => {
    const s = setup(async () => '#eaeaea');
    s.cache.lookup(A);
    await s.cache.idle();
    s.tick(1001);
    expect(s.cache.lookup(A)).toBe('#eaeaea');
    await s.cache.idle();
    expect(s.urls).toHaveLength(2);
  });

  it('runs at most `concurrency` samples at once', async () => {
    let active = 0;
    let peak = 0;
    const s = setup(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return null;
    }, 2);
    for (let i = 0; i < 6; i++) s.cache.lookup(`https://musikogsport.is/wp-content/uploads/${i}.jpg`);
    s.cache.lookup(B);
    await s.cache.idle();
    expect(peak).toBe(2);
    expect(s.urls).toHaveLength(7);
  });
});

describe('readEdges', () => {
  const GREY = [0xec, 0xec, 0xec];
  it('keeps the whole-ring colour (edgeColour) and reads each side on its own', () => {
    const e = readEdges(image(300, 300, GREY, centred(300, 300)))!;
    expect(e).toMatchObject({ w: 300, h: 300, ring: '#ececec', sides: ['#ececec', '#ececec', '#ececec', '#ececec'], drift: [null, null, null, null] });
  });

  it('marks the sides a cropped subject runs into, and keeps the clear ones', () => {
    // a 4:5 model shot cut by the top and bottom edges (the torso spans the middle 40% of the width)
    const crop = (x: number) => (x > 96 && x < 144 ? [60, 40, 30] : undefined);
    const e = readEdges(image(240, 300, [0xed, 0xed, 0xeb], crop))!;
    expect(e.ring).toBeNull();
    expect(e.sides).toEqual([null, '#ededeb', null, '#ededeb']);
  });

  it('accepts a soft vertical gradient along a side (studio vignette), not a hard step', () => {
    const fade = (_x: number, y: number) => {
      const v = Math.round(0xef - 9 * (y / 299));
      return [v, v, v - 3];
    };
    const soft = readEdges(image(240, 300, [0, 0, 0], fade))!;
    expect(soft.ring).toBeNull(); // top and bottom disagree by 9 levels: no one colour for the whole ring
    expect(soft.sides[1]).not.toBeNull();
    expect(soft.sides[3]).not.toBeNull();
    // ...and keeps how it drifts, run by run down the side, so the tile can follow it (no seam at either end)
    expect(soft.drift[1]).toHaveLength(8);
    expect(soft.drift[1]![0]).toBe('#eeeeeb');
    expect(soft.drift[1]![7]).toBe('#e7e7e4');
    expect(soft.drift[0]).toBeNull(); // the top band itself is flat
    // a floor line half-way down: each half flat, but a 20-level step between them
    const floor = (_x: number, y: number) => (y > 150 ? [0xd8, 0xd8, 0xd8] : [0xec, 0xec, 0xec]);
    const hard = readEdges(image(240, 300, [0, 0, 0], floor))!;
    expect(hard.sides[1]).toBeNull();
    expect(hard.sides[3]).toBeNull();
  });

  it('has no smooth side for a scene', () => {
    const e = readEdges(image(200, 200, [0, 0, 0], (x, y) => [x, y, (x + y) % 256]))!;
    expect(e.sides).toEqual([null, null, null, null]);
  });

  it('gives up on a see-through edge or a tiny image', () => {
    expect(readEdges(image(300, 300, [0, 0, 0, 0]))).toBeNull();
    expect(readEdges(image(2, 2, GREY))).toBeNull();
  });
});

describe('photoFit', () => {
  const G = '#ededeb';
  const edges = (w: number, h: number, sides: (string | null)[], ring: string | null = null, drift: (string[] | null)[] = [null, null, null, null]): PhotoEdges => ({
    w,
    h,
    ring,
    sides: sides as PhotoEdges['sides'],
    drift: drift as PhotoEdges['drift'],
  });
  const SQUARE = 1;
  const PORTRAIT = 4 / 5;

  it('keeps the padded tile for a photo whose whole edge is one flat colour', () => {
    expect(photoFit(edges(300, 300, [G, G, G, G], G), SQUARE)).toEqual({ colour: G, fit: 'pad' });
    expect(photoFit(edges(300, 300, [G, G, G, G], G), PORTRAIT)).toEqual({ colour: G, fit: 'pad' });
  });

  it('bleeds a 4:5 model shot cut by top and bottom to the tile edges of a square card', () => {
    // fills the height; only the clear left and right edges meet the tile colour
    expect(photoFit(edges(480, 600, [null, G, null, G]), SQUARE)).toEqual({ colour: G, fit: 'contain' });
  });

  it('takes the tile colour from the two exposed sides when they agree, and gives up when they do not', () => {
    expect(photoFit(edges(480, 600, [null, '#ececea', null, '#e9e9e6']), SQUARE)).toEqual({ colour: '#ebebe8', fit: 'contain' });
    expect(photoFit(edges(480, 600, [null, '#ececea', null, '#dadada']), SQUARE)).toBeNull();
  });

  it('anchors the photo to the one exposed side the subject runs into', () => {
    // 4:5 in a square: the ball touches the left edge, the right is clear
    expect(photoFit(edges(480, 600, [G, G, null, null]), SQUARE)).toEqual({ colour: G, fit: 'contain', pos: 'left' });
    // 1:1 in a 4:5 tile: the model is cut by the bottom edge, the top is clear (the left touches too, but it sits on
    // the tile edge since the photo fills the width)
    expect(photoFit(edges(360, 360, [G, G, null, null]), PORTRAIT)).toEqual({ colour: G, fit: 'contain', pos: 'bottom' });
    expect(photoFit(edges(360, 360, [null, G, G, G]), PORTRAIT)).toEqual({ colour: G, fit: 'contain', pos: 'top' });
  });

  it('keeps the default tile when the subject runs into both exposed sides (it would be cut or float)', () => {
    expect(photoFit(edges(480, 600, [G, null, null, null]), SQUARE)).toBeNull();
    expect(photoFit(edges(360, 360, [null, G, null, G]), PORTRAIT)).toBeNull();
  });

  it('fills a tile of (almost) the photo’s own shape: no side is exposed, nothing is cropped beyond ~1%', () => {
    expect(photoFit(edges(480, 600, [G, null, null, null]), PORTRAIT)).toEqual({ colour: G, fit: 'cover' });
    expect(photoFit(edges(360, 360, [null, null, null, G]), SQUARE)).toEqual({ colour: G, fit: 'cover' });
    expect(photoFit(edges(355, 360, [null, G, null, G]), SQUARE)).toEqual({ colour: G, fit: 'cover' });
    // 3% off is not close enough: the exposed sides decide
    expect(photoFit(edges(349, 360, [null, null, null, null]), SQUARE)).toBeNull();
  });

  it('leaves scenes (no smooth side) and white backdrops to the default tile', () => {
    expect(photoFit(edges(480, 600, [null, null, null, null]), SQUARE)).toBeNull();
    expect(photoFit(edges(480, 600, [null, null, null, null]), PORTRAIT)).toBeNull();
    expect(photoFit(edges(480, 600, [null, '#ffffff', null, '#fefefe']), SQUARE)).toBeNull();
    expect(photoFit(edges(480, 600, ['#fefefe', null, null, null]), PORTRAIT)).toBeNull();
    expect(photoFit(null, SQUARE)).toBeNull();
    expect(photoFit(undefined, SQUARE)).toBeNull();
  });

  it('follows a drifting backdrop with a gradient along the exposed sides (studio vignette)', () => {
    const right = ['#f0f0ec', '#eeeeea', '#ececea', '#eaeae8'];
    const left = ['#eeeeea', '#ececea', '#eaeae8', '#e8e8e6'];
    // both sides exposed: run by run average, top to bottom
    expect(photoFit(edges(480, 600, [null, '#ededea', null, '#ebebe8'], null, [null, right, null, left]), SQUARE)).toEqual({
      colour: '#ecece9',
      fit: 'contain',
      grad: { axis: 'y', stops: ['#efefeb', '#ededea', '#ebebe9', '#e9e9e7'] },
    });
    // one side exposed (anchored): that side's own drift; a flat side has none
    expect(photoFit(edges(480, 600, [null, '#ededea', null, null], null, [null, right, null, null]), SQUARE)).toEqual({
      colour: '#ededea',
      fit: 'contain',
      pos: 'left',
      grad: { axis: 'y', stops: right },
    });
    // a wide photo exposes its top and bottom: the gradient runs left to right
    expect(photoFit(edges(360, 360, [G, G, null, null], null, [right, null, null, null]), PORTRAIT)).toEqual({
      colour: G,
      fit: 'contain',
      pos: 'bottom',
      grad: { axis: 'x', stops: right },
    });
    // one exposed side drifts, the other doesn't: the flat one counts as flat all along
    expect(photoFit(edges(480, 600, [null, '#ededea', null, '#ededea'], null, [null, ['#efefeb', '#ebebe9'], null, null]), SQUARE)?.grad).toEqual({
      axis: 'y',
      stops: ['#eeeeeb', '#ececea'],
    });
    // nothing is exposed under 'cover'
    expect(photoFit(edges(480, 600, [null, '#ededea', null, null], null, [null, right, null, null]), PORTRAIT)).toEqual({ colour: '#ededea', fit: 'cover' });
  });

  it('can be asked about a differently-shaped rendition of the photo (the square WP thumbnail)', () => {
    expect(photoFit(edges(480, 600, [null, G, null, G]), SQUARE, 1)).toEqual({ colour: G, fit: 'cover' });
  });
});

describe('subSizeAspect', () => {
  it('reads the WordPress sub-size suffix, or nothing', () => {
    expect(subSizeAspect('https://musikogsport.is/wp-content/uploads/2026/04/A.png-450x450.avif')).toBe(1);
    expect(subSizeAspect('https://musikogsport.is/wp-content/uploads/2026/04/A-576x720.jpg')).toBe(0.8);
    expect(subSizeAspect('https://musikogsport.is/wp-content/uploads/2026/04/A.png.avif')).toBeUndefined();
    expect(subSizeAspect('https://musikogsport.is/wp-content/uploads/2026/04/A-0x720.jpg')).toBeUndefined();
  });
});

describe('photoFit attributes', () => {
  it('marks a bleed tile with its fit and anchor; a padded tile as before; nothing for the default', () => {
    expect(photoFitAttrs({ colour: '#ededeb', fit: 'pad' })).toEqual({ 'data-photo-bg': '', style: '--photo-bg:#ededeb' });
    expect(photoFitAttrs({ colour: '#ededeb', fit: 'contain', pos: 'bottom' })).toEqual({
      'data-photo-bg': '',
      'data-photo-fit': 'contain',
      'data-photo-pos': 'bottom',
      style: '--photo-bg:#ededeb',
    });
    expect(photoFitAttrs({ colour: '#ededeb', fit: 'cover' })).toEqual({ 'data-photo-bg': '', 'data-photo-fit': 'cover', style: '--photo-bg:#ededeb' });
    expect(photoFitAttrs(null)).toEqual({});
    expect(photoFitAttrs({ colour: 'red;x', fit: 'contain' })).toEqual({});
    expect(photoFitAttrs({ colour: '#ededeb', fit: 'contain', grad: { axis: 'y', stops: ['#f0f0ec', '#eaeae8'] } })).toEqual({
      'data-photo-bg': '',
      'data-photo-fit': 'contain',
      style: '--photo-bg:#ededeb;--photo-grad:linear-gradient(to bottom,#f0f0ec 25%,#eaeae8 75%)',
    });
    expect(photoFitAttrs({ colour: '#ededeb', fit: 'contain', grad: { axis: 'x', stops: ['#f0f0ec', 'url(x)'] } })).toEqual({
      'data-photo-bg': '',
      'data-photo-fit': 'contain',
      style: '--photo-bg:#ededeb',
    });
  });

  it('repaints a tile in the browser, clearing the previous photo’s fit and anchor', () => {
    const attrs = new Map<string, string>();
    const props = new Map<string, string>();
    const tile = {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
      style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
    } as unknown as HTMLElement;
    applyPhotoFit(tile, { colour: '#ededeb', fit: 'contain', pos: 'left', grad: { axis: 'x', stops: ['#f0f0ec', '#eaeae8'] } });
    expect(Object.fromEntries(attrs)).toEqual({ 'data-photo-bg': '', 'data-photo-fit': 'contain', 'data-photo-pos': 'left' });
    expect(props.get('--photo-bg')).toBe('#ededeb');
    expect(props.get('--photo-grad')).toBe('linear-gradient(to right,#f0f0ec 25%,#eaeae8 75%)');
    applyPhotoFit(tile, { colour: '#e8eeef', fit: 'pad' });
    expect(Object.fromEntries(attrs)).toEqual({ 'data-photo-bg': '' });
    expect(props.get('--photo-bg')).toBe('#e8eeef');
    applyPhotoFit(tile, null);
    expect(attrs.size).toBe(0);
    expect(props.size).toBe(0);
  });
});

describe('readEdges lanes (the card tile, side by side)', () => {
  it('reads each side as 40 runs from a thin band at the very edge, null where the subject is in the band', () => {
    // a 4:5 shot: the left band is grey all down, the right one has a (patterned) subject in it from 40% to 60% of
    // the height
    const paint = (x: number, y: number) =>
      x >= 236 && y >= 120 && y < 180 ? ((x + y) % 2 ? [40, 40, 40] : [200, 60, 30]) : x < 120 ? [0xe9, 0xe9, 0xe5] : [0xf0, 0xf0, 0xec];
    const e = readEdges(image(240, 300, [0, 0, 0], paint))!;
    expect(e.lanes![3]).toEqual(Array(40).fill('#e9e9e5'));
    expect(e.lanes![1]).toEqual([...Array(16).fill('#f0f0ec'), ...Array(8).fill(null), ...Array(16).fill('#f0f0ec')]);
    // top and bottom are read left to right: half one colour, half the other
    expect(e.lanes![0]).toEqual([...Array(20).fill('#e9e9e5'), ...Array(20).fill('#f0f0ec')]);
  });

  it('follows the outermost columns, not a wide band (a vignette that darkens toward the frame)', () => {
    // the photo darkens by 1 level per px over its outer 12 columns: the 2%-band colour would lag the edge
    const paint = (x: number) => {
      const v = 0xf0 - Math.max(0, 12 - Math.min(x, 239 - x));
      return [v, v, v];
    };
    const e = readEdges(image(240, 300, [0, 0, 0], paint))!;
    // band px 1..2 at this size: medians of 0xe5/0xe6 -> within 1 level of the outer column
    expect(parseInt(e.lanes![3][0]!.slice(1, 3), 16)).toBeLessThanOrEqual(0xe6);
  });
});

describe('cardFill', () => {
  const G = '#ededeb';
  const run = (c: string | null, n = 20) => Array<string | null>(n).fill(c);
  const edges = (w: number, h: number, lanes: (string | null)[][] | undefined): PhotoEdges => ({
    w,
    h,
    ring: null,
    sides: [null, null, null, null],
    drift: [null, null, null, null],
    ...(lanes ? { lanes: lanes as NonNullable<PhotoEdges['lanes']> } : {}),
  });

  it('fills a tall photo’s left and right gaps each from its own side, whatever the top and bottom are', () => {
    // a model cut by the top and bottom (busy), lit a little differently on each side
    expect(cardFill(edges(480, 600, [run(null), run('#f0f0ec'), run(null), run('#e9e9e5')]))).toEqual({ axis: 'y', lanes: [['#e9e9e5'], ['#f0f0ec']] });
  });

  it('fills a wide photo’s top and bottom gaps, whatever its left and right are', () => {
    expect(cardFill(edges(720, 540, [run(G), run(null), run('#e0e0e0'), run(null)]))).toEqual({ axis: 'x', lanes: [[G], ['#e0e0e0']] });
  });

  it('follows a vignette run by run (a gradient), each side its own', () => {
    const vignette = Array.from({ length: 20 }, (_, i) => {
      const v = (0xfa - Math.round(Math.abs(i - 9.5) * 1.5)).toString(16);
      return `#${v}${v}${v}`;
    });
    const fill = cardFill(edges(576, 720, [run(null), vignette, run(null), vignette]))!;
    expect(fill.axis).toBe('y');
    expect(fill.lanes[0]).toEqual(vignette);
    expect(fill.lanes[1]).toEqual(vignette);
  });

  it('bridges a short stretch where the subject touches a side (at most 10% of it) from the backdrop either side', () => {
    const lane = ['#e0e0e0', '#e0e0e0', null, null, '#e6e6e6', ...run('#e8e8e8', 15)];
    const fill = cardFill(edges(480, 600, [run(null), run(G), run(null), lane]))!;
    expect(fill.lanes[0]!.slice(0, 5)).toEqual(['#e0e0e0', '#e0e0e0', '#e2e2e2', '#e4e4e4', '#e6e6e6']);
    // runs past the last backdrop run hold its colour
    const tail = [...run('#e0e0e0', 18), null, null];
    expect(cardFill(edges(480, 600, [run(null), run(G), run(null), tail]))!.lanes[0]).toEqual(['#e0e0e0']);
  });

  it('zooms when the subject reaches more than 10% of an open side (an arm, a ball), rather than leave a seam', () => {
    const zoomY = { axis: 'y', lanes: [null, null], zoom: true };
    const arm = ['#e0e0e0', '#e0e0e0', null, null, null, '#e8e8e8', ...run('#e8e8e8', 14)]; // 3 of 20 runs
    expect(cardFill(edges(480, 600, [run(null), run(G), run(null), arm]))).toEqual(zoomY);
    const busy = ['#a7a7a9', '#a7a7a9', '#a9a9ab', ...run(null, 17)]; // the subject covers most of it
    expect(cardFill(edges(480, 600, [run(null), busy, run(null), run('#b0b0b2')]))).toEqual(zoomY);
  });

  it('tells a subject that reads as one flat colour (a dark sleeve) from the backdrop: it doesn’t step smoothly from it', () => {
    const sleeve = [...run(G, 9), '#202026', '#202026', ...run(G, 9)]; // 2 of 20 runs: bridged
    expect(cardFill(edges(480, 600, [run(null), run(G), run(null), sleeve]))).toEqual({ axis: 'y', lanes: [[G], [G]] });
    const wide = [...run(G, 8), '#202026', '#202026', '#202026', ...run(G, 9)]; // 3 of 20: zoom
    expect(cardFill(edges(480, 600, [run(null), run(G), run(null), wide]))?.zoom).toBe(true);
    // ...while a floor shadow, a few levels a run, is backdrop
    const floor = [...run('#eaeae8', 14), '#e2e2e0', '#dadad8', '#dadad8', '#e2e2e0', '#e8e8e6', '#e8e8e6'];
    expect(cardFill(edges(480, 600, [run(null), run(G), run(null), floor]))!.lanes[0]).toEqual(floor);
  });

  it('zooms a scene to fill the tile: little backdrop on either side, or a side that runs through many colours', () => {
    const zoomY = { axis: 'y', lanes: [null, null], zoom: true };
    expect(cardFill(edges(480, 600, [run(G), run(null), run(G), run(null)]))).toEqual(zoomY);
    const beach = [...Array.from({ length: 9 }, (_, i) => `#${(0xa0 + i * 4).toString(16)}c3e2`), ...run(null, 4), ...run('#d9cfc4', 7)];
    expect(cardFill(edges(480, 600, [run(null), beach, run(null), beach]))).toEqual(zoomY);
    expect(cardFill(edges(600, 480, [run(null), run(G), run(null), run(G)]))).toEqual({ axis: 'x', lanes: [null, null], zoom: true });
    expect(cardFillAttrs({ axis: 'y', lanes: [null, null], zoom: true })).toEqual({ 'data-photo-fill': 'zoom' });
    expect(cardFillProps({ axis: 'x', lanes: [null, null], zoom: true })).toEqual({ 'data-photo-fill': 'zoom' });
  });

  it('leaves a white side to the page (no layer), and a white photo with no fill at all', () => {
    expect(cardFill(edges(480, 600, [run(null), run('#ffffff'), run(null), run('#fefefe')]))).toBeNull();
    expect(cardFill(edges(480, 600, [run(null), run('#ffffff'), run(null), run(G)]))).toEqual({ axis: 'y', lanes: [[G], null] });
  });

  it('has nothing to fill for a square photo, or one read before lanes existed', () => {
    expect(cardFill(edges(360, 360, [run(G), run(G), run(G), run(G)]))).toBeNull();
    expect(cardFill(edges(480, 600, undefined))).toBeNull();
    expect(cardFill(null)).toBeNull();
  });

  it('fills even the slivers of an almost-square photo (a 2% gap is still a few pixels a side)', () => {
    expect(cardFill(edges(353, 360, [run(null), run(G), run(null), run(G)]))).toEqual({ axis: 'y', lanes: [[G], [G]] });
  });

  it('treats a lane within one level of flat as one colour', () => {
    const jitter = Array.from({ length: 20 }, (_, i) => (i % 2 ? '#ededeb' : '#eeeeec'));
    expect(cardFill(edges(480, 600, [run(null), jitter, run(null), jitter]))!.lanes).toEqual([['#eeeeec'], ['#eeeeec']]);
  });
});

describe('cardFill attributes', () => {
  it('paints each side’s gap with its own layer: a flat colour, or a gradient with the runs at their heights', () => {
    expect(cardFillAttrs({ axis: 'y', lanes: [['#e9e9e5'], ['#f0f0ec']] })).toEqual({
      'data-photo-fill': 'y',
      style: '--photo-fill-a:linear-gradient(#e9e9e5,#e9e9e5);--photo-fill-b:linear-gradient(#f0f0ec,#f0f0ec)',
    });
    expect(cardFillAttrs({ axis: 'x', lanes: [['#f0f0ec', '#eaeae8'], null] })).toEqual({
      'data-photo-fill': 'x',
      style: '--photo-fill-a:linear-gradient(to right,#f0f0ec 25%,#eaeae8 75%);--photo-fill-b:none',
    });
  });

  it('drops the stops inside a stretch of one colour (shorter markup, same gradient)', () => {
    const lane = ['#e0e0e0', '#e0e0e0', '#e0e0e0', '#e4e4e4', '#e4e4e4'];
    expect(cardFillAttrs({ axis: 'y', lanes: [lane, null] }).style).toBe(
      '--photo-fill-a:linear-gradient(to bottom,#e0e0e0 10%,#e0e0e0 50%,#e4e4e4 70%,#e4e4e4 90%);--photo-fill-b:none',
    );
  });

  it('keeps only the stops a straight stretch needs (each dropped one within a level of the line drawn)', () => {
    const ramp = ['#e0e0e0', '#e2e2e2', '#e4e4e4', '#e6e6e6'];
    expect(cardFillAttrs({ axis: 'y', lanes: [ramp, null] }).style).toBe('--photo-fill-a:linear-gradient(to bottom,#e0e0e0 12.5%,#e6e6e6 87.5%);--photo-fill-b:none');
    // a vignette (down, then up) keeps its turn
    const vee = ['#f0f0f0', '#ececec', '#e8e8e8', '#ececec', '#f0f0f0'];
    expect(cardFillAttrs({ axis: 'x', lanes: [vee, null] }).style).toBe('--photo-fill-a:linear-gradient(to right,#f0f0f0 10%,#e8e8e8 50%,#f0f0f0 90%);--photo-fill-b:none');
  });

  it('is nothing for no fill, or for anything that is not plain #rrggbb', () => {
    expect(cardFillAttrs(null)).toEqual({});
    expect(cardFillAttrs({ axis: 'y', lanes: [['red;x'], null] })).toEqual({});
    expect(cardFillAttrs({ axis: 'z' as 'y', lanes: [['#ffffff'], null] })).toEqual({});
  });

  it('renders the same in React (WishlistView), even through the /api/products JSON', () => {
    const fills: (CardFill | null)[] = [null, { axis: 'y', lanes: [['#e9e9e5'], ['#f0f0ec']] }, { axis: 'x', lanes: [['#f0f0ec', '#eaeae8'], null] }, { axis: 'y', lanes: [['url(x)'], null] }];
    for (const f of fills) {
      const wire = f ? (JSON.parse(JSON.stringify(f)) as CardFill) : undefined;
      const { style, ...data } = cardFillProps(wire);
      const { style: css, ...attrData } = cardFillAttrs(f);
      expect(data).toEqual(attrData);
      const asCss = style ? Object.entries(style as Record<string, string>).map(([k, v]) => `${k}:${v}`).join(';') : undefined;
      expect(asCss).toBe(css);
    }
  });
});

describe('tileAspect: the product page tile takes its photo\'s own shape', () => {
  const edges = (w: number, h: number) => ({ w, h }) as PhotoEdges;

  it('is the photo\'s width over height', () => {
    expect(tileAspect(edges(1000, 1000))).toBe(1);
    expect(tileAspect(edges(800, 1000))).toBe(0.8);
    expect(tileAspect(edges(1200, 900))).toBeCloseTo(1.3333, 4);
  });

  it('keeps a very tall or very wide photo within 2:3 to 3:2', () => {
    expect(tileAspect(edges(500, 2000))).toBeCloseTo(2 / 3, 4);
    expect(tileAspect(edges(3000, 1000))).toBe(1.5);
  });

  it('is null while the photo is unread, or for a reading with no size', () => {
    expect(tileAspect(undefined)).toBeNull();
    expect(tileAspect(null)).toBeNull();
    expect(tileAspect(edges(0, 100))).toBeNull();
  });
});

describe('waitWithin', () => {
  it('resolves true at once when the check already passes', async () => {
    expect(await waitWithin(() => true, 50)).toBe(true);
  });
  it('resolves true when the check passes before the bound', async () => {
    let n = 0;
    expect(await waitWithin(() => ++n > 3, 2000)).toBe(true);
  });
  it('resolves false when the bound passes first', async () => {
    expect(await waitWithin(() => false, 60)).toBe(false);
  });
});
