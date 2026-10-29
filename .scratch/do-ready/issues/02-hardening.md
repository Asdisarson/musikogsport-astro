# 02 Production hardening

Type: task
Status: implemented (2026-10-26), uncommitted on `feat/do-ready`; four owner decisions open (below)
Blocked by: 01 (done)

See map.md. This ticket covers scope only. Each item is decided (grilled) before any code is written, and the
money path (cart, checkout, Straumur) changes only on the user's explicit word.

## Scope

1. **Security headers.** There are none today: no CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
   `Permissions-Policy` or frame-ancestors anywhere in `src/`.
   - Decide where they are set: Astro middleware, or App Platform. Ingress rules can't add headers, so middleware
     is the likely place.
   - Write a CSP compatible with React islands, inline JSON-LD, the Straumur redirect and WordPress media hosts.
   - HSTS on the apex only after DNS is stable.
2. **Caching.**
   - Review `Cache-Control` on HTML, `/api/*`, the sitemap and `/_astro/*`, which is immutable and hashed.
   - App Platform puts a CDN in front of services. Confirm what it caches and that no personalised response (cart,
     account, `Cart-Token`, Set-Cookie) is ever cacheable.
   - Check `Vary`.
3. **Error pages and logging.**
   - `404.astro` and `500.astro` behaviour for SSR errors. Today WordPress outages give 503 plus `Retry-After`
     (`markUnavailable`).
   - Structured logs (JSON, one line per request or error) for App Platform runtime logs, and log levels.
   - No PII or secrets in logs. In particular, the Woo REST key is a query param in `lib/woo.ts`, so make sure no
     URL logging leaks it.
   - Unhandled-rejection handling.
4. **Rate limits on `/api/*` and renders.**
   - Today only sign-in, lost/reset password and contact are limited per visitor.
   - Add limits for cart mutations, `api/products`, `api/posturinn/droppoints`, `api/order` (id+key guessing) and
     `api/checkout`. The checkout one is money path, so it needs the user's sign-off (given 2026-10-26: 10 a minute per visitor, implemented).
   - **Store API collection-data fan-out (from better-filters):** a cold filtered listing render makes up to 9
     Store API calls (2 PHP workers locally, ~+120 ms per count miss). Every filter combination is a new URL with
     a 60 s per-URL counts cache, so a crawler or attacker walking combinations amplifies load on WordPress.
     Options:
     - a per-visitor render limit on filtered URLs;
     - a cap on cold count fetches per minute, serving the page without counts when exceeded;
     - the PHP `mos_price_counts` single-call idea (04-ship "Open").
   - robots.txt already disallows the filter params except `kyn` and `product-category`.
5. **Straumur configuration check (read-only; its key is LIVE, never call it).**
   - Confirm that no Straumur key or endpoint lives in the storefront. Today it only allows `straumur.is` redirect
     hosts in `lib/checkoutRedirect.ts`.
   - Check that the WordPress plugin is pointed at the production gateway and that return URLs land on
     `musikogsport.is/gera-upp/...` after cutover (`MOS_STOREFRONT_URL`, `WP_HOME`).
   - Review env and config names only.
6. **Media host after cutover.**
   - `MEDIA_BASE_URL` in `src/lib/img.ts` is hardcoded to `https://musikogsport.is`, and `photoBg` only samples URLs
     on that host.
   - Once the apex points at the storefront, WordPress media lives on the WordPress host. Make the media host
     env-driven (e.g. reuse the currently unread `WP_PUBLIC_URL`) so photo-edge sampling keeps working.
   - Check that no rendered HTML hardcodes `musikogsport.is/wp-content/`.
7. **Secrets at build time.** Read `WOOCOMMERCE_CONSUMER_KEY`/`SECRET` lazily (`getSecret()` inside `lib/woo.ts`)
   so the build no longer needs them, then switch their scope to `RUN_TIME` in `.do/app.yaml`.
