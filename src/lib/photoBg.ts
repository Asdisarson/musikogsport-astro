// Per-photo tile colour — pure, no I/O of its own (photoBgServer.ts fetches and decodes).
//
// Product tiles are #f5f5f5 with the photo multiplied onto them, which hides a WHITE backdrop. Most suppliers'
// backdrops aren't white, though (#eaeaea–#efefef greys, adidas' bluish #e8eeef), and multiply darkens those, so the
// photo shows as a darker box inside the tile's padding. No single tile colour fits them all, and the media host
// sends no CORS headers (no canvas sampling in the browser), so the storefront reads each photo's border once on
// the server and, when it's one flat colour, paints the tile that colour with multiply off (global.css
// [data-photo-bg]). Everything else keeps the default tile. Product cards show the photo whole (contain) with no
// tile of their own instead, and fill the gap it leaves from the photo's two exposed sides, each on its own
// (cardFill, global.css [data-photo-fill]).
import { createTtlMap } from './cache';
import { MEDIA_BASE_URL } from './img';

export interface RawPixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** 3 = RGB, 4 = RGBA. */
  channels: number;
}

/** The decision thresholds (see edgeColour). */
export const EDGE_RULES = {
  /** Band width sampled along each side, as a share of the shorter side (at least 1px). */
  ring: 0.02,
  /** A pixel "matches" the backdrop when every channel is within this many levels of the median. */
  tolerance: 6,
  /** Share of each side's pixels that must match: below it the subject (or a scene) runs into the frame. */
  sideShare: 0.95,
  /** Each side's own median may differ from the overall one by at most this much (catches gradient backdrops). */
  sideAgree: 4,
  /** Every channel at or above this counts as white: multiply on #f5f5f5 already blends it in (245·253/255 ≈ 243,
   *  2 levels off), while one step darker leaves a visible box (252 → 242, 3 levels; #f8 → 7 levels). */
  whiteMin: 0xfd,
  /** Pixels with alpha below this are see-through; more than `alphaShare` of the band like that gives up. */
  alphaMin: 250,
  alphaShare: 0.01,
  /** Per-side reading (readEdges): each side band is cut into this many runs along its length, each of which must
   *  be one colour (sideShare within tolerance of its own median)... */
  chunks: 8,
  /** ...and whose medians may drift at most this far apart (a soft studio vignette or floor shadow passes; a floor
   *  line or a subject in the band doesn't), so the band's one colour is within about half of that everywhere. */
  chunkRange: 9,
  /** A smooth side whose runs drift at least this far keeps them (PhotoEdges.drift), so the tile follows it with a
   *  gradient instead of one colour that would leave a seam at either end. */
  driftMin: 3,
  /** photoFit: a photo within this share of the tile's aspect fills it (`cover` trims at most half of it per side). */
  fillTol: 0.02,
  /** Card lanes (readEdges `lanes`, cardFill): each side is read as this many runs along it... */
  lanes: 40,
  /** ...from a band this share of the shorter side wide (at least 2px, after the skipped outermost pixel), so a
   *  run's colour is the photo's very edge, the pixels that meet the gap (a wide band lags a darkening vignette)... */
  laneBand: 0.005,
  /** ...and a run is backdrop when this share of its pixels is within `tolerance` of its median (else the subject
   *  is in it: null). */
  laneShare: 0.95,
  /** cardFill: a side needs at least this share of backdrop runs to be read (less: the subject covers it, and the
   *  other side's fill stands in)... */
  laneMin: 0.25,
  /** ...and its backdrop runs may span at most this many levels: more is a scene (sky, sand, a room), not a studio
   *  backdrop, and the gap is left to the page. Studio vignettes and floors here span 14-23. */
  laneRange: 32,
  /** cardFill: neighbouring backdrop runs differ by at most this many levels per run between them (a floor shadow
   *  steps ~8); a run that jumps further from the backdrop is the subject in one flat colour (a sleeve), however
   *  uniform. Capped at laneRange across a long gap. */
  laneStep: 10,
  /** A lane whose runs all sit within this many levels is drawn as one colour, and a gradient drops every stop that
   *  sits within this many levels of the straight line between the stops kept either side of it. */
  laneFlat: 1,
  /** cardFill: a photo within this share of square leaves no gap (under a pixel a side in a card). */
  cardSquareTol: 0.005,
  /** cardFill: each open side needs at least this share of its runs to be backdrop for the gap to be filled; less
   *  means the subject reaches that side of the photo (an arm, a ball, a shoe), which would leave a seam, so the
   *  photo zooms to fill the tile instead (owner, 2026-10-28). */
  cardCleanMin: 0.9,
};

