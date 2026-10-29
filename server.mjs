// Production entry (App Platform run_command: `node server.mjs`): the built Astro standalone server plus two things
// the @astrojs/node adapter doesn't do on its own.
//
// 1. Graceful shutdown. The adapter installs no SIGTERM handler, so Node would exit at once and cut off in-flight
//    requests (a checkout waits up to 25 s on the Store API). App Platform drains the instance at its load balancer
//    (termination.drain_seconds, default 15), then sends SIGTERM and kills after grace_period_seconds (default 120):
//    https://docs.digitalocean.com/products/app-platform/reference/app-spec/ . Here SIGTERM/SIGINT stop accepting
//    connections, let in-flight requests finish, and exit; a 30 s backstop (MOS_SHUTDOWN_TIMEOUT_MS) bounds it.
//    Nothing in-process needs flushing: every cache (catalog, photoBg, counts, rate-limit windows) is disposable.
// 2. Security headers on what never reaches Astro middleware: static files (/_astro/*, robots.txt, favicons) and the
//    prerendered pages, which the adapter's static handler serves itself. On-demand responses get the same headers
//    again from src/middleware.ts (plus Cache-Control); writeHead's values win over these, so nothing doubles.
//
// `node dist/server/entry.mjs` still works (local preview and the gates); it just lacks both.

process.env.ASTRO_NODE_AUTOSTART = 'disabled'; // before the import: the entry would start its own server otherwise

const { hstsEnabled, securityHeaders } = await import('./src/lib/securityHeaders.mjs');
const { startServer } = await import('./dist/server/entry.mjs');

/** @param {'info' | 'warn' | 'error'} level @param {string} msg @param {Record<string, unknown>} [fields] */
const log = (level, msg, fields = {}) => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }) + '\n');

// MOS_MEDIA_BASE_URL is inlined into the bundle at build; at run time it's only read here, for img-src.
const headers = securityHeaders({
  mediaBaseUrl: process.env.MOS_MEDIA_BASE_URL || 'https://musikogsport.is',
  hsts: hstsEnabled(process.env.MOS_HSTS),
});

// The build doesn't need the WooCommerce secrets, so a deploy without them builds fine and then fails every REST
// call; say so in the deploy log at boot. (lib/woo logs it again, once a minute, while they're missing.)
if (!process.env.WOOCOMMERCE_CONSUMER_KEY || !process.env.WOOCOMMERCE_CONSUMER_SECRET) {
  log('error', 'WOOCOMMERCE_CONSUMER_KEY / WOOCOMMERCE_CONSUMER_SECRET is not set: product pages, the wishlist and receipts will fail');
}

const { server } = startServer();
const http = server.server;
http.prependListener('request', (_req, res) => {
  for (const [name, value] of headers) res.setHeader(name, value);
});

const timeoutMs = Number(process.env.MOS_SHUTDOWN_TIMEOUT_MS) || 30_000;
let stopping = false;
/** @param {string} signal */
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('info', 'shutting down: finishing in-flight requests', { signal, timeoutMs });
  const backstop = setTimeout(() => {
    log('warn', 'shutdown timed out; exiting with requests still open', { timeoutMs });
    process.exit(1);
  }, timeoutMs);
  backstop.unref();
  // close(): no new connections, idle keep-alive sockets closed, open requests run to completion.
  http.close((err) => {
    if (err) log('error', 'server close failed', { err: String(err) });
    log('info', 'shut down cleanly');
    process.exit(err ? 1 : 0);
  });
  // Keep-alive sockets that go idle after the last response would otherwise hold close() until they time out.
  const sweep = setInterval(() => http.closeIdleConnections(), 250);
  sweep.unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
