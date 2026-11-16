// The last step of every on-demand response (src/middleware.ts): security headers (lib/securityHeaders.mjs) and the
// Cache-Control lib/cachePolicy picks. SERVER-ONLY by use.
import { cacheControlFor } from './cachePolicy';

export interface FinishInput {
  /** The request's pathname (no query). */
  path: string;
  method: string;
  /** Astro adds Set-Cookie after middleware, so the caller reports cookies set through ctx.cookies here. */
  cookiesPending: boolean;
  /** False while public pages must not be held at the CDN (lib/cachePolicy). */
  cdn: boolean;
  headers: [string, string][];
}

/** `res` with its headers settled. A Response with immutable headers (Response.redirect, one passed through from
 *  fetch) is copied first. */
export function finishResponse(res: Response, { path, method, cookiesPending, cdn, headers }: FinishInput): Response {
  const cache = cacheControlFor({
    path,
    method,
    status: res.status,
    current: res.headers.get('Cache-Control'),
    setsCookie: cookiesPending || res.headers.has('Set-Cookie'),
    isHtml: (res.headers.get('Content-Type') ?? '').includes('text/html'),
    cdn,
  });
  const apply = (r: Response) => {
    for (const [name, value] of headers) r.headers.set(name, value);
    if (cache) r.headers.set('Cache-Control', cache);
    return r;
  };
  try {
    return apply(res);
  } catch {
    return apply(new Response(res.body, res));
  }
}
