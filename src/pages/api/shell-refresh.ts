import type { APIRoute } from 'astro';
import { createLimiter } from '../../lib/rateLimit';
import { jsonResponse, tooManyRequests } from '../../lib/http';
import { log, runtimeEnv } from '../../lib/logger';
import { parseShellPoke, pokeKeyMatches, readCappedBody } from '../../lib/shellPoke';
import { dropPage, invalidateListings, invalidatePaths, invalidateProducts, knowsPath } from '../../lib/shellRuntime';
import { forgetAllProducts, forgetProduct } from '../../lib/woo';
import { forgetAllGrids } from '../../lib/storeCatalog';
import { visitorKey } from '../../lib/visitor';

export const prerender = false;

// WordPress's "a product was saved / removed" poke (wp-mu-plugins/mos-shell-poke.php).
//
// With MOS_SHELL_POKE_KEY set (and the same value in WordPress as MOS_SHELL_POKE_KEY, sent as X-Mos-Shell-Key), only
// WordPress can poke: other callers are refused before anything is counted, and the "every product" mark is honoured.
// Without it (the fallback; set the key in production), the route is bounded by a budget of PATH ACTIONS, not requests:
// 600 a minute for the whole process and 300 a minute per address (WordPress is one address, so its share is the one a
// bulk edit uses); a request costs at least one action. Only paths with a stored page, a poke waiting for a render, or a
// render running now are marked or dropped; the others only have their product cache entry forgotten. The "every
// product" mark is refused (WordPress sends bulk changes in batches then); a listings mark is honoured at most once in
// five minutes. Refusals are counted and logged once a minute, never with their bodies.
const keyedLimiter = createLimiter(600, 60_000);
const pathsAll = createLimiter(600, 60_000);
const pathsByAddress = createLimiter(300, 60_000);
// Unkeyed requests per address, counted before the body is read, so malformed bodies are bounded too.
const anonRequests = createLimiter(300, 60_000);
const BROAD_EVERY_MS = 5 * 60_000;
let lastListings = -Infinity;
const refused = { count: 0, lastLog: -Infinity };

function refuse(reason: string): void {
  refused.count += 1;
  const now = Date.now();
  if (now - refused.lastLog >= 60_000) {
    log.warn('shell poke refused', { reason, refused: refused.count });
    refused.count = 0;
    refused.lastLog = now;
  }
}

/** The path's last segment, as the product slug it is (the category slug for a category path). */
const slugOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? '';

/** Takes one path action per path from the unkeyed budget, in order, until it runs out. Synchronous: nothing else can
 *  run between the check and the take. */
function takePathActions(paths: string[], address: string): { taken: string[]; refused: boolean } {
  const taken: string[] = [];
  for (const p of paths) {
    if (!pathsAll.allowed('all') || !pathsByAddress.allowed(address)) return { taken, refused: true };
    pathsAll.take('all');
    pathsByAddress.take(address);
    taken.push(p);
  }
  return { taken, refused: false };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const key = runtimeEnv('MOS_SHELL_POKE_KEY');
  if (key) {
    if (!pokeKeyMatches(request.headers.get('x-mos-shell-key'), key)) {
      refuse('key');
      return jsonResponse({ message: 'Ekki heimilað.' }, 403);
    }
    if (!keyedLimiter.take('shell-refresh')) {
      refuse('rate');
      return tooManyRequests(60);
    }
  } else if (!anonRequests.take(visitorKey({ request, clientAddress }))) {
    refuse('rate');
    return tooManyRequests(60);
  }
  const text = await readCappedBody(request);
  let poke: ReturnType<typeof parseShellPoke> = null;
  if (text !== null) {
    try {
      poke = parseShellPoke(JSON.parse(text));
    } catch {
      poke = null;
    }
  }
  if (!poke) {
    refuse('shape');
    return jsonResponse({ message: 'Ógild beiðni.' }, 400);
  }
  let productsOk = poke.products;
  let listingsOk = poke.listings;
  let stale = poke.stale;
  let drop = poke.drop;
  if (!key) {
    if (poke.products) {
      productsOk = false;
      refuse('bulk-needs-key');
    }
    if (poke.listings) {
      if (Date.now() - lastListings < BROAD_EVERY_MS) {
        listingsOk = false;
        refuse('listings');
      } else {
        lastListings = Date.now();
      }
    }
    const address = `ip:${visitorKey({ request, clientAddress })}`;
    if (poke.stale.length + poke.drop.length === 0) {
      // A request with no paths still costs one action: an empty flood is bounded like the rest.
      if (!pathsAll.allowed('all') || !pathsByAddress.allowed(address)) {
        refuse('budget');
        return tooManyRequests(60);
      }
      pathsAll.take('all');
      pathsByAddress.take(address);
    }
    const s = takePathActions(poke.stale, address);
    const d = takePathActions(poke.drop, address);
    if ((s.refused || d.refused) && s.taken.length + d.taken.length === 0) {
      refuse('budget');
      return tooManyRequests(60);
    }
    if (s.refused || d.refused) refuse('budget');
    stale = s.taken;
    drop = d.taken;
  }
  // The cached product and grids go before any mark or drop is set, and before the first await: a render that reads
  // the cache from here on sees the change WordPress has already saved.
  for (const p of [...stale, ...drop]) forgetProduct(slugOf(p));
  if (productsOk) forgetAllProducts();
  if (productsOk || listingsOk) forgetAllGrids();
  try {
    if (!key) {
      // Only paths the store holds, or has a render waiting for; the others are left alone.
      const known = async (paths: string[]) => {
        const out: string[] = [];
        for (const p of paths) if (await knowsPath(p)) out.push(p);
        return out;
      };
      stale = await known(stale);
      drop = await known(drop);
    }
    if (stale.length) await invalidatePaths(stale);
    for (const p of drop) await dropPage(p);
    if (productsOk) await invalidateProducts();
    if (listingsOk) await invalidateListings();
  } catch (err) {
    // The poke only saves a refresh: a failure here leaves pages as they were, and the editor is told so.
    log.warn('[shell] poke not applied', { err });
    return jsonResponse({ message: 'Ekki tókst.' }, 503);
  }
  log.info('shell poke', { stale: stale.length, drop: drop.length, listings: listingsOk, products: productsOk });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
