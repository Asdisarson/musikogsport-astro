// @ts-check
// security.allowedDomains for astro.config.mjs, read at BUILD time (the list is baked into the server
// manifest). Astro trusts X-Forwarded-Proto/Host only for these hosts, and ctx.url falls back to
// "localhost" for any other Host, so a form POST from an unlisted host fails the origin checks (403).
// MOS_EXTRA_ALLOWED_HOSTS adds exact hostnames, comma-separated — e.g. App Platform's default
// <app>.ondigitalocean.app domain before DNS moves. No wildcards: `*.ondigitalocean.app` would trust
// every other App Platform tenant's hostname as a forwarded host.

const BASE_HOSTS = ['musikogsport.is', 'www.musikogsport.is'];
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * @param {string | undefined} extra comma-separated exact hostnames (MOS_EXTRA_ALLOWED_HOSTS)
 * @returns {{ protocol: string; hostname: string }[]}
 */
export function allowedDomains(extra) {
  const hosts = [...BASE_HOSTS];
  for (const raw of (extra ?? '').split(',')) {
    const host = raw.trim().toLowerCase();
    if (!host) continue;
    if (!HOSTNAME.test(host)) {
      console.warn(`[astro.config] MOS_EXTRA_ALLOWED_HOSTS: ignoring "${host}" (exact hostname only, no scheme, port, path or wildcard)`);
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts.map((hostname) => ({ protocol: 'https', hostname }));
}

/** A variable from the build's environment. Typed via globalThis because the project carries no @types/node. */
export function buildEnv(/** @type {string} */ name) {
  const proc = /** @type {{ process?: { env?: Record<string, string | undefined> } }} */ (/** @type {unknown} */ (globalThis)).process;
  return proc?.env?.[name];
}
