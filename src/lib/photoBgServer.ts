// Server side of photoBg: fetches a product photo from the media host, decodes it with sharp and reads its edges
// (readEdges). One process-wide cache; components call photoBg() / photoFitFor() while rendering, which never wait
// on the network (see createPhotoBgCache). Server-only: sharp is a native module.
import { waitWithin, cardFill, cardFillAttrs, createPhotoBgCache, photoBgAttrs, photoFit, photoFitAttrs, readEdges, tileAspect, type CardFill, type PhotoEdges, type PhotoFit, type RawPixels } from './photoBg';

const TIMEOUT_MS = 4000;
/** Sub-size candidates are a few KB to ~100 KB; only a photo without a srcset falls back to its original. */
const MAX_BYTES = 1.5 * 1024 * 1024;
/** Decoded at most this big: the edge band needs no more, and it bounds memory for a large original. */
const DECODE_EDGE = 600;

/** Read a response body, giving up (null) once it passes `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Fetch and read one photo's edges. Throws on a transient failure (network reset, timeout, any HTTP error but the
 *  ones below): the photo stays undecided and is tried again. A decided "nothing to go on" is null: too big,
 *  see-through, a file the media host says is gone (404, 410), and bytes sharp can't decode. Those won't change on a
 *  retry, and a page showing them must be able to settle, or it would never be kept. A 403 or 429 is not decided
 *  here: a bot challenge or rate limit can answer for a file that exists. The URL is already checked to be a
 *  media-library file (isMediaFile); redirects are refused so it can't be bounced elsewhere. */
export async function samplePhotoEdges(url: string): Promise<PhotoEdges | null> {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) return null;
    throw new Error(`HTTP ${res.status}`);
  }
  const bytes = await readCapped(res, MAX_BYTES);
  if (!bytes) return null;
  const { default: sharp } = await import('sharp');
  // only the decode is guarded: a failure in readEdges itself is a bug, and must not pass for a decided null
  let px: RawPixels;
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 50_000_000 })
      .resize(DECODE_EDGE, DECODE_EDGE, { fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    px = { data, width: info.width, height: info.height, channels: info.channels };
  } catch {
    // not an image sharp can read: a retry reads the same bytes, so it is a decided null
    return null;
  }
  return readEdges(px);
}

// 8 at once: a wall page asks for up to 24 photos, and settlePhotos waits for them (each a few KB to ~100 KB)
const cache = createPhotoBgCache<PhotoEdges>({ sample: samplePhotoEdges, concurrency: 8 });

/** The photo's padded-tile colour (its whole edge one flat colour) if already known (null: default tile), undefined
 *  while it's being worked out. The hero, the colourway swatches and the wishlist use only this. */
export function photoBg(src: string | null | undefined, srcset?: string): string | null | undefined {
  if (!src) return null;
  const edges = cache.lookup(src, srcset);
  return edges === undefined ? undefined : (edges?.ring ?? null);
}

/** Starts reading these photos and waits until the cache has nothing left to read, or `ms` passes, so the cards come
 *  out filled on the first view instead of the next one: the wall (a short wait) and the product page's
 *  related-products server island (already off the critical path, so a longer one). Resolves true when every photo
 *  was read in time, false when the bound passed first (the render then has a part missing: see lib/shellIncomplete). */
export async function settlePhotos(images: { src: string; srcset?: string }[], ms: number): Promise<boolean> {
  // only these photos: the cache's queue is shared with every other render, so waiting for it to empty would cost
  // the whole bound whenever another page is being read at the same time
  return waitWithin(() => images.every((im) => cache.lookup(im.src, im.srcset) !== undefined), ms);
}

/** The product page gallery tile's shape for this photo (tileAspect), once known; null: the default 4:5 tile. */
export function photoAspectOf(src: string | null | undefined, srcset?: string): number | null {
  return src ? tileAspect(cache.lookup(src, srcset)) : null;
}

/** How a product card's tile fills the gap around this photo (cardFill), once known; null: no fill (the page). */
export function cardFillOf(src: string | null | undefined, srcset?: string): CardFill | null {
  return src ? cardFill(cache.lookup(src, srcset)) : null;
}

/** The same as attributes to spread onto the card tile. */
export function cardFillFor(src: string | null | undefined, srcset?: string): Record<string, string> {
  return cardFillAttrs(cardFillOf(src, srcset));
}

/** How a PDP tile of aspect `tileAspect` shows this photo (photoFit), once known; null: the default tile.
 *  `imgAspect`: the shape of the rendition the tile actually shows, when it isn't the photo's own (a thumbnail). */
export function photoFitOf(src: string | null | undefined, srcset: string | undefined, tileAspect: number, imgAspect?: number): PhotoFit | null {
  return src ? photoFit(cache.lookup(src, srcset), tileAspect, imgAspect) : null;
}

/** The same as attributes to spread onto the tile. */
export function photoFitFor(src: string | null | undefined, srcset: string | undefined, tileAspect: number, imgAspect?: number): Record<string, string> {
  return photoFitAttrs(photoFitOf(src, srcset, tileAspect, imgAspect));
}

/** Attributes for a photo tile (spread onto the wrapper): its colour, or nothing for the default tile. */
export function photoBgFor(src: string | null | undefined, srcset?: string): Record<string, string> {
  return photoBgAttrs(photoBg(src, srcset));
}
