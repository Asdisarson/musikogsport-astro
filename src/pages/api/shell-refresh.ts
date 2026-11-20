import type { APIRoute } from 'astro';
import { createLimiter } from '../../lib/rateLimit';
import { jsonResponse, tooManyRequests } from '../../lib/http';
import { log, runtimeEnv } from '../../lib/logger';
import { parseShellPoke, pokeKeyMatches, readCappedBody } from '../../lib/shellPoke';
import { dropPage, invalidateListings, invalidatePaths, invalidateProducts, knowsPath } from '../../lib/shellRuntime';
import { forgetAllProducts, forgetProduct, productCached } from '../../lib/woo';
import { forgetAllGrids } from '../../lib/storeCatalog';
import { visitorKey } from '../../lib/visitor';

export const prerender = false;

// WordPress's "a product was saved / removed" poke (wp-mu-plugins/mos-shell-poke.php).
//
// With MOS_SHELL_POKE_KEY set (and the same value in WordPress as MOS_SHELL_POKE_KEY, sent as X-Mos-Shell-Key), only
// WordPress can poke: other callers are refused before anything is counted, and the "every product" mark is honoured.
// Without it (the fallback; set the key in production) the route is bounded by two budgets of PATH ACTIONS, not requests.
// Every path costs one slot of its address's share (300 a minute), before the store is asked anything, so the lookups a
// stranger can cause are bounded per address. Only a path the store holds, or has a render waiting for, also spends the
// shared pool (600 a minute for the whole process), forgets the cached product and is marked or dropped; any other path
// costs nothing more. Several addresses can still spend the shared pool between them on known paths: only the key closes
// that. The "every product" mark is refused (WordPress sends bulk changes in batches then). A listings mark is honoured
// at most once in five minutes, and that window is used only once the mark is applied. A poke cut short by a budget is
// answered 429 with the paths it did not apply, so the sender can resend exactly those. Refusals are counted and logged
// once a minute, never with their bodies or paths.
const keyedLimiter = createLimiter(600, 60_000);
const pathsAll = createLimiter(600, 60_000);
const pathsByAddress = createLimiter(300, 60_000);
// Unkeyed requests per address, counted before the body is read, so malformed bodies are bounded too.
const anonRequests = createLimiter(300, 60_000);
const BROAD_EVERY_MS = 5 * 60_000;
let lastListings = -Infinity;
// Set while an unkeyed listings mark is being applied, so two requests cannot both pass the window check.
let listingsBusy = false;
const refused = { count: 0, lastLog: -Infinity };

function refuse(reason: string, n = 1): void {
  refused.count += n;
  const now = Date.now();
  if (now - refused.lastLog >= 60_000) {
    log.warn('shell poke refused', { reason, refused: refused.count });
    refused.count = 0;
    refused.lastLog = now;
  }
}

/** The path's last segment, as the product slug it is (the category slug for a category path). */
const slugOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? '';

/** Takes one slot of the address's share per path, in order, until it runs out. Synchronous: nothing else can run
 *  between the check and the take. Runs before any lookup, so the lookups a stranger can cause are bounded too. */
function takeAddressSlots(paths: string[], address: string): { within: string[]; over: string[] } {
  for (let i = 0; i < paths.length; i++) {
    if (!pathsByAddress.allowed(address)) return { within: paths.slice(0, i), over: paths.slice(i) };
    pathsByAddress.take(address);
  }
  return { within: paths, over: [] };
}

/** Takes one shared action per known path, in order, until the shared pool runs out. Synchronous, like the above. */
function takeSharedActions(paths: string[]): { taken: string[]; untaken: string[] } {
  for (let i = 0; i < paths.length; i++) {
    if (!pathsAll.allowed('all')) return { taken: paths.slice(0, i), untaken: paths.slice(i) };
    pathsAll.take('all');
  }
  return { taken: paths, untaken: [] };
}

/** The paths the store holds, or has a render waiting for. */
async function knownPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) if (await knowsPath(p)) out.push(p);
  return out;
}