const HEX = /^#[0-9a-f]{6}$/;
const hex = (rgb: number[]) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

/** Median of the counts in a 256-bin histogram holding `n` values. */
function histMedian(hist: Uint32Array, n: number): number {
  const half = n / 2;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= half) return v;
  }
  return 255;
}

/** The photo's backdrop colour as `#rrggbb`, read from a thin band along its four sides — or null when the edge is
 *  white (the default tile already matches), see-through, or not one flat colour (a subject touching the frame, a
 *  scene, a gradient). The outermost pixel is skipped: resizing and JPEG leave artefacts there. */
export function edgeColour(px: RawPixels, rules = EDGE_RULES): string | null {
  const { data, width: w, height: h, channels: ch } = px;
  if (w < 3 || h < 3 || (ch !== 3 && ch !== 4)) return null;
  const skip = Math.min(w, h) >= 20 ? 1 : 0;
  const t = Math.max(1, Math.round(Math.min(w, h) * rules.ring));
  // [x0, x1) × [y0, y1) for top, bottom, left, right (the side bands stop short of the top/bottom ones)
  const sides = [
    [skip, w - skip, skip, skip + t],
    [skip, w - skip, h - skip - t, h - skip],
    [skip, skip + t, skip + t, h - skip - t],
    [w - skip - t, w - skip, skip + t, h - skip - t],
  ];
  const total = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const sideHists = sides.map(() => [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]);
  const sideCount = sides.map(() => 0);
  let n = 0;
  let clear = 0;
  sides.forEach(([x0, x1, y0, y1], s) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * ch;
        if (ch === 4 && data[i + 3] < rules.alphaMin) clear++;
        for (let c = 0; c < 3; c++) {
          total[c][data[i + c]]++;
          sideHists[s][c][data[i + c]]++;
        }
        sideCount[s]++;
        n++;
      }
  });
  if (n === 0 || clear > n * rules.alphaShare) return null;
  const median = total.map((hist) => histMedian(hist, n));
  if (median.every((v) => v >= rules.whiteMin)) return null;
  for (let s = 0; s < sides.length; s++) {
    if (sideCount[s] === 0) continue;
    const m = sideHists[s].map((hist) => histMedian(hist, sideCount[s]));
    if (m.some((v, c) => Math.abs(v - median[c]) > rules.sideAgree)) return null;
    // every side must be (almost) all backdrop
    const [x0, x1, y0, y1] = sides[s];
    let match = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * ch;
        if (
          Math.abs(data[i] - median[0]) <= rules.tolerance &&
          Math.abs(data[i + 1] - median[1]) <= rules.tolerance &&
          Math.abs(data[i + 2] - median[2]) <= rules.tolerance
        )
          match++;
      }
    if (match < sideCount[s] * rules.sideShare) return null;
  }
  return hex(median);
}

type Four<T> = [T, T, T, T];

/** What the sampler remembers about a photo: its shape, the whole-ring colour (edgeColour: the padded tile, and the
 *  only colour the hero, swatches and wishlist use), each side's own backdrop colour, or null where that side isn't
 *  one smooth colour (the subject runs into it, or a scene), and, for a smooth side whose shade drifts along it (a
 *  studio vignette), its colour run by run (top to bottom, left to right). Sides in CSS order: top, right, bottom,
 *  left. */
export interface PhotoEdges {
  w: number;
  h: number;
  ring: string | null;
  sides: Four<string | null>;
  drift: Four<string[] | null>;
  /** The card tile's reading (cardFill): each side's very edge as rules.lanes runs along it (top to bottom, left to
   *  right), each run's colour, or null where the subject is in it. Absent on a reading cached before it existed. */
  lanes?: Four<(string | null)[]>;
}

/** One side band's colour when it is smooth backdrop: every run along it (rules.chunks) nearly all one colour
 *  (sideShare within tolerance of that run's median), and the runs' medians all within chunkRange; with the runs'
 *  colours when they drift by driftMin or more. */
