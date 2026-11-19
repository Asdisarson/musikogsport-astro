#!/usr/bin/env node
// Renders the storefront's product and category pages once, one at a time, so the shell store (src/lib/shellStore)
// holds them before shoppers arrive. Run after a release (`npm run shells`), against the running app.
//
// Why so slow: a burst on cold caches stalled production WordPress for minutes once (see the team notes). So:
//   - one request at a time, with a pause between them (--delay, default 500 ms);
//   - a page the store already holds answers at once from the store (X-Mos-Shell: hit) and is not waited for;
//   - any 5xx, timeout or answer slower than --slow (default 3000 ms) doubles the pause (up to 30 s) and is
//     counted; a good answer halves it back toward --delay. The self-check's repeats use the same pause and backoff;
//   - after --max-failures in a row (default 5) it stops and exits with status 2. Run it again later: it picks up
//     where it is, since rendered pages are kept.
//
// X-Mos-Shell values: miss (rendered and kept), hit (kept, served from the store), stale (kept, served while it
// refreshes), refused (rendered but the store would not keep it: a cookie, no-store or an incomplete render). The
// final tally counts only "miss" as kept; it warns when any page was refused.
//
// Usage (each option as --name=value or --name value):
//   npm run shells                                  # http://127.0.0.1:10026 (astro dev), all product and category URLs
//   npm run shells -- --limit=30                    # the first 30 URLs only
//   npm run shells -- --base=http://127.0.0.1:10026 --delay=800
//
// On the server (see DEPLOY.md, "Filling the shell store"), pass the host the storefront is served on, so the app
// keeps the pages (it keeps pages only for a host it trusts; a bare 127.0.0.1 is not one):
//   npm run shells -- --base https://new.musikogsport.is --allow-remote --delay=1000
//   npm run shells -- --base=http://127.0.0.1:<app port> --host=new.musikogsport.is --delay=1000
//   (--host sends X-Forwarded-Host and X-Forwarded-Proto: https; the app trusts them only for its allowed hosts)
//
// It only talks to --base. The base must be a local host (127.0.0.1, localhost, ::1, or *.localhost / *.test) unless
// --allow-remote is given; the sitemap's own host is ignored and each URL's path is requested on --base.
//
// Self-check: the first URL must answer 200 with X-Mos-Shell (miss, hit or stale), and a repeat of it must be a hit.
// If not, the store is not taking pages (wrong host, or MOS_SHELL=off): the script stops with status 3 and says so,
// instead of reporting "other N" for every URL and exiting cleanly.

import { pathToFileURL } from 'node:url';

const USAGE = 'usage: npm run shells -- [--base <url>] [--allow-remote] [--host <name>] [--limit <n>] [--delay <ms>] [--slow <ms>] [--timeout <ms>] [--max-failures <n>]';
const MAX_PAUSE_MS = 30000;
const PREFIXES = ['/verslun/', '/vara/', '/voruflokkur/', '/brand/', '/merkimidar/'];
const KEPT_STATES = ['miss', 'hit', 'stale'];

export class UsageError extends Error {}

/** `--name=value`, `--name value`, or a bare `--name` (its value is 'true'). Anything else is a usage error. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new UsageError(`unexpected argument "${argv[i]}"`);
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[m[1]] = argv[++i];
    else out[m[1]] = 'true';
  }
  return out;
}

/** The options, checked. Throws UsageError with a message the operator can act on. */
export function readOptions(argv, env = {}) {
  const args = parseArgs(argv);
  if (args.base === 'true') throw new UsageError('--base needs a value: --base https://host or --base=https://host');
  let base;
  try {
    base = new URL(args.base ?? env.MOS_SHELL_BASE ?? 'http://127.0.0.1:10026');
  } catch {
    throw new UsageError(`--base is not a URL: ${args.base}`);
  }
  const num = (name, fallback) => {
    if (args[name] === undefined) return fallback;
    const n = Number(args[name]);
    if (args[name] === 'true' || !Number.isFinite(n) || n < 0) throw new UsageError(`--${name} needs a number, not "${args[name]}"`);
    return n;
  };
  if (args.host === 'true') throw new UsageError('--host needs a name: --host new.example.is');
  return {
    base,
    allowRemote: args['allow-remote'] === 'true',
    forwardedHost: typeof args.host === 'string' ? args.host : null,
    delayMs: num('delay', 500),
    slowMs: num('slow', 3000),
    timeoutMs: num('timeout', 20000),
    maxFailures: num('max-failures', 5),
    limit: args.limit === undefined ? Infinity : num('limit', Infinity),
  };
}

export function isLocal(host) {
  return /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(host) || /\.(localhost|test)$/.test(host);
}

/** A render that is bad for the pause: a timeout or 5xx, or slower than --slow. */
export function isBad(r, slowMs) {
  return r.status === 0 || r.status >= 500 || r.ms > slowMs;
}

/** The tally bucket of a render: a 2xx answer is one of the store states; anything else is not counted. */
export function tally(r, slowMs) {
  if (isBad(r, slowMs)) return 'bad';
  if (r.status < 200 || r.status >= 300) return null;
  if (r.shell === 'hit' || r.shell === 'stale') return r.shell;
  if (r.shell === 'miss') return 'miss';
  if (r.shell === 'refused') return 'refused';
  return 'other';
}