8. **mu-plugin deploy checklist.**
   - A per-plugin upload list from `wp-mu-plugins/README.md`, never `headless-bridge-local.php`.
   - Order of operations and the `wp mos-size reindex` backfill.
   - `wp-config.php` constants (`MOS_STOREFRONT_URL`, `MOS_HEADLESS_REDIRECT_STATUS`).
   - WooCommerce settings: guest checkout on, `woocommerce_price_num_decimals`=0, a Read/Write REST key (the account area PUTs orders and customers).
   - WP-Cron, IP or WAF limits on public write routes (App Platform egress is not fixed by default), and a
     verification step for each item.
9. **Node runtime.** Node 22 reaches end of life in April 2027. Plan the move to 24 LTS: engines, `.nvmrc`, gates.
10. **Unused env.** `PUBLIC_WOOCOMMERCE_STORE_URL` and `WP_PUBLIC_URL` are required by the schema but read nowhere.
    Use them or drop them; item 6 may use `WP_PUBLIC_URL`.
11. **Graceful shutdown.** App Platform sends SIGTERM on redeploy. Check that in-flight requests finish (standalone
    `server-destroy`) and that nothing in-process needs flushing.

## Done when

Each item is decided, then implemented or explicitly waived by the user. The gates match ticket 01 plus header and
caching probes.

## Outcome (2026-10-26)

Decisions came from the user's brief for this ticket (headers in middleware, CSP report-only, HSTS behind a flag,
no-cache public HTML unless s-maxage is provably safe, no limits on the payment flow). Details and rationale live
in `DEPLOY.md` "Production hardening"; this is the per-item record.