function readSide(px: RawPixels, [x0, x1, y0, y1]: number[], alongY: boolean, rules: typeof EDGE_RULES): { colour: string; drift: string[] | null } | null {
  const { data, width: w, channels: ch } = px;
  const len = alongY ? y1 - y0 : x1 - x0;
  const k = Math.max(1, Math.min(rules.chunks, len));
  const all = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  let match = 0;
  const runs: string[] = [];
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (let c = 0; c < k; c++) {
    const a = Math.floor((c * len) / k);
    const b = Math.floor(((c + 1) * len) / k);
    const [cx0, cx1, cy0, cy1] = alongY ? [x0, x1, y0 + a, y0 + b] : [x0 + a, x0 + b, y0, y1];
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let m = 0;
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        const i = (y * w + x) * ch;
        for (let j = 0; j < 3; j++) {
          hist[j][data[i + j]]++;
          all[j][data[i + j]]++;
        }
        m++;
      }
    if (m === 0) continue;
    const med = hist.map((h) => histMedian(h, m));
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        const i = (y * w + x) * ch;
        if (med.every((v, j) => Math.abs(data[i + j] - v) <= rules.tolerance)) match++;
      }
    med.forEach((v, j) => {
      lo[j] = Math.min(lo[j], v);
      hi[j] = Math.max(hi[j], v);
    });
    runs.push(hex(med));
    n += m;
  }
  if (n === 0 || match < n * rules.sideShare || hi.some((v, j) => v - lo[j] > rules.chunkRange)) return null;
  const drifts = hi.some((v, j) => v - lo[j] >= rules.driftMin);
  return { colour: hex(all.map((h) => histMedian(h, n))), drift: drifts ? runs : null };
}

/** One side's lane (PhotoEdges.lanes): the band [x0, x1) × [y0, y1) cut into rules.lanes runs along it, each run's
 *  median colour, or null when fewer than laneShare of its pixels are within tolerance of it (the subject). */
function readLane(px: RawPixels, [x0, x1, y0, y1]: number[], alongY: boolean, rules: typeof EDGE_RULES): (string | null)[] {
  const { data, width: w, channels: ch } = px;
  const len = alongY ? y1 - y0 : x1 - x0;
  const k = Math.max(1, Math.min(rules.lanes, len));
  return Array.from({ length: k }, (_, c) => {
    const a = Math.floor((c * len) / k);
    const b = Math.floor(((c + 1) * len) / k);
    const [cx0, cx1, cy0, cy1] = alongY ? [x0, x1, y0 + a, y0 + b] : [x0 + a, x0 + b, y0, y1];
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let m = 0;
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++, m++) for (let j = 0; j < 3; j++) hist[j][data[(y * w + x) * ch + j]]++;
    if (m === 0) return null;
    const med = hist.map((h) => histMedian(h, m));
    let match = 0;
    for (let y = cy0; y < cy1; y++)
      for (let x = cx0; x < cx1; x++) {
        const i = (y * w + x) * ch;
        if (med.every((v, j) => Math.abs(data[i + j] - v) <= rules.tolerance)) match++;
      }
    return match >= m * rules.laneShare ? hex(med) : null;
  });
}

/** Everything photoFit and cardFill need about a photo, read from its pixels; null when it's too small or its edge is
 *  see-through (the default tile shows through it already). The outermost pixel is skipped, as in edgeColour. */
export function readEdges(px: RawPixels, rules = EDGE_RULES): PhotoEdges | null {
  const { data, width: w, height: h, channels: ch } = px;
  if (w < 3 || h < 3 || (ch !== 3 && ch !== 4)) return null;
  const skip = Math.min(w, h) >= 20 ? 1 : 0;
  const t = Math.max(1, Math.round(Math.min(w, h) * rules.ring));
  // full-length bands: a subject in a corner belongs to both sides it touches
  const bands = [
    [skip, w - skip, skip, skip + t],
    [w - skip - t, w - skip, skip, h - skip],
    [skip, w - skip, h - skip - t, h - skip],
    [skip, skip + t, skip, h - skip],
  ];
  if (ch === 4) {
    let n = 0;
    let clear = 0;
    for (const [x0, x1, y0, y1] of bands)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++, n++) if (data[(y * w + x) * 4 + 3] < rules.alphaMin) clear++;
    if (clear > n * rules.alphaShare) return null;
  }
  const read = bands.map((b, s) => readSide(px, b, s % 2 === 1, rules));
  // the lanes' thin bands, full length: the outermost pixel skipped, then `lb` pixels in
  const lb = Math.max(2, Math.round(Math.min(w, h) * rules.laneBand));
  const laneBands = [
    [0, w, skip, skip + lb],
    [w - skip - lb, w - skip, 0, h],
    [0, w, h - skip - lb, h - skip],
    [skip, skip + lb, 0, h],
  ];
  return {
    w,
    h,
    ring: edgeColour(px, rules),
    sides: read.map((r) => r?.colour ?? null) as Four<string | null>,
    drift: read.map((r) => r?.drift ?? null) as Four<string[] | null>,
    lanes: laneBands.map((b, s) => readLane(px, b, s % 2 === 1, rules)) as Four<(string | null)[]>,
  };
}

