import { defineMiddleware } from 'astro:middleware';
import { slashRedirect } from './lib/paths';
import { finishResponse } from './lib/responseHeaders';
import { isCanonicalHost } from './lib/seo';
import { hstsEnabled, securityHeaders } from './lib/securityHeaders.mjs';
import { MEDIA_BASE_URL } from './lib/img';
import { installProcessHandlers, log, runtimeEnv } from './lib/logger';
import { NOTICE_PATH, PREVIEW_COOKIE, PREVIEW_PARAM, maintenanceDecision, maintenanceSettings, type MaintenanceDecision } from './lib/maintenance';

// Run-time switch (DEPLOY.md "Security headers"): HSTS only once DNS and TLS on the apex are settled.
const HSTS = hstsEnabled(runtimeEnv('MOS_HSTS'));
const HEADERS = securityHeaders({ mediaBaseUrl: MEDIA_BASE_URL, hsts: HSTS });
// Run-time switch (lib/maintenance): the shop closed for an update, open to the owner's preview key.
const MAINTENANCE = maintenanceSettings(runtimeEnv('MOS_MAINTENANCE'), runtimeEnv('MOS_MAINTENANCE_KEY'));
const RETRY_AFTER_S = '600';
const NOINDEX: [string, string] = ['X-Robots-Tag', 'noindex, nofollow'];

export const onRequest = defineMiddleware(async (ctx, next) => {
  // Prerendered pages run through here at build time only; their headers come from server.mjs.
  if (ctx.isPrerendered) return next();
  if (import.meta.env.PROD) installProcessHandlers(); // not under `astro dev`: Vite has its own

  const started = performance.now();
  const method = ctx.request.method;
  const path = ctx.url.pathname; // never the query: it can hold order keys and reset keys
  let res: Response;
  let door: MaintenanceDecision = 'pass';
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
      res = target ? ctx.redirect(target + ctx.url.search, 301) : path === '/500/' ? await ctx.rewrite('/404/') : await next();
    }
  } catch (err) {
    // Astro renders 500.astro from this; the log line is the trace.
    log.error('request failed', { method, path, status: 500, ms: Math.round(performance.now() - started), err });
    throw err;
  }
  // On any host but the site's own (new.musikogsport.is before the move) the pages are duplicates: keep them out of
  // search engines. On the real host nothing is added.
  const headers = isCanonicalHost(ctx.url.host, ctx.site) ? HEADERS : [...HEADERS, NOINDEX];
  const out = finishResponse(res, { path, method, cookiesPending: !ctx.cookies.headers().next().done, cdn: !MAINTENANCE.enabled, headers });
  const fields = { method, path, status: out.status, ms: Math.round(performance.now() - started) };
  // The shop closed on purpose is not an outage: keep it out of the warnings.
  if (door === 'closed') log.debug('closed for maintenance', fields);
  else if (out.status >= 500) log.warn(out.status === 503 ? 'upstream unavailable' : 'server error', fields);
  else log.debug('request', fields);
  return out;
});
