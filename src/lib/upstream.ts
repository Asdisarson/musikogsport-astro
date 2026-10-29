// Server-side GETs to WordPress's JSON APIs (Store API, mos/v1) — SERVER-ONLY. One place for the request shape every
// catalog/content reader used to write out itself: JSON accepted, and a hard timeout so a hung backend can't pin an SSR
// worker. Callers keep their own timeout, status handling and logging. (lib/woo's REST client and photoBgServer's
// image fetch differ — key pair and scrubbing; a byte stream that refuses redirects — and keep their own fetch.)

/** GET `url` as JSON with a `timeoutMs` deadline. Rejects on a transport failure or the timeout (TimeoutError). */
export function upstreamGet(url: string, timeoutMs: number): Promise<Response> {
  return fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
}

/** upstreamGet, then the parsed body; a non-2xx answer throws `${label} -> ${status}`. */
export async function upstreamJson<T>(url: string, timeoutMs: number, label: string): Promise<T> {
  const res = await upstreamGet(url, timeoutMs);
  if (!res.ok) throw new Error(`${label} -> ${res.status}`);
  return (await res.json()) as T;
}
