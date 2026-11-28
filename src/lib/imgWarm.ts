// The photo warm-up of a nightly run: the /img/ addresses a rendered page asks for, and a bounded pass that makes the ones
// not kept yet, so a visitor finds the kept file instead of the original. Pure: the file check and the conversion are
// passed in (src/lib/imgRuntime.ts wires them to the disk and the conversion gate), so this is tested without a server.
// A photo that fails is counted, never thrown: a failed photo is never a failed page. SERVER-ONLY by use.
import { LIGHT_VERSION } from './img';
import { cachePathFor, parseLightRequest, type LightRequest } from './imgConvert';

// The addresses the page uses (lib/img lightSources and phoneCropSources): /img/<width>[c]/<format>/<version>/<rel>. The
// rel path ends at a space, a comma (srcset separator) or a quote; the parser checks the rest.
const ADDRESS = /\/img\/([1-9]\d*c?)\/(avif|webp)\/(v\d+)\/([^\s"'<>,]+)/g;

const HTML_ENTITY = /&(amp|lt|gt|quot|#39|#x27);/g;
const ENTITY_TEXT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };

/** The photo requests a rendered page names, of the current LIGHT_VERSION only, de-duplicated, in page order. */
export function lightRequestsIn(html: string): LightRequest[] {
  const seen = new Set<string>();
  const out: LightRequest[] = [];
  for (const m of html.matchAll(ADDRESS)) {
    const [, width, format, version, rel] = m;
    // Another version's address is an older page's: its photo is not served under the current URL, so it is not warmed.
    if (version !== LIGHT_VERSION) continue;
    // The page encodes the path (lib/img builds it from the URL's pathname); the route gets it decoded (Astro's
    // ctx.params.path), so the warm-up decodes it the same way, segment by segment. A malformed sequence skips the URL.
    // The markup escapes the attribute text (a & in a file name is &amp;): the five basic entities are read back first, in
    // one pass, so &amp;lt; is the text &lt; and not <.
    const unescaped = rel.replace(HTML_ENTITY, (_, name: string) => ENTITY_TEXT[name]);
    let decoded: string;
    try {
      decoded = unescaped
        .split('/')
        .map((s) => decodeURIComponent(s))
        .join('/');
    } catch {
      continue;
    }
    const req = parseLightRequest(width, format, decoded);
    if (!req) continue;
    const key = `${width}/${format}/${decoded}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(req);
  }
  return out;
}

/** What convert returns for a photo it did not start because stop was asked while the photo waited for its slot. */
export const NOT_ATTEMPTED: unique symbol = Symbol('not-attempted');

export interface WarmDeps {
  /** The cache folder of the current version (src/lib/imgRuntime.ts). */
  dir: string;
  /** Whether a file is kept already: a stat, not a read, so a kept photo is never loaded to be counted. */
  stat(file: string): Promise<boolean>;
  /** Makes one photo and keeps it. Throws when it cannot (a missing original, a full queue, a timeout). `stop` must be
   *  checked just before the conversion starts, inside any slot the caller waits for: when it is true, return
   *  NOT_ATTEMPTED without converting. */
  convert(req: LightRequest, stop: () => boolean): Promise<unknown>;
  /** Checked before each photo: true stops the pass (the photos not reached are not counted). */
  stop(): boolean;
  /** Photos in flight at once. Kept below the conversion queue's length so the pass never fills it (see imgRuntime). */
  parallel?: number;
}

export interface WarmTally {
  converted: number;
  kept: number;
  failed: number;
}

/** A cap on the calls in flight across every caller that shares it: a call past the cap waits for a slot before it
 *  starts, so the wait is never inside the call's own timeout (imgRuntime shares one set across all the pages). */
export function createSlots(cap: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < cap) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve)); // the finishing call hands over its slot
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/** Makes every requested photo that is not kept yet, a few at a time. Returns the counts. Never throws. */
export async function warmPhotos(requests: LightRequest[], deps: WarmDeps): Promise<WarmTally> {
  const tally: WarmTally = { converted: 0, kept: 0, failed: 0 };
  const parallel = Math.max(1, deps.parallel ?? 2);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < requests.length) {
      if (deps.stop()) return;
      const req = requests[next];
      next += 1;
      const file = cachePathFor(deps.dir, req.width, req.format, req.rel, req.crop);
      try {
        if (await deps.stat(file)) {
          tally.kept += 1;
          continue;
        }
        const made = await deps.convert(req, deps.stop);
        // Stopped while it waited for a slot: not attempted, so neither converted nor failed.
        if (made === NOT_ATTEMPTED) continue;
        // The writer logs a failed write and does not throw (imgConvert writeCached), so the file is checked: a photo
        // that is not there is a failure, not a conversion.
        if (await deps.stat(file)) tally.converted += 1;
        else tally.failed += 1;
      } catch {
        // Counted, not thrown: the queue-full refusal (429) is "failed for now", and a missing original is a failure too.
        // A photo that times out is counted failed here although its file may still be written; the next run then counts it kept.
        tally.failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, requests.length) }, () => worker()));
  return tally;
}