/** The tiles' shapes (width / height) as global.css draws them: .product-card__media (aspect-ratio 1, cardFill),
 *  .pdp-gallery__item a (4 / 5) and .pdp-thumb (60×60) (photoFit). The answers depend on the tile, so keep these in
 *  step with the CSS. */
export const TILE_ASPECT = { card: 1, gallery: 4 / 5, thumb: 1 } as const;

export type PhotoPos = 'top' | 'right' | 'bottom' | 'left';
/** How a tile shows its photo. 'pad': the photo's whole edge is one colour, so the tile takes it and keeps its
 *  usual padding. 'contain': the photo is drawn edge to edge (no padding) so the sides the subject is cut by sit
 *  on the tile's edges, and the tile takes the colour of the sides left showing, the photo anchored to `pos` when
 *  only one of those is clear, and a gradient along them (`grad`, axis 'y' down the left and right sides, 'x' across
 *  the top and bottom) when their shade drifts. 'cover': the photo has (almost) the tile's shape and fills it. */
export interface PhotoFit {
  colour: string;
  fit: 'pad' | 'contain' | 'cover';
  pos?: PhotoPos;
  grad?: { axis: 'x' | 'y'; stops: string[] };
}

const SIDE_NAMES: PhotoPos[] = ['top', 'right', 'bottom', 'left'];
const rgbOf = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** The tile for a photo (`edges`) in a tile of aspect `tileAspect` (width / height), or null for the default tile.
 *  `imgAspect` overrides the photo's own shape when the tile shows another rendition (WP's square thumbnail).
 *  Only the photo's sides that land inside the tile can show a seam: with the photo drawn edge to edge, a photo
 *  narrower than the tile exposes its left and right sides, a wider one its top and bottom. Both clear and of
 *  one colour: centred on it. One clear: anchored to the other (the subject's crop sits on the tile edge). Neither:
 *  the crop would float or the product would be cut, so the default tile. Scenes (no smooth side at all) and white
 *  backdrops (multiply on the default tile hides them) keep the default tile too. */
export function photoFit(edges: PhotoEdges | null | undefined, tileAspect: number, imgAspect?: number, rules = EDGE_RULES): PhotoFit | null {
  if (!edges) return null;
  if (edges.ring) return { colour: edges.ring, fit: 'pad' };
  const ratio = (imgAspect ?? edges.w / edges.h) / tileAspect;
  const white = (c: string) => rgbOf(c).every((v) => v >= rules.whiteMin);
  const mean = (cs: string[]) => {
    const rgb = cs.map(rgbOf);
    const m = [0, 1, 2].map((j) => Math.round(rgb.reduce((s, p) => s + p[j], 0) / rgb.length));
    return rgb.every((p) => p.every((v, j) => Math.abs(v - m[j]) <= rules.sideAgree)) ? hex(m) : null;
  };
  let colour: string | null;
  let pos: PhotoPos | undefined;
  let grad: PhotoFit['grad'];
  let fit: PhotoFit['fit'] = 'contain';
  if (Math.abs(ratio - 1) <= rules.fillTol) {
    // nothing is exposed; the colour only shows through a rounding gap. Still needs some flat backdrop: a scene
    // keeps the default tile.
    const clear = edges.sides.filter((c): c is string => c !== null);
    colour = clear.length ? mean(clear) : null;
    fit = 'cover';
  } else {
    const [a, b] = ratio < 1 ? [3, 1] : [0, 2]; // left & right, or top & bottom
    const ca = edges.sides[a];
    const cb = edges.sides[b];
    colour = ca && cb ? mean([ca, cb]) : ca ?? cb;
    if (ca && !cb) pos = SIDE_NAMES[b];
    if (cb && !ca) pos = SIDE_NAMES[a];
    // the exposed sides' drift, run by run (a flat side counts as its one colour all along); both sides are read
    // in the same direction and run count, so run i of one sits beside run i of the other
    const da = ca ? edges.drift[a] : null;
    const db = cb ? edges.drift[b] : null;
    const runs = (da ?? db)?.length;
    if (colour && runs) {
      const along = (c: string, d: string[] | null) => (d?.length === runs ? d : Array<string>(runs).fill(c));
      const lanes = [ca && along(ca, da), cb && along(cb, db)].filter((l): l is string[] => !!l);
      const stops = Array.from({ length: runs }, (_, i) => {
        const rgb = lanes.map((l) => rgbOf(l[i]));
        return hex([0, 1, 2].map((j) => Math.round(rgb.reduce((s, p) => s + p[j], 0) / rgb.length)));
      });
      grad = { axis: ratio < 1 ? 'y' : 'x', stops };
    }
  }
  if (!colour || white(colour)) return null;
  return { colour, fit, ...(pos ? { pos } : {}), ...(grad ? { grad } : {}) };
}

/** How a card tile fills the gap its contained photo leaves (cardFill): `axis` 'y' for a photo taller than the tile
 *  (gaps left and right, each lane top to bottom), 'x' for a wider one (gaps above and below, each lane left to
 *  right). `lanes`: [left, right] or [top, bottom], each the run colours along that side of the photo (one colour
 *  when it's flat), or null to leave that gap to the white page. */
export interface CardFill {
  axis: 'x' | 'y';
  lanes: [string[] | null, string[] | null];
  /** No side can be matched (a scene, or the subject covers both gaps): the photo is zoomed to fill the tile (cover)
   *  instead of leaving a box (owner, 2026-10-28). */
  zoom?: true;
}

/** One side's fill from its lane, or null when there's too little backdrop to read (the subject covers it) or it
 *  isn't a backdrop at all (a scene: its backdrop runs span more than laneRange). The backdrop is the largest set of
 *  runs that step smoothly from one to the next (laneStep per run between them); other flat runs are the subject.
 *  Runs the subject is in are bridged from the backdrop runs either side of them (held past the first and last); a
 *  lane within laneFlat of flat is one colour. */
function laneFill(lane: (string | null)[], rules: typeof EDGE_RULES): string[] | null {
  const dist = (p: number[], q: number[]) => Math.max(...p.map((v, j) => Math.abs(v - q[j])));
  // each flat run joins the first chain whose last run it steps smoothly from, else starts its own
  const chains: { i: number; rgb: number[] }[][] = [];
  lane.forEach((c, i) => {
    if (!c || !HEX.test(c)) return;
    const rgb = rgbOf(c);
    const chain = chains.find((ch) => {
      const last = ch[ch.length - 1];
      return dist(last.rgb, rgb) <= Math.min(rules.laneStep * (i - last.i), rules.laneRange);
    });
    if (chain) chain.push({ i, rgb });
    else chains.push([{ i, rgb }]);
  });
  const known = chains.reduce<{ i: number; rgb: number[] }[]>((best, ch) => (ch.length > best.length ? ch : best), []);
  if (known.length === 0 || known.length < lane.length * rules.laneMin) return null;
  // the subject reaches this side over too much of it: a fill would leave a seam there (cardFill zooms instead)
  if (known.length < lane.length * rules.cardCleanMin) return null;
  const spread = (rgbs: number[][]) => Math.max(...[0, 1, 2].map((j) => Math.max(...rgbs.map((p) => p[j])) - Math.min(...rgbs.map((p) => p[j]))));
  if (spread(known.map((k) => k.rgb)) > rules.laneRange) return null;
  let next = 0;
  const filled = lane.map((_, i) => {
    while (next < known.length - 1 && known[next].i < i) next++;
    const after = known[next];
    const before = known[next - 1];
    if (after.i === i || !before || after.i < i) return after.rgb;
    const t = (i - before.i) / (after.i - before.i);
    return before.rgb.map((v, j) => Math.round(v + (after.rgb[j] - v) * t));
  });
  if (spread(filled) <= rules.laneFlat) return [hex([0, 1, 2].map((j) => Math.round(filled.reduce((s, p) => s + p[j], 0) / filled.length)))];
  return filled.map(hex);
}

/** The card tile's fill for a photo shown whole (contain) in it: only the photo's two sides that face a gap matter
 *  (left and right for a photo taller than the tile, top and bottom for a wider one; the other two touch the tile's
 *  edge), and each gap is filled from its own side's lane, run by run, so the colour meets the photo's edge all along
 *  it; a white side is left to the page. When either side can't be matched cleanly (a scene, or the subject reaches
 *  that side of the photo) the photo zooms to fill the tile instead (`zoom`). Null: nothing
 *  to do (a square photo, a white photo, no lanes read). */
export function cardFill(edges: PhotoEdges | null | undefined, rules = EDGE_RULES): CardFill | null {
  if (!edges?.lanes) return null;
  const ratio = edges.w / edges.h / TILE_ASPECT.card;
  if (Math.abs(ratio - 1) <= rules.cardSquareTol) return null;
  const [a, b] = ratio < 1 ? [3, 1] : [0, 2];
  const fa = laneFill(edges.lanes[a], rules);
  const fb = laneFill(edges.lanes[b], rules);
  // either open side unreadable (a scene, or the subject reaches it): zoom rather than leave a seam
  if (!fa || !fb) return { axis: ratio < 1 ? 'y' : 'x', lanes: [null, null], zoom: true };
  const white = (lane: string[]) => lane.every((c) => rgbOf(c).every((v) => v >= rules.whiteMin));
  const lanes = [fa ?? fb!, fb ?? fa!].map((l) => (white(l) ? null : l)) as CardFill['lanes'];
  return lanes[0] || lanes[1] ? { axis: ratio < 1 ? 'y' : 'x', lanes } : null;
}

/** The runs of a lane a gradient needs: the first and last, and each one the straight line between the previous
 *  kept run and the one after it would miss by more than `flat` levels (checked against every run it would skip). */
function keptStops(rgb: number[][], flat: number): number[] {
  const kept = [0];
  for (let i = 1; i < rgb.length - 1; i++) {
    const a = kept[kept.length - 1];
    const b = i + 1;
    const off = (j: number) => Math.max(...rgb[j].map((v, c) => Math.abs(v - (rgb[a][c] + ((rgb[b][c] - rgb[a][c]) * (j - a)) / (b - a)))));
    for (let j = a + 1; j < b; j++)
      if (off(j) > flat) {
        kept.push(i);
        break;
      }
  }
  if (rgb.length > 1) kept.push(rgb.length - 1);
  return kept;
}

/** A lane as a CSS image: one colour, or a gradient along the photo with each run at the middle of its stretch (the
 *  photo spans the tile along that axis), keeping only the stops its shape needs (keptStops). */
function laneImage(lane: string[], axis: CardFill['axis'], rules = EDGE_RULES): string {
  if (lane.length === 1) return `linear-gradient(${lane[0]},${lane[0]})`;
  const n = lane.length;
  const stops = keptStops(lane.map(rgbOf), rules.laneFlat).map((i) => `${lane[i]} ${+(((i + 0.5) * 100) / n).toFixed(2)}%`);
  return `linear-gradient(${axis === 'y' ? 'to bottom' : 'to right'},${stops.join(',')})`;
}

/** The card tile's CSS variables for its fill (global.css [data-photo-fill]): one image per gap, `none` for a gap
 *  left to the page; undefined when there's nothing (valid) to draw. */
function cardFillVars(fill: CardFill | null | undefined): Record<string, string> | undefined {
  if (!fill || (fill.axis !== 'x' && fill.axis !== 'y') || !Array.isArray(fill.lanes) || fill.lanes.length !== 2) return undefined;
  const ok = (l: string[] | null) => l === null || (Array.isArray(l) && l.length > 0 && l.every((c) => HEX.test(c)));
  if (!fill.lanes.every(ok) || !fill.lanes.some(Boolean)) return undefined;
  const [a, b] = fill.lanes.map((l) => (l ? laneImage(l, fill.axis) : 'none'));
  return { '--photo-fill-a': a, '--photo-fill-b': b };
}

/** Attributes to spread on a card tile (ProductCard) for its fill, or none. */
export function cardFillAttrs(fill: CardFill | null | undefined): Record<string, string> {
  if (fill?.zoom === true) return { 'data-photo-fill': 'zoom' };
  const vars = cardFillVars(fill);
  return vars ? { 'data-photo-fill': fill!.axis, style: Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') } : {};
}

/** The same for a React element (WishlistView, whose cards come from /api/products): `{...cardFillProps(fill)}`. */
export function cardFillProps(fill: CardFill | null | undefined): Record<string, unknown> {
  if (fill?.zoom === true) return { 'data-photo-fill': 'zoom' };
  const vars = cardFillVars(fill);
  return vars ? { 'data-photo-fill': fill!.axis, style: vars } : {};
}

/** The aspect (width / height) of a WordPress sub-size from its `-WxH` file-name suffix, if it has one. */
export function subSizeAspect(url: string): number | undefined {
  const m = url.match(/-(\d+)x(\d+)\.[a-z0-9]+(?:[?#].*)?$/i);
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  return w > 0 && h > 0 ? w / h : undefined;
}

const MEDIA_HOST = new URL(MEDIA_BASE_URL).host;

/** Only files in the media library on MEDIA_BASE_URL's host are ever fetched (no arbitrary URLs from WordPress data). */
export function isMediaFile(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.host === MEDIA_HOST && !u.username && !u.password && u.pathname.startsWith('/wp-content/uploads/');
}

/** Narrowest candidate worth sampling: WordPress' 50px and 150px sub-sizes are mostly JPEG noise at the edge. */
const MIN_SAMPLE_WIDTH = 300;

/** The srcset candidate to sample: the narrowest at least MIN_SAMPLE_WIDTH wide (a 360px file of a few KB instead
 *  of the 2560px original), else the widest there is, else `src` itself. */
export function sampleCandidate(src: string, srcset?: string): string {
  const list = (srcset ?? '')
    .split(',')
    .map((part) => part.trim().match(/^(\S+)\s+(\d+)w$/))
    .flatMap((m) => (m ? [{ url: m[1], w: Number(m[2]) }] : []))
    .sort((a, b) => a.w - b.w);
  return (list.find((c) => c.w >= MIN_SAMPLE_WIDTH) ?? list.at(-1))?.url ?? src;
}

/** The tile's inline style for a known colour (anything that isn't a plain #rrggbb is dropped). */
export function photoBgStyle(colour: string | null | undefined): string | undefined {
  return colour && HEX.test(colour) ? `--photo-bg:${colour}` : undefined;
}

/** Attributes to spread on a photo tile: the colour and the marker that turns multiply off — or none. */
export function photoBgAttrs(colour: string | null | undefined): Record<string, string> {
  const style = photoBgStyle(colour);
  return style ? { 'data-photo-bg': '', style } : {};
}

/** The same for a React element: `{...photoBgProps(colour)}`. */
export function photoBgProps(colour: string | null | undefined): { 'data-photo-bg'?: ''; style?: Record<string, string> } {
  return photoBgStyle(colour) ? { 'data-photo-bg': '', style: { '--photo-bg': colour! } } : {};
}

/** Attributes to spread on a PDP gallery or thumbnail tile for its photoFit: the colour, plus the fit and anchor of a photo drawn
 *  edge to edge (global.css [data-photo-fit]) — or none for the default tile. */
export function photoFitAttrs(fit: PhotoFit | null | undefined): Record<string, string> {
  const { data, vars } = photoFitParts(fit);
  if (!vars) return {};
  return { ...data, style: Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') };
}

/** The decision behind photoFitAttrs: the data attributes and the CSS variables, or no vars
 *  (the default tile) when the colour isn't a plain #rrggbb. */
function photoFitParts(fit: PhotoFit | null | undefined): { data: Record<string, string>; vars?: Record<string, string> } {
  if (!fit || !photoBgStyle(fit.colour)) return { data: {} };
  const vars: Record<string, string> = { '--photo-bg': fit.colour };
  if (fit.fit === 'pad') return { data: { 'data-photo-bg': '' }, vars };
  const grad = photoGrad(fit);
  if (grad) vars['--photo-grad'] = grad;
  return {
    data: { 'data-photo-bg': '', 'data-photo-fit': fit.fit, ...(fit.pos ? { 'data-photo-pos': fit.pos } : {}) },
    vars,
  };
}

/** The tile's gradient (global.css --photo-grad) for a drifting backdrop: each run's colour at the middle of its
 *  stretch of the tile, the photo spanning the tile along that axis. Anything but plain #rrggbb stops is dropped. */
function photoGrad(fit: PhotoFit): string | undefined {
  const g = fit.grad;
  if (!g || g.stops.length === 0 || !g.stops.every((c) => HEX.test(c))) return undefined;
  const n = g.stops.length;
  const stops = g.stops.map((c, i) => `${c} ${+(((i + 0.5) * 100) / n).toFixed(2)}%`);
  return `linear-gradient(${g.axis === 'y' ? 'to bottom' : 'to right'},${stops.join(',')})`;
}

/** Repaint a tile in the browser after its photo was swapped (the PDP's variation photo): its colour, fit and
 *  anchor, each cleared when the new photo has none (back to the default tile when it has no fit at all). */
export function applyPhotoFit(tile: HTMLElement, fit: PhotoFit | null | undefined): void {
  const attrs = photoFitAttrs(fit);
  for (const name of ['data-photo-bg', 'data-photo-fit', 'data-photo-pos']) {
    if (name in attrs) tile.setAttribute(name, attrs[name]);
    else tile.removeAttribute(name);
  }
  if (attrs.style) tile.style.setProperty('--photo-bg', fit!.colour);
  else tile.style.removeProperty('--photo-bg');
  const grad = attrs.style && photoGrad(fit!);
  if (grad) tile.style.setProperty('--photo-grad', grad);
  else tile.style.removeProperty('--photo-grad');
}

export interface PhotoBgCache<T> {
  /** The cached reading (null: keep the default tile) at once, or undefined on a miss. A miss or a stale entry
   *  queues a background sample; the page renders with what's known now and later renders get the result. */
  lookup(src: string, srcset?: string): T | null | undefined;
  /** Resolves when nothing is queued or running (tests, warm-up). */
  idle(): Promise<void>;
}

/** An in-process, size-bounded cache of photo readings (PhotoEdges) keyed by the photo's src. Samples (fetch +
 *  decode) run in the background, at most `concurrency` at once, one per src however many renders ask; the queue is
 *  capped so a crawl can't grow it without bound (a dropped src is simply asked for again on a later render). A decided
 *  reading or null lives `ttlMs`; a failed sample (timeout, HTTP error, bad file) only `errorTtlMs`. */
export function createPhotoBgCache<T>(opts: {
  sample: (url: string) => Promise<T | null>;
  now?: () => number;
  ttlMs?: number;
  errorTtlMs?: number;
  maxEntries?: number;
  concurrency?: number;
  maxQueue?: number;
  warn?: (url: string, err: unknown) => void;
}): PhotoBgCache<T> {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  const errorTtlMs = opts.errorTtlMs ?? 10 * 60 * 1000;
  const concurrency = opts.concurrency ?? 4;
  const maxQueue = opts.maxQueue ?? 500;
  let lastWarn = -Infinity;
  const warn =
    opts.warn ??
    ((url: string, err: unknown) => {
      if (now() - lastWarn < 60_000) return; // one line a minute, not one per photo, when the media host is down
      lastWarn = now();
      console.warn('[photoBg] sample failed:', url, err instanceof Error ? err.message : err);
    });
  const entries = createTtlMap<string, T | null>(opts.maxEntries ?? 5000, now);
  const queue: { key: string; url: string }[] = [];
  const pending = new Set<string>();
  let active = 0;
  let waiters: (() => void)[] = [];

  const settle = () => {
    if (active > 0 || queue.length > 0) return;
    const w = waiters;
    waiters = [];
    w.forEach((resolve) => resolve());
  };
  const pump = () => {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift()!;
      active++;
      Promise.resolve()
        .then(() => opts.sample(job.url))
        .then(
          (value) => entries.set(job.key, value ?? null, ttlMs),
          (err) => {
            // A failed re-sample keeps the last reading (a blip must not flip known tiles back to the default); with
            // none, null. Either way it is not asked again for errorTtlMs.
            entries.set(job.key, entries.get(job.key)?.value ?? null, errorTtlMs);
            warn(job.url, err);
          },
        )
        .finally(() => {
          active--;
          pending.delete(job.key);
          pump();
          settle();
        });
    }
  };

  return {
    lookup(src, srcset) {
      if (!isMediaFile(src)) return null;
      const hit = entries.get(src);
      if (hit?.fresh) return hit.value;
      if (!pending.has(src) && queue.length < maxQueue) {
        const candidate = sampleCandidate(src, srcset);
        pending.add(src);
        queue.push({ key: src, url: isMediaFile(candidate) ? candidate : src });
        pump();
      }
      return hit ? hit.value : undefined;
    },
    idle() {
      return new Promise((resolve) => {
        waiters.push(resolve);
        settle();
      });
    },
  };
}
