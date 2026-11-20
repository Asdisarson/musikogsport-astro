import type { APIContext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { slashRedirect } from './lib/paths';
import { movedTeamTarget, parseLiveFilters, unfilteredTarget } from './lib/liveFilters';
import { searchOnlyQuery } from './lib/facets';
import { finishResponse } from './lib/responseHeaders';
import { isCanonicalHost } from './lib/seo';
import { hstsEnabled, securityHeaders } from './lib/securityHeaders.mjs';
import { MEDIA_BASE_URL } from './lib/img';
import { installProcessHandlers, log, runtimeEnv } from './lib/logger';
import { NOTICE_PATH, PREVIEW_COOKIE, PREVIEW_PARAM, maintenanceDecision, maintenanceSettings, type MaintenanceDecision } from './lib/maintenance';
import { BACKGROUND_REFRESHES, canStore, filterValuesKnown, freshFor, normalPath, refreshAdmission, replayHeaderNames, shellPolicy, shellKey, type ShellPolicy } from './lib/shellPolicy';
import { loadCatalogTerms, peekCatalogTerms } from './lib/catalogTerms';
import { logGate, refreshBackoff, shellBuildId, shellFreshOverride, getShell } from './lib/shellRuntime';
import { armNightlyRebuild } from './lib/nightlyRebuildRuntime';
import { isIncomplete, shellTierOf } from './lib/shellIncomplete';
import type { ShellStore } from './lib/shellStore';

// Run-time switch (DEPLOY.md "Security headers"): HSTS only once DNS and TLS on the apex are settled.
const HSTS = hstsEnabled(runtimeEnv('MOS_HSTS'));
const HEADERS = securityHeaders({ mediaBaseUrl: MEDIA_BASE_URL, hsts: HSTS });
// Run-time switch (lib/maintenance): the shop closed for an update, open to the owner's preview key.
const MAINTENANCE = maintenanceSettings(runtimeEnv('MOS_MAINTENANCE'), runtimeEnv('MOS_MAINTENANCE_KEY'));
const RETRY_AFTER_S = '600';
const NOINDEX: [string, string] = ['X-Robots-Tag', 'noindex, nofollow'];

/** X-Mos-Shell: miss = rendered and kept; refused = rendered for a planned GET but the store would not keep it (scripts/prebuild_shells.mjs counts it apart). */
type ShellState = 'hit' | 'stale' | 'miss' | 'refused' | 'skip';
/** Pages being re-rendered in the background, by key: one refresh per page at a time. */
const refreshing = new Set<string>();
/** A background refresh the store did not keep is logged at most once a minute: a slow photo host makes every one of them
 *  incomplete, and each would otherwise write a line. */
const refusedRefreshLog = logGate(60 * 1000);

interface ShellPlan {
  store: ShellStore;
  key: string;
  policy: ShellPolicy;
  /** The run-time lifetime override (MOS_SHELL_FRESH_MS), or null. */
  freshOverride: number | null;
}

/** The store and this request's key, or null when the request is not one the store may serve or keep. */
async function shellPlan(ctx: APIContext): Promise<ShellPlan | null> {
  if (MAINTENANCE.enabled) return null;
  // `astro dev` answers on loopback, which is not the site's host: there the store is used so it can be checked.
  // Any host Astro trusts is kept: the page is the same whichever host it was asked on (every URL in it comes from
  // Astro.site, not the request), so the apex, new.musikogsport.is and a pre-build run through X-Forwarded-Host all
  // share one store. Astro maps a Host it does not trust to 'localhost' (security.allowedDomains): that is refused.
  const loopback = import.meta.env.DEV && /^(127\.0\.0\.1|localhost)$/.test(ctx.url.hostname);
  if (!loopback && ctx.url.hostname === 'localhost') return null;
  if (ctx.url.searchParams.has(PREVIEW_PARAM) || ctx.cookies.get(PREVIEW_COOKIE)) return null;
  const base = shellPolicy(ctx.url.pathname, ctx.url.searchParams);
  if (!base) return null;
  const store = await getShell();
  if (!store) return null;
  const freshOverride = shellFreshOverride();
  const policy = freshOverride === null ? base : { ...base, freshMs: freshOverride };
  return { store, key: shellKey(shellBuildId(), ctx.url.pathname, ctx.url.searchParams), policy, freshOverride };
}

/** Whether a rendered (pre-finish) response is complete and cacheable, then keeps its body when it is. */
function keepIfStorable(ctx: APIContext, res: Response): boolean {
  return canStore({
    method: 'GET',
    status: res.status,
    contentType: res.headers.get('Content-Type'),
    cacheControl: res.headers.get('Cache-Control'),
    setsCookie: res.headers.has('Set-Cookie') || !ctx.cookies.headers().next().done,
    incomplete: isIncomplete(ctx.locals),
    maintenance: MAINTENANCE.enabled,
    preview: false,
    canonical: true,
    hasPolicy: true,
  });
}

/** Reads a rendered page to its end and stores it. The read completes only when the stream did, so a page cut off
 *  mid-way is never stored. `renderAt` is when the render STARTED: a poke or drop that arrived during it wins. Resolves
 *  whether the page was stored, false when it was not kept or the store refused it. Never throws. */
async function keep(ctx: APIContext, plan: ShellPlan, res: Response, path: string, renderAt: number): Promise<boolean> {
  try {
    const body = await res.text();
    if (isIncomplete(ctx.locals)) return false; // a photo or count went missing while rendering: serve it, don't keep it
    const headers = [...res.headers.entries()].filter(([name]) => replayHeaderNames([name]).length > 0);
    // The page may say what it is (a product under /verslun/): that tier's lifetime, unless overridden.
    const tier = shellTierOf(ctx.locals) ?? plan.policy.tier;
    // A product with a filter in its address is a query variant of a product page: never kept.
    if (plan.policy.memoryOnly && tier === 'product') return false;
    // A filtered page is kept only when every value in its address is a term the catalogue has (the render has just
    // loaded the terms, so this is a cache read): a made-up value would be a page held in memory for nothing.
    if (plan.policy.memoryOnly && !filterValuesKnown(ctx.url.searchParams, await loadCatalogTerms())) return false;
    return await plan.store.put({
      key: plan.key,
      path: normalPath(path),
      tier,
      at: renderAt,
      freshMs: plan.freshOverride ?? freshFor(tier),
      status: 200,
      headers,
      body,
      memoryOnly: plan.policy.memoryOnly,
    });
  } catch (err) {
    log.debug('[shell] page not kept', { path, err });
    return false;
  }
}

/** Background refreshes running now, and those waiting for a slot (lib/shellPolicy refreshAdmission): a content save marks
 *  every stored page stale, and the visits after it must not start one render per page at once. */
let activeRefreshes = 0;
const waitingRefreshes: { start: () => void }[] = [];

/** Re-renders a stale page in the background. The visitor already has the stored copy; this request's own render
 *  (next() continued after the response was chosen) is kept if it is complete, and dropped otherwise. A refresh past the
 *  slots waits for one (its page reads as refreshing, so the nightly walk waits too); past the queue it is not made, and
 *  the stale copy is served as it is until the next visit. */
function refreshInBackground(ctx: APIContext, next: () => Promise<Response>, plan: ShellPlan, path: string): void {
  if (refreshing.has(plan.key) || refreshBackoff.backingOff(plan.key)) return;
  const admission = refreshAdmission(activeRefreshes, waitingRefreshes.length);
  if (admission === 'skip') return;
  refreshing.add(plan.key);
  const start = () => {
    activeRefreshes++;
    void renderRefresh(ctx, next, plan, path).finally(() => {
      activeRefreshes--;
      refreshing.delete(plan.key);
      startWaitingRefreshes();
    });
  };
  if (admission === 'start') start();
  else waitingRefreshes.push({ start });
}

function startWaitingRefreshes(): void {
  while (activeRefreshes < BACKGROUND_REFRESHES && waitingRefreshes.length > 0) waitingRefreshes.shift()!.start();
}

/** A background render the store did not keep: it backs off like a failure, and is logged at most once a minute. */
function refreshNotKept(ctx: APIContext, plan: ShellPlan, path: string): void {
  refreshBackoff.note(plan.key);
  if (refusedRefreshLog()) log.warn('[shell] background refresh not kept', { path, incomplete: isIncomplete(ctx.locals) });
}

async function renderRefresh(ctx: APIContext, next: () => Promise<Response>, plan: ShellPlan, path: string): Promise<void> {
  const endRender = plan.store.beginRender(path);
  try {
    const renderAt = Date.now(); // before the render: a poke that lands during it must win over this copy
    const res = await next();
    const status = res.status;
    // A definite answer that the page is gone or moved (a slug changed, a product unpublished and the poke lost):
    // the stored copy must not answer 200 any more.
    if (status === 404 || status === 410 || (status >= 300 && status < 400)) {
      await res.body?.cancel();
      refreshBackoff.clear(plan.key);
      await plan.store.remove(plan.key);
    } else if (keepIfStorable(ctx, res)) {
      // The refresh counts as done only once the store has the copy: a render that came back incomplete (found only
      // while its body was read) or refused is a failure, as a 5xx is, so it backs off too (review 20).
      if (await keep(ctx, plan, res, path, renderAt)) refreshBackoff.clear(plan.key);
      else refreshNotKept(ctx, plan, path);
    } else {
      // 5xx or an incomplete render: keep the stale copy (it beats an error) and wait longer before the next try.
      await res.body?.cancel();
      refreshNotKept(ctx, plan, path);
    }
  } catch (err) {
    refreshBackoff.note(plan.key);
    log.warn('[shell] refresh failed', { path, err });
  } finally {
    endRender();
  }
}

/** The page for a GET or HEAD: from the store when it has one (served at once, re-rendered if stale), otherwise
 *  rendered and kept when complete. Any failure in the store falls back to a plain render. */
async function serveShell(ctx: APIContext, next: () => Promise<Response>, path: string, method: string): Promise<{ res: Response; state: ShellState }> {
  let plan: ShellPlan | null = null;
  try {
    plan = method === 'GET' || method === 'HEAD' ? await shellPlan(ctx) : null;
    const found = plan ? await plan.store.get(plan.key) : null;
    if (plan && found && found.entry.status === 200) {
      const res = new Response(method === 'HEAD' ? null : found.entry.body, { status: 200, headers: found.entry.headers });
      if (found.state === 'stale') {
        refreshInBackground(ctx, next, plan, path);
        // Whether a render is running now: the nightly walk waits on it (src/lib/nightlyRebuild.ts), and reads idle as done.
        res.headers.set('X-Mos-Refresh', refreshing.has(plan.key) ? 'running' : 'idle');
      }
      return { res, state: found.state === 'fresh' ? 'hit' : 'stale' };
    }
  } catch (err) {
    log.warn('[shell] lookup failed', { path, err });
    plan = null;
  }
  const renderAt = Date.now(); // before the render (see keep)
  const endRender = plan ? plan.store.beginRender(path) : () => undefined; // a poke during the render is known to the store
  let res: Response;
  try {
    res = await next();
  } catch (err) {
    endRender();
    throw err;
  }
  let kept = false;
  try {
    if (plan && method === 'GET' && keepIfStorable(ctx, res)) {
      kept = true;
      void keep(ctx, plan, res.clone(), path, renderAt).finally(endRender);
    }
  } catch (err) {
    log.warn('[shell] not kept', { path, err });
  }
  if (!kept) endRender();
  if (!plan || method !== 'GET') return { res, state: 'skip' };
  return { res, state: kept ? 'miss' : 'refused' };
}

/** The team slugs in the term list as held right now, or null when none is held yet (a cold process, or WordPress has
 *  not answered). Never waits on WordPress: a stored page must not be held back for a term sweep. */
function knownTeamSlugs(): ReadonlySet<string> | null {
  const terms = peekCatalogTerms();
  return terms && !terms.degraded ? new Set(terms.teams.map((t) => t.slug)) : null;
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  // Prerendered pages run through here at build time only; their headers come from server.mjs.
  if (ctx.isPrerendered) return next();
  if (import.meta.env.PROD) installProcessHandlers(); // not under `astro dev`: Vite has its own
  // The 05:00 walk of the shell store, once per process. Production only: a dev server must never walk the live host.
  if (import.meta.env.PROD) armNightlyRebuild();

  const started = performance.now();
  const method = ctx.request.method;
  const path = ctx.url.pathname; // never the query: it can hold order keys and reset keys
  let res: Response;
  let door: MaintenanceDecision = 'pass';
  let shell: ShellState | null = null;
  try {
    // Live (WordPress) serves every page with a trailing slash and 301s the slash-less form. Mirror that for page
    // GETs only — API routes, assets and non-GET methods pass through untouched.
    const target = method === 'GET' || method === 'HEAD' ? slashRedirect(path) : null;
    door = maintenanceDecision(MAINTENANCE, {
      path,
      queryKey: ctx.url.searchParams.get(PREVIEW_PARAM),
      cookieKey: ctx.cookies.get(PREVIEW_COOKIE)?.value ?? null,
    });
    if (door === 'unlock') {
      // Remember this browser as the owner's and drop the key from the address.
      ctx.cookies.set(PREVIEW_COOKIE, MAINTENANCE.key!, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 });
      const query = new URLSearchParams(ctx.url.searchParams);
      query.delete(PREVIEW_PARAM);
      res = ctx.redirect(path + (query.size ? `?${query}` : ''), 302);
    } else if (door === 'closed') {
      const closed = { status: 503, headers: { 'Retry-After': RETRY_AFTER_S, 'Cache-Control': 'no-store' } };
      if (path.startsWith('/api/')) {
        res = Response.json({ message: 'Vefverslunin er lokuð vegna uppfærslu. Reyndu aftur innan skamms.' }, closed);
      } else {
        const notice = await ctx.rewrite(NOTICE_PATH);
        res = new Response(notice.body, { ...closed, headers: { ...closed.headers, 'Content-Type': 'text/html; charset=utf-8' } });
      }
    } else {
      // A direct request for /500/ is a missing page: Astro forces status 500 on that route (it renders it for real
      // errors, with the original path), and a public URL answering 500 would only inflate the error metrics.
      // A page URL with more filter values than a shopper picks (lib/liveFilters) goes to the same page without its
      // filters, before any lookup: each such combination would be a fresh WooCommerce query. The search text is kept
      // (the picks are what went over the limit); the rail never offers a pick that would get here (lib/facets pickNote).
      const unfiltered = (method === 'GET' || method === 'HEAD') && ctx.url.search !== '' ? unfilteredTarget(path, ctx.url.searchParams) : null;
      // A team the catalog merged into another (paths MOVED_TEAMS): the old link goes to the canonical URL with the new
      // slug, so the chips, remove links and canonical tag all read the one URL. Only once the old slug is gone from
      // WordPress; with no term list to judge by (a cold process, WordPress down) nothing moves, and the page is served
      // as before. Never for API routes.
      const teamMove = !unfiltered && !target && ctx.url.searchParams.has('team') ? movedTeamTarget(method, path, ctx.url.searchParams, knownTeamSlugs()) : null;
      if (unfiltered) {
        log.debug('filter query refused', { method, path }); // debug: a crawl would write one line per URL
        const kept = searchOnlyQuery(parseLiveFilters(ctx.url.searchParams).search);
        res = ctx.redirect((target ?? unfiltered) + (kept ? `?${kept}` : ''), 302);
      } else if (target) {
        res = ctx.redirect(target + ctx.url.search, 301);
      } else if (teamMove !== null) {
        log.debug('merged team redirected', { path }); // debug: old links are followed by crawlers too
        res = ctx.redirect(teamMove, 301);
      } else if (path === '/500/') {
        res = await ctx.rewrite('/404/');
      } else {
        // The shell store (lib/shellStore): a stored page is served from here; otherwise the render is kept if complete.
        const served = await serveShell(ctx, next, path, method);
        res = served.res;
        shell = served.state;
      }
    }
  } catch (err) {
    // Astro renders 500.astro from this; the log line is the trace.
    log.error('request failed', { method, path, status: 500, ms: Math.round(performance.now() - started), err });
    throw err;
  }
  // On any host but the site's own (new.musikogsport.is before the move) the pages are duplicates: keep them out of
  // search engines. On the real host nothing is added.
  const headers = isCanonicalHost(ctx.url.host, ctx.site) ? HEADERS : [...HEADERS, NOINDEX];
  // The query goes in so a stock-filtered listing (?lager=1) is sent no-store at the CDN, not held for 5 minutes.
  const out = finishResponse(res, { path, method, cookiesPending: !ctx.cookies.headers().next().done, cdn: !MAINTENANCE.enabled, headers, query: ctx.url.searchParams });
  if (shell !== null) out.headers.set('X-Mos-Shell', shell);
  const fields = { method, path, status: out.status, ms: Math.round(performance.now() - started) };
  // The shop closed on purpose is not an outage: keep it out of the warnings.
  if (door === 'closed') log.debug('closed for maintenance', fields);
  else if (out.status >= 500) log.warn(out.status === 503 ? 'upstream unavailable' : 'server error', fields);
  else log.debug('request', fields);
  return out;
});