/** The paths that spend the shared pool, in order: the ones the store holds (marked or dropped), and the ones whose
 *  product is cached but which the store does not hold (only forgotten). A path neither holds costs nothing more. */
async function candidatePaths(paths: string[]): Promise<{ stored: Set<string>; all: string[] }> {
  const stored = new Set(await knownPaths(paths));
  return { stored, all: paths.filter((p) => stored.has(p) || productCached(slugOf(p))) };
}

/** 429 with the paths that were not applied (none of them marked or dropped), so the sender can resend exactly those.
 *  Never cached. */
function budgetRefused(untaken: string[]): Response {
  return new Response(JSON.stringify({ message: 'Of margar beiðnir í einu. Reyndu aftur eftir smástund.', untaken }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' },
  });
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
  let untaken: string[] = [];
  // The paths whose cached product is forgotten: the keyed poke's own paths, or (unkeyed) the paths that spend the pool.
  let forget = [...stale, ...drop];
  let claimed = false;
  if (!key) {
    if (poke.products) {
      productsOk = false;
      refuse('bulk-needs-key');
    }
    const address = `ip:${visitorKey({ request, clientAddress })}`;
    if (poke.stale.length + poke.drop.length === 0) {
      // A request with no paths still costs one slot: an empty flood is bounded like the rest.
      if (!pathsByAddress.allowed(address)) {
        refuse('budget');
        return budgetRefused([]);
      }
      pathsByAddress.take(address);
    }
    const s = takeAddressSlots(poke.stale, address);
    const d = takeAddressSlots(poke.drop, address);
    const cs = await candidatePaths(s.within);
    const cd = await candidatePaths(d.within);
    // From here to the window claim nothing awaits, so the shared pool, the window and the forgetting below are decided
    // together: no other request can pass the same check in between.
    const sh = takeSharedActions(cs.all);
    const sd = takeSharedActions(cd.all);
    stale = sh.taken.filter((p) => cs.stored.has(p));
    drop = sd.taken.filter((p) => cd.stored.has(p));
    forget = [...sh.taken, ...sd.taken];
    untaken = [...s.over, ...d.over, ...sh.untaken, ...sd.untaken];
    if (untaken.length > 0) refuse('budget', untaken.length);
    // The listings mark is decided before the path refusal below: a poke whose every path the budget refused still gets
    // its listings mark (the sender's resend carries paths only, so a mark left here would be lost).
    if (listingsOk) {
      if (Date.now() - lastListings < BROAD_EVERY_MS || listingsBusy) {
        listingsOk = false;
        refuse('listings');
      } else {
        listingsBusy = true;
        claimed = true;
      }
    }
    // A poke that applies nothing (no path, no forget, no listings) is refused whole, and then it does not use up the window.
    if (untaken.length > 0 && stale.length + drop.length + forget.length === 0 && !listingsOk) return budgetRefused(untaken);
  }
  // The cached product and grids go before any mark or drop is set: a render that reads the cache from here on sees the
  // change WordPress has already saved. Unkeyed, this comes after the store lookup above, and forgets the cached product
  // of a path the store holds or whose product is cached (a path neither holds costs nothing); it still comes before
  // their marks.
  for (const p of forget) forgetProduct(slugOf(p));
  if (productsOk) forgetAllProducts();
  if (productsOk || listingsOk) forgetAllGrids();
  try {
    if (stale.length) await invalidatePaths(stale);
    for (const p of drop) await dropPage(p);
    if (productsOk) await invalidateProducts();
    if (listingsOk) {
      await invalidateListings();
      // The window is used only now that the mark is applied: a failed mark leaves it open for the sender's retry.
      if (claimed) lastListings = Date.now();
    }
  } catch (err) {
    // The poke only saves a refresh: a failure here leaves pages as they were, and the editor is told so.
    log.warn('[shell] poke not applied', { err });
    return jsonResponse({ message: 'Ekki tókst.' }, 503);
  } finally {
    if (claimed) listingsBusy = false;
  }
  log.info('shell poke', { stale: stale.length, drop: drop.length, untaken: untaken.length, listings: listingsOk, products: productsOk });
  if (untaken.length > 0) return budgetRefused(untaken);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
