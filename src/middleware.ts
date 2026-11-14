import { defineMiddleware } from 'astro:middleware';
import { slashRedirect } from './lib/paths';
import { finishResponse } from './lib/responseHeaders';
import { isCanonicalHost } from './lib/seo';
import { hstsEnabled, securityHeaders } from './lib/securityHeaders.mjs';
import { MEDIA_BASE_URL } from './lib/img';
import { installProcessHandlers, log, runtimeEnv } from './lib/logger';

// Run-time switch (DEPLOY.md "Security headers"): HSTS only once DNS and TLS on the apex are settled.
const HSTS = hstsEnabled(runtimeEnv('MOS_HSTS'));
const HEADERS = securityHeaders({ mediaBaseUrl: MEDIA_BASE_URL, hsts: HSTS });
const NOINDEX: [string, string] = ['X-Robots-Tag', 'noindex, nofollow'];

export const onRequest = defineMiddleware(async (ctx, next) => {
  // Prerendered pages run through here at build time only; their headers come from server.mjs.
  if (ctx.isPrerendered) return next();
  if (import.meta.env.PROD) installProcessHandlers(); // not under `astro dev`: Vite has its own

  const started = performance.now();
  const method = ctx.request.method;
  const path = ctx.url.pathname; // never the query: it can hold order keys and reset keys
  let res: Response;
  try {
    // Live (WordPress) serves every page with a trailing slash and 301s the slash-less form. Mirror that for page
    // GETs only — API routes, assets and non-GET methods pass through untouched.
    const target = method === 'GET' || method === 'HEAD' ? slashRedirect(path) : null;
    // A direct request for /500/ is a missing page: Astro forces status 500 on that route (it renders it for real
    // errors, with the original path), and a public URL answering 500 would only inflate the error metrics.
    res = target ? ctx.redirect(target + ctx.url.search, 301) : path === '/500/' ? await ctx.rewrite('/404/') : await next();
  } catch (err) {
    // Astro renders 500.astro from this; the log line is the trace.
    log.error('request failed', { method, path, status: 500, ms: Math.round(performance.now() - started), err });
    throw err;
  }
  // On any host but the site's own (new.musikogsport.is before the move) the pages are duplicates: keep them out of
  // search engines. On the real host nothing is added.
  const headers = isCanonicalHost(ctx.url.host, ctx.site) ? HEADERS : [...HEADERS, NOINDEX];
  const out = finishResponse(res, { path, method, cookiesPending: !ctx.cookies.headers().next().done, headers });
  const fields = { method, path, status: out.status, ms: Math.round(performance.now() - started) };
  if (out.status >= 500) log.warn(out.status === 503 ? 'upstream unavailable' : 'server error', fields);
  else log.debug('request', fields);
  return out;
});