/** The pause after a render: doubled (up to MAX_PAUSE_MS) when it was bad, otherwise halved back toward the delay. */
export function nextPause(pause, bad, delayMs) {
  return bad ? Math.min(MAX_PAUSE_MS, pause * 2) : Math.max(delayMs, Math.round(pause / 2));
}

/** Why the self-check's first answer does not show a working store, or null when it does. */
export function storeProblem(r) {
  if (r.status !== 200) return `answered ${r.status}`;
  if (!KEPT_STATES.includes(r.shell)) return `answered with X-Mos-Shell "${r.shell}"`;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
let cfg = null;

async function sitemapPaths() {
  const res = await fetch(new URL('/sitemap.xml', cfg.base), { signal: AbortSignal.timeout(cfg.timeoutMs) });
  if (!res.ok) throw new Error(`sitemap answered ${res.status}`);
  const xml = await res.text();
  const seen = new Set();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    let path;
    try {
      path = new URL(m[1].trim()).pathname;
    } catch {
      continue;
    }
    if (PREFIXES.some((p) => path.startsWith(p)) && !/\/page\/\d+\/?$/.test(path) && path.endsWith('/')) seen.add(path);
  }
  return [...seen];
}

async function render(path) {
  const started = performance.now();
  try {
    const headers = cfg.forwardedHost ? { 'X-Forwarded-Host': cfg.forwardedHost, 'X-Forwarded-Proto': 'https' } : {};
    const res = await fetch(new URL(path, cfg.base), { redirect: 'manual', headers, signal: AbortSignal.timeout(cfg.timeoutMs) });
    await res.arrayBuffer(); // the whole page: the store keeps it only once the body has been read
    return { status: res.status, shell: res.headers.get('x-mos-shell') ?? '-', ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { status: 0, shell: '-', ms: Math.round(performance.now() - started), error: err.name === 'TimeoutError' ? 'timeout' : String(err.message ?? err) };
  }
}

/** The store must take pages before the long run starts: the first URL answers 200 with a store state, and its repeat
 *  is a hit (the store writes after the body is read, so the repeat waits a moment). The repeats use the same pause and
 *  backoff as the main loop. Exits 3 when it does not. */
async function checkStore(first) {
  const one = await render(first);
  const problem = storeProblem(one);
  if (problem) {
    console.error(`the store is not taking pages: ${first} ${problem}.`);
    console.error('  Check --base and --host (the app keeps pages only for a host it trusts; see DEPLOY.md), and that MOS_SHELL is not off.');
    process.exit(3);
  }
  let pause = cfg.delayMs;
  for (let tries = 0; tries < 4; tries++) {
    await sleep(pause);
    const again = await render(first);
    if (again.status === 200 && again.shell === 'hit') return;
    pause = nextPause(pause, isBad(again, cfg.slowMs), cfg.delayMs);
  }
  console.error(`the store did not keep ${first}: its repeat was not a hit. Is MOS_SHELL_DIR writable and MOS_SHELL not off?`);
  process.exit(3);
}

async function main() {
  cfg = readOptions(process.argv.slice(2), process.env);
  if (!isLocal(cfg.base.hostname) && !cfg.allowRemote) {
    console.error(`refusing to run against ${cfg.base.hostname}: pass --allow-remote to do that on purpose`);
    process.exit(1);
  }
  const all = await sitemapPaths();
  const paths = all.slice(0, cfg.limit);
  log(`${all.length} product and category URLs in the sitemap; ${paths.length} to visit on ${cfg.base.origin}`);
  if (paths.length > 0) await checkStore(paths[0]);
  log('the store takes pages: the first URL is kept and its repeat is a hit');
  let pause = cfg.delayMs;
  let failures = 0;
  const totals = { miss: 0, hit: 0, stale: 0, refused: 0, other: 0, bad: 0 };
  const started = performance.now();
  for (const [i, path] of paths.entries()) {
    const r = await render(path);
    const kind = tally(r, cfg.slowMs);
    if (kind) totals[kind] += 1;
    const bad = kind === 'bad';
    log(`${String(i + 1).padStart(4)}/${paths.length} ${r.status || 'ERR'} ${r.shell.padEnd(7)} ${String(r.ms).padStart(6)} ms ${path}${r.error ? ` (${r.error})` : ''}${r.ms > cfg.slowMs ? ' slow' : ''}`);
    pause = nextPause(pause, bad, cfg.delayMs);
    if (bad) failures += 1;
    else failures = 0;
    if (bad && failures >= cfg.maxFailures) {
      log(`stopping: ${failures} failures in a row; the pause is ${pause} ms. Run again later; kept pages stay.`);
      process.exitCode = 2;
      break;
    }
    // Stored pages come back at once: no pause needed after one of those.
    if (r.shell !== 'hit' && i < paths.length - 1) await sleep(pause);
  }
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  log(`done in ${secs} s: rendered and kept ${totals.miss}, already stored ${totals.hit}, stale ${totals.stale}, rendered but not kept ${totals.refused}, other ${totals.other}, problems ${totals.bad}`);
  if (totals.refused > 0) {
    log(`warning: ${totals.refused} page(s) were rendered but not kept (X-Mos-Shell: refused: a cookie, no-store or an incomplete render). They are rendered again on every visit.`);
  }
}

// Run only as the command (`node scripts/prebuild_shells.mjs`), not when a test imports the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n${USAGE}`);
      process.exit(1);
    }
    console.error(err.message ?? err);
    process.exit(1);
  });
}