| # | Item | State |
|---|---|---|
| 1 | Security headers | **Implemented.** `src/lib/securityHeaders.mjs` (one source), applied by `src/middleware.ts` (on-demand) and `server.mjs` (static files, prerendered pages). nosniff, strict-origin-when-cross-origin, `X-Frame-Options: DENY`, Permissions-Policy (camera/mic/geolocation/payment/usb/topics off; the card payment is a navigation to Straumur, no Payment Request API), CSP as **Report-Only** (`script-src 'self' 'report-sample'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https: <media>`, `frame-src` Google Maps, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`, `base-uri 'self'`). HSTS only with `MOS_HSTS=1` (`max-age=31536000; includeSubDomains`, no preload). Astro's `security.csp` not used: it always enforces. **Open:** CSP enforcement (owner, after report review; steps in DEPLOY.md), HSTS on after cutover, a report endpoint if reports should be collected. |
| 2 | Caching | **Implemented.** `src/lib/cachePolicy.ts`: personal paths and any response setting a cookie `private, no-store`; errors `no-store`; public HTML `no-cache` (not s-maxage: DO's CDN holds a cached response until the next deploy and Cloudflare ignores `Vary: Cookie`; cited in DEPLOY.md); routes' own public policies kept (sitemap, droppoints). `/_astro/*` immutable 1y from the adapter. No `Vary` reliance. Probe: `/private/tmp/claude-501/do-ready/headers.txt`. |
| 3 | Errors and logging | **Implemented.** `src/lib/logger.ts`: JSON lines `{time, level, msg, method, path, status, ms}`, pathname only, `MOS_LOG_LEVEL`; `redactSecrets` blanks consumer_key/consumer_secret/key/password/token…; `lib/woo` logs through it and scrubs rethrown errors (tests prove no key in logs or errors). Middleware logs thrown requests (then Astro renders 500.astro) and every 5xx; 503 + Retry-After `markUnavailable` path unchanged (probed with WordPress down). Unhandled rejections logged, process keeps serving (replaces the adapter's listener, which logged raw request URLs). |
| 4 | Rate limits | **Implemented:** cart add/update/remove 120/min shared, `/api/products` 60/min, droppoints 60/min, `/api/order` 20 misses/15 min (found orders refund); 429 + Retry-After + no-store + Icelandic message. Fan-out: cold collection-data requests capped at 240/min per process; past it listings render without counts (or stale ones), never 503. **`/api/checkout`: approved by the user 2026-10-26, implemented** (10 / min per visitor, checked before any WooCommerce call; the checkout form shows the 429's Icelandic message). **Open (owner sign-off, payment flow):** `/api/cart/customer`, `/api/cart/select-shipping`, `/api/cart/coupon`, `/api/cart/remove-coupon` — suggested: coupon failures 30/15 min (refund on success). Also the thank-you page itself, `/gera-upp/order-received/<id>/?key=…`, which calls `getOrder` with the URL's key and is NOT behind the `/api/order` limiter (post-payment return page, so payment flow): suggested the same misses-only limiter, shared with `/api/order`. Order keys carry ~77 bits, so this is defence in depth. Not done: the PHP `mos_price_counts` single-call idea. |
| 5 | Straumur config check | **Done (read-only).** No Straumur key or endpoint in the storefront (only the `*.straumur.is` redirect allow-list). WordPress-side names and the cutover risk (the plugin's `webhook_url` defaults to `home_url('/wp-json/straumur/v1/payment-callback')`; a callback left on `musikogsport.is` would hit the storefront and be lost) are in DEPLOY.md "Straumur at cutover". Straumur was never called. |
| 6 | Media host | **Implemented.** `MOS_MEDIA_BASE_URL` (astro:env **client**/public, because `CartParts.tsx` uses `mediaUrl` in the browser; default `https://musikogsport.is`, build time) drives `MEDIA_BASE_URL`, the local-media rewrite and photoBg's trusted host. Proved with a clean build at `https://media.example.test`: 0 apex `/wp-content/` URLs rendered. No other hardcoded `musikogsport.is/wp-content/` in code (tests and seed data only). |
| 7 | Lazy secrets | **Implemented.** `lib/woo` reads the key pair with `getSecret` per request (a missing pair is logged as an error, once a minute, and at boot by `server.mjs`, so it can't pass for a WordPress outage); schema marks them `optional` (astro:env validates every required secret on import, prerendering included); `.do/app.yaml` scope `RUN_TIME`. Clean copy `npm ci && npm run build` with no Woo secrets: passes. |
| 8 | mu-plugin deploy checklist | **Done (docs).** DEPLOY.md "mu-plugin deploy checklist": 9 ordered steps, each with a check. |
| 9 | Node 24 | **Planned only** (DEPLOY.md "Node 24"). Not bumped. **Open:** owner schedules it before April 2027. |
| 10 | Unused env | **Done.** `PUBLIC_WOOCOMMERCE_STORE_URL` and `WP_PUBLIC_URL` dropped from the schema, `.do/app.yaml` and DEPLOY.md (read nowhere: src, scripts, tests, mu-plugins). Item 6 got its own variable instead. A local `.env` may still list them; harmless. |
| 11 | Graceful shutdown | **Implemented.** The adapter has no SIGTERM handler (bare entry drops in-flight requests: probe got status 000). `server.mjs` (new run_command) closes the server, lets requests finish (probe: 200 and full body after SIGTERM), exits; 30 s backstop under DO's 120 s grace. Nothing in-process needs flushing (all caches disposable). |

Gates: vitest all pass, `astro check` 0 errors, `npm run build`, clean-copy build without secrets,
`verify_live_routes.py` 32/0, `crawl_links.py` OK, filter probes (bf03-probe, bf03-extra, bf03-sort, bf04-probe)
all pass, header probe `/private/tmp/claude-501/do-ready/headers.txt`, CSP report list
`/private/tmp/claude-501/do-ready/csp-violations.txt`.

Owner decisions open: (a) rate limits on the payment-flow routes, (b) CSP enforcement, (c) HSTS on after cutover,
(d) Node 24 timing.
