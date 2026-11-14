# Deploying the storefront

The storefront is an Astro SSR app (`@astrojs/node`, standalone). It sits behind a reverse proxy that ends
TLS, and talks to WordPress + WooCommerce over `WP_INTERNAL_URL`. The WordPress side is set up as
described in `wp-mu-plugins/README.md`.

Two ways to run it: on DigitalOcean App Platform (see [App Platform](#app-platform), spec in `.do/app.yaml`),
or on your own server behind nginx (the sections right below). The WordPress host notes apply to both.

## Reverse proxy (required)

Node only sees plain http, so the proxy has to tell it what the visitor saw:

| Header | Value | Why |
|---|---|---|
| `X-Forwarded-Proto` | `https` | Astro's form-POST origin check and `lib/http` `sameOrigin` compare the browser's `Origin` (`https://…`) with `ctx.url`. Without this header every sign-in, address and contact form POST gets a 403. |
| `Host` (kept) or `X-Forwarded-Host` | `musikogsport.is` / `www.musikogsport.is` | Same check. Only the hosts in `security.allowedDomains` (`astro.config.mjs`) are trusted; add any staging host there. |
| `X-Forwarded-For` | appended (`$proxy_add_x_forwarded_for`) or overwritten (`$remote_addr`), never passed through untouched | The per-visitor rate limits (sign-in, password reset, contact) key on its last entry; a proxy that forwards the client's own header lets a client pick its key. |

Serve one canonical host (redirect `www.musikogsport.is` to `musikogsport.is`, or the reverse): the
checkout cookie that the thank-you page needs after a card payment is host-only.

nginx example:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
```

## Environment

| Variable | When it's read | Notes |
|---|---|---|
| `WP_INTERNAL_URL` | build time | Baked into the bundle: set it before `npm run build`. No page is prerendered, so the build itself does not need WordPress to answer. |
| `MOS_MEDIA_BASE_URL` | build time (+ runtime for `server.mjs`) | Optional, default `https://musikogsport.is`. The host serving WordPress media: local media URLs are rewritten onto it and `photoBg` samples product photos from it only. Once the apex points at the storefront, set WordPress's public origin (e.g. `https://wp.musikogsport.is`). Inlined into the client bundle too (the cart uses it). |
| `MOS_TRUSTED_PROXY_HOPS` | build time | How many proxies in front of Node append to `X-Forwarded-For`. Default `1`, the TLS proxy above; add one per extra layer (e.g. a CDN in front of nginx). Never expose Node directly with `1`: a client could then pick its own rate-limit key. `0` is only for Node facing visitors directly: the socket address is the key, and any request carrying `X-Forwarded-For` goes into one shared bucket. Behind a proxy, `0` makes every visitor share one limit. |
| `MOS_CLIENT_IP_HEADER` | build time | Optional. A header the hosting edge sets to the visitor's IP; when present it is the rate-limit key and `MOS_TRUSTED_PROXY_HOPS` is only the fallback. Leave unset behind nginx; App Platform: `do-connecting-ip`. |
| `MOS_EXTRA_ALLOWED_HOSTS` | build time | Optional, comma-separated exact hostnames added to `security.allowedDomains` (`src/lib/allowedHosts.mjs`), e.g. a staging host. No wildcards. |
| `ASTRO_KEY` | build time | Set it in production (a secret): the key Astro encrypts server-island props with (the product page's related products, `server:defer`). Unset, every build makes a new one, so a product page opened before a deploy loses its related row (the island request fails after it). Make one with `npx astro create-key` and keep it across builds. |
| `HOST`, `PORT` | runtime | Own server: leave `HOST` unset (the build's default bind is `127.0.0.1`): Node must only be reachable through the proxy; with `MOS_TRUSTED_PROXY_HOPS=1` a directly reachable Node lets a client choose its own rate-limit key. `PORT` defaults to 4321. App Platform: `HOST=0.0.0.0`, `PORT=8080` (the container is reachable only through DO's ingress). |
| `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` | runtime only | Secrets: pass them to the Node process (`node --env-file=.env server.mjs`). `lib/woo` reads them when it makes a request, so `npm run build` needs neither (checked with a clean `npm ci && npm run build` without them). Without them every WooCommerce REST call fails (product pages, wishlist, receipts). |
| `MOS_HSTS` | runtime | `1` sends `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no preload). Off by default: turn it on only once DNS and TLS on the apex are settled. |
| `MOS_LOG_LEVEL` | runtime | `debug` / `info` (default) / `warn` / `error` for the JSON logs; `debug` adds one line per request. |
| `MOS_SHUTDOWN_TIMEOUT_MS` | runtime | Optional, default `30000`: how long `server.mjs` waits for in-flight requests after SIGTERM before exiting. |

Run the built app with `node server.mjs` (graceful shutdown and headers on static files, see
[Production hardening](#production-hardening)); `node dist/server/entry.mjs` still works for a quick local preview.

## WooCommerce settings

- **Guest checkout must stay on** (WooCommerce → Settings → Accounts & Privacy → "Allow customers to place
  orders without an account"). The storefront always checks out as a guest, because Straumur signs its
  return URL for the user WordPress sees and the shopper comes back without the storefront's token. A
  signed-in customer's order is put on their account right after (`/api/checkout`).

## WordPress host

- The jwt-auth plugin's `POST /wp-json/jwt-auth/v1/token` is public. The storefront limits sign-in
  attempts per visitor, but a direct caller bypasses that, so restrict the route at the WordPress host:
  allow only the storefront server's IP, or rate-limit it in the WAF. There is deliberately no limit in
  WordPress code: every real shopper reaches WordPress from the storefront's address, so a per-IP cap there
  would be one shared bucket, i.e. a switch anyone could flip to lock every shopper out of signing in.
- The other public WordPress write routes are `mos/v1/contact` (contact form) and
  `mos/v1/account/lost-password` / `reset-password`. WordPress limits them itself only loosely (contact: at
  most 5 per IP and sender per 15 minutes, 30 per IP per clock hour and 60 per clock hour store-wide;
  password routes: at most 60 per IP per 15 minutes; each accepted request restarts a per-IP window), so a
  direct caller skips the storefront's per-visitor limits. The storefront's visitors all share its address's
  buckets, and a caller rotating addresses can still use up the store-wide contact cap. Give these routes the
  same IP restriction.
- User enumeration: `mos-headless-api.php` hides `/wp-json/wp/v2/users` (and `/users/<id>`) from anyone who
  can't edit posts, turns `?author=<id>` and `/author/<slug>/` into 404s for them, and strips authors from
  oEmbed and feeds (user slugs are login names). `/wp/v2/users/me`, which the storefront's sign-in uses, is
  unchanged. Don't re-open the list with another plugin.
- `WP_ENVIRONMENT_TYPE` must not be `local` on the WordPress host (the default is `production`): the local
  shim `headless-bridge-local.php` acts only on `local`, as a second guard after "never deploy it".
- Signed-out tokens are kept on a denylist as WordPress transients until they expire (7 days), so WP-Cron
  (or a system cron calling `wp cron event run --due-now`) must run to clear expired transients. With a
  persistent object cache (Redis, Memcached) the denylist lives there: a cache that evicts keys or loses them
  on a restart makes a signed-out token valid again until it expires. Use one with persistence and no eviction
  of these keys, or no object cache.
- After updating the jwt-authentication-for-wp-rest-api plugin, check that its JWT classes are still where
  `mos-account-api.php` reads them: `wp eval 'echo class_exists("\\Tmeister\\Firebase\\JWT\\JWT") ? "ok" : "MISSING";'`
  prints `ok`. If they move, every signed-in shopper is signed out on their next request (fails closed) until
  the mu-plugin is updated.
- WooCommerce's order-pay page (`/gera-upp/order-pay/<id>/`, the "pay for this order" link in invoice
  emails) stays on WordPress (headless mode exempts it), so the WordPress host needs a front-end theme
  that renders WooCommerce pages, and `WP_HOME` must be the WordPress host, not the storefront. A declined
  card there lands on the storefront checkout's failure notice (the bridge never forwards the order key),
  so the customer pays by opening the emailed link again.
- Deploy the mu-plugins listed in `wp-mu-plugins/README.md`, never the `-local` shim.
- In `wp-config.php` define `MOS_STOREFRONT_URL` as the storefront's origin (e.g. `https://musikogsport.is`)
  and `MOS_HEADLESS_REDIRECT_STATUS` as `301`. Headless mode (`mos-headless-mode.php`) sends WordPress
  front-end URLs to the storefront only when `MOS_STOREFRONT_URL` is set, and that includes the card-payment
  returns: WooCommerce builds them on `WP_HOME` (`/gera-upp/order-received/<id>/`, and
  `/gera-upp/?straumurStatus=failed` from the bridge).

## App Platform

Only the storefront runs on DigitalOcean App Platform; WordPress/WooCommerce stays on its current host and the
storefront reaches it over HTTPS at `WP_INTERNAL_URL`. The app spec is `.do/app.yaml`: one `service` built by
the Node.js buildpack (`npm ci`, `npm run build` = `astro check && astro build`, devDependencies pruned), run with
`node server.mjs` on port 8080, region `ams`, one `apps-s-1vcpu-1gb-fixed` instance (1 GiB, about
$10/month; App Platform has no free tier for services), health check `GET /api/healthz` (200 `ok`, no upstream
calls), `deploy_on_push: true` (every push to `main` builds and deploys; a failed build or health check leaves the
previous version serving).

Why these choices:

- **Buildpack, not a Dockerfile.** The buildpack picks Node from `engines` (`22.x`, also in `.nvmrc`), runs
  `npm ci`, and sharp's linux-x64 binaries (`@img/sharp-linux-x64`, `@img/sharp-libvips-linux-x64`) come from
  the lockfile's optional dependencies. Bindable variables such as `${APP_DOMAIN}` reach the build only with a
  buildpack (with a Dockerfile they are runtime only), and `allowedDomains` is fixed at build time.
- **No reverse proxy of your own.** DO's ingress ends TLS and sends `X-Forwarded-Proto`/`Host`; the
  `security.allowedDomains` rules above still apply.
- **Visitor IP.** On App Platform `X-Forwarded-For` carries the address of DO's ingress server, and the
  visitor's address is in `do-connecting-ip`
  ([DO docs](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/)).
  So the spec sets `MOS_CLIENT_IP_HEADER=do-connecting-ip`; counting `X-Forwarded-For` hops there would put every
  visitor in one rate-limit bucket. `MOS_TRUSTED_PROXY_HOPS=1` stays as the fallback.
- **Region `ams`.** EU/EEA data residency (Iceland is in the EEA) and close to Iceland (`lon` is about as close).
  Latency to the WordPress host matters more — each SSR page makes several calls to it — so if WordPress is not
  hosted in northern Europe, pick the region nearest to it.
- **One instance.** Rate limits, the photo-edge cache (`photoBgServer`, which fetches and decodes product photos
  with sharp) and the catalog/count caches live in each Node process. Two instances means two sets of caches,
  twice the photo fetches and WordPress calls while they warm, and per-visitor limits that are each twice as loose.
  Scale vertically first.

### Environment (App Platform)

Every non-secret `astro:env` variable is inlined into the bundle at build time, so it is `BUILD_TIME` and changing
one needs a rebuild ("Force rebuild and deploy"). The two WooCommerce secrets are `RUN_TIME` only: `lib/woo` reads
them per request, so the build never sees them. `MOS_HSTS` and `MOS_LOG_LEVEL` are read at run time (a redeploy, no
rebuild).

| Name | Scope | Secret | Value |
|---|---|---|---|
| `NODE_ENV` | RUN_TIME | no | `production`. Never at build time: npm would skip devDependencies and `astro check` would fail. |
| `HOST` | RUN_TIME | no | `0.0.0.0` (the build's default bind is `127.0.0.1`, which the ingress can't reach) |
| `PORT` | RUN_TIME | no | `8080` (= `http_port`) |
| `WOOCOMMERCE_CONSUMER_KEY` | RUN_TIME | yes | `ck_…` of a **Read/Write** WooCommerce REST key (the storefront also writes: it puts a signed-in shopper's order on their account and saves their address and account forms); set in the control panel |
| `WOOCOMMERCE_CONSUMER_SECRET` | RUN_TIME | yes | `cs_…` of the same key |
| `MOS_HSTS` | RUN_TIME | no | `0`; `1` after cutover once DNS and TLS on `musikogsport.is` are settled |
| `MOS_LOG_LEVEL` | RUN_TIME | no | `info` |
| `ASTRO_KEY` | BUILD_TIME | yes | output of `npx astro create-key`, kept across builds (server-island props, see [Environment](#environment)) |
| `WP_INTERNAL_URL` | BUILD_TIME | no | WordPress origin. The spec says `https://musikogsport.is`: the live site, which is WordPress until cutover. At cutover it becomes WordPress's own hostname (e.g. `https://wp.musikogsport.is`), with a rebuild. |
| `MOS_MEDIA_BASE_URL` | RUN_AND_BUILD_TIME | no | WordPress's public origin, where its media is served. The spec says `https://musikogsport.is`, the same as `WP_INTERNAL_URL`, and it changes with it at cutover. `photoBg` samples product photos from this host only. |
| `MOS_CLIENT_IP_HEADER` | BUILD_TIME | no | `do-connecting-ip` |
| `MOS_TRUSTED_PROXY_HOPS` | BUILD_TIME | no | `1` (fallback only) |
| `MOS_EXTRA_ALLOWED_HOSTS` | BUILD_TIME | no | `${APP_DOMAIN}`: the app's primary domain, i.e. the default `<app>.ondigitalocean.app` while no custom domain is added (the spec adds none until cutover), so form POSTs work there. DO's docs don't spell out how it resolves at build; if POSTs there get 403, put the exact default hostname here and rebuild. |

### Steps for the owner

1. **WordPress prep** (does not change the live site):
   - Create a WooCommerce REST key with **Read/Write** permission (WooCommerce → Settings → Advanced → REST API). Read
     alone is not enough: `lib/account` PUTs `/orders/<id>` (the order goes on the shopper's account, **Pantanir**) and
     `/customers/<id>` (the address and account forms), and with a Read key those fail with 401 while product pages and
     receipts keep working.
   - `woocommerce_price_num_decimals` must be `0` (ISK prices; WooCommerce → Settings → General → Number of decimals).
   - Give WordPress a second hostname (e.g. `wp.musikogsport.is`) with a valid TLS certificate, served by the same
     WordPress. It becomes `WP_INTERNAL_URL` and, at cutover, `WP_HOME`/`WP_SITEURL`.
   - Upload `mos-size-index.php` and run `wp mos-size reindex` once (backfills the size index), and
     `mos-catalog-clean.php`, then `wp mos-clean preview` → `wp mos-clean apply` (checklist step 3b). The other
     mu-plugins in `wp-mu-plugins/README.md` (never the `-local` shim): read their README notes first, since
     `mos-headless-mode.php` only redirects once `MOS_STOREFRONT_URL` is defined, but the others act on upload.
   - The storefront calls WordPress server-side only, so no CORS change is needed. The storefront's cookies are
     host-only on `musikogsport.is`; WordPress cookies are not shared with it.
2. **Check the spec**: `WP_INTERNAL_URL` and `MOS_MEDIA_BASE_URL` are `https://musikogsport.is` (the live
   WordPress site, until cutover); set `github.branch` to the branch to deploy (the spec says `main`). Validate it:
   `doctl apps spec validate .do/app.yaml`. `musikogsport.is` is behind Cloudflare: if its bot protection
   challenges App Platform's requests, the build fails or pages answer 503. Then allow `/wp-json/` for server
   traffic there, or do the WordPress hostname of step 1 first and use it here.
3. **Create the app**: `doctl apps create --spec .do/app.yaml` (or Apps → Create App → import the spec in the
   control panel). Connect GitHub to DigitalOcean first so it can read `Asdisarson/musikogsport`. The spec has no
   custom domain yet, on purpose (step 6).
4. **Secrets**: in Settings → `storefront` → Environment Variables, enter `WOOCOMMERCE_CONSUMER_KEY` and
   `WOOCOMMERCE_CONSUMER_SECRET`, tick **Encrypt**, keep the scope "Run time", save, and redeploy. The build
   succeeds without them, but until they are set every WooCommerce REST call fails (product pages answer 503).
5. **Test on the default domain** (`https://<app>.ondigitalocean.app`): `/api/healthz` → `ok`, home page, a
   category, a product, cart, sign-in.
   - A home page that answers 503 while `/verslun/` works means the headless mu-plugins of step 1 are not on the
     WordPress host yet (`/wp-json/mos/v1/front-page` and the menu routes answer 404; the log says
     `[cache] load failed: front-page -> 404`).
   - First, one failed sign-in must come back as a redirect to `/min-sida/?login=failed`. A 403 instead means the
     default host isn't trusted: set `MOS_EXTRA_ALLOWED_HOSTS` to that exact hostname, rebuild, and retry.
   - Then check once that DO overwrites a client's own `do-connecting-ip` (its docs don't say): sign in 11 times
     with a made-up e-mail and a wrong password, each request sending a different forged header, e.g.
     `curl -si -X POST -H 'Origin: https://<app>.ondigitalocean.app' -H 'do-connecting-ip: 198.51.100.N' -d 'username=nobody@example.com&password=x' https://<app>.ondigitalocean.app/api/account/login`.
     Sign-in allows 10 failures per visitor per 15 minutes, so the 11th must redirect to `/min-sida/?login=limited`
     (your own IP is then locked out of sign-in for 15 minutes). If every answer is `?login=failed`, the header can
     be forged: unset `MOS_CLIENT_IP_HEADER` and rebuild (the hop fallback then keys everyone on the ingress
     address: safe, but one shared limit) and reopen ticket 02.
6. **Cutover** (in one window; lower the DNS TTL a day before):
   - Uncomment `domains` and the `www` redirect rule in `.do/app.yaml` and apply it
     (`doctl apps update <app-id> --spec .do/app.yaml`, or add the domains in Settings → Domains).
   - DNS at the current provider: `www.musikogsport.is` gets a CNAME to the `…ondigitalocean.app` alias shown in
     Settings → Domains. The apex `musikogsport.is` gets the same CNAME if the provider supports CNAME flattening at
     the root; otherwise use App Platform's A records (its two public ingress IPs, listed in the control panel).
     If the domain has a CAA record, add `letsencrypt.org` and `pki.goog`. DNSSEC-signed domains are not
     supported. Propagation can take up to 72 hours, and the certificate is issued once the records resolve.
     ([DO docs](https://docs.digitalocean.com/products/app-platform/how-to/manage-domains/))
   - In `.do/app.yaml` (or Settings → Environment Variables) set `WP_INTERNAL_URL` and `MOS_MEDIA_BASE_URL` to the
     WordPress hostname from step 1 and **Force rebuild and deploy**: both are inlined at build, and after the DNS
     change `https://musikogsport.is` is the storefront itself.
   - WordPress: set `WP_HOME`/`WP_SITEURL` to its own hostname from step 1, and define `MOS_STOREFRONT_URL`
     (`https://musikogsport.is`) and `MOS_HEADLESS_REDIRECT_STATUS` (`301`) in `wp-config.php`. Keep WP-Cron
     running (see WordPress host above).
   - IP restrictions on the public WordPress write routes (see WordPress host above): App Platform's outbound
     address is not fixed by default, so either rate-limit those routes in the WAF, or look at DigitalOcean's
     dedicated egress IP option (paid) and allow only that address.
   - Straumur (WordPress side, see [Straumur at cutover](#straumur-at-cutover)): the payment webhook must reach the
     WordPress host, not the storefront.
7. **After DNS**: run a test order with the card gateway end to end (Straumur returns land on
   `musikogsport.is/gera-upp/...`), and repeat the step-5 checks on `musikogsport.is`. Once the certificate is
   live and the apex answers over https, set `MOS_HSTS=1` and redeploy — but first confirm that every web-facing
   subdomain of `musikogsport.is` (the WordPress host included) serves valid HTTPS: `includeSubDomains` makes
   browsers refuse plain http on all of them for a year.

### Rollback

- Bad deploy: Activity → pick the last good deployment → **Rollback**. The previous build is reused, no rebuild.
- Bad cutover: point the DNS records back at the old host (the reason to lower the TTL beforehand), set
  `WP_HOME`/`WP_SITEURL` back to `https://musikogsport.is`, and remove `MOS_STOREFRONT_URL` from `wp-config.php`
  so WordPress serves its own front end again.

### Not done

- Nothing has been created on DigitalOcean; no deploy, no DNS change, no WordPress change.
- Open owner decisions (ticket 02): enforcing the CSP, turning HSTS on, rate limits on the rest of the payment-flow routes (checkout itself is done),
  the Node 24 move.

## Production hardening

What the storefront does for production traffic (ticket 02), and what is left to the owner.

### Security headers

Set on every response: on-demand ones by `src/middleware.ts`, static files (`/_astro/*`, `robots.txt`, favicons)
and the prerendered pages by `server.mjs` (they never reach middleware; under `node dist/server/entry.mjs` they go
without). One source: `src/lib/securityHeaders.mjs`.

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` (plus CSP `frame-ancestors 'none'`) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()`. The card payment is a top-level navigation to Straumur's own page, so nothing on this origin needs the Payment Request API. |
| `Content-Security-Policy-Report-Only` | `default-src 'self'; script-src 'self' 'report-sample'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: <media origin>; font-src 'self' data:; connect-src 'self'; frame-src 'self' https://www.google.com https://maps.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | only with `MOS_HSTS=1`: `max-age=31536000; includeSubDomains`, no preload |

**The CSP is report-only: it blocks nothing.** Browsers log what it would block in the console (there is no
`report-uri` endpoint, so nothing is collected server-side). Known reports, by design:

- Every executable inline `<script>`: Astro's island bootstrap (3 per page), the server-island loader on product
  pages (it fetches `/_server-islands/RelatedProducts`) and the carousel script that comes back with it, Astro's hoisted component scripts
  (inlined when small: header, footer, login popup, hero, notices…), the theme script in `Base.astro`, and the
  thank-you page's `define:vars` poll (its content changes per order, so it can never be hashed as is).
- The `onerror` attribute on product images (`ProductImage.astro`), once per image.
- Local only: `http://localhost:10025` images (the local WordPress over http).

JSON-LD (`type="application/ld+json"`) is data and never reports. The Straumur hand-off is a `window.location`
navigation, which CSP doesn't govern, so the gateway needs no entry.

Enforcing it (owner decision, after reviewing the console reports on the real site): Astro 6's own
`security.csp` hashes Astro's bundled and hoisted scripts automatically, but it always *enforces* (a `<meta>` on
prerendered pages, a header on the rest), which is why it isn't used for the report-only phase. Before enforcing:
move the `define:vars` poll to a data attribute plus a bundled script, add the `Base.astro` theme script's hash
(`scriptDirective.hashes`), replace the `onerror` attribute with a bundled listener (or `'unsafe-hashes'` plus its
hash), and keep `frame-ancestors`, `form-action` and the rest in the middleware header (a `<meta>` CSP ignores
`frame-ancestors`).

### Caching

App Platform puts a Cloudflare CDN in front of the service. Service responses are cached only when their
`Cache-Control` allows it, and a cached response stays until the next deployment
([DO: cache content](https://docs.digitalocean.com/products/app-platform/how-to/cache-content/)); Cloudflare ignores
`Vary: Cookie`. So the rules (`src/lib/cachePolicy.ts`, applied by the middleware) never rely on `Vary`:

| Response | Cache-Control |
|---|---|
| Cart, checkout and thank-you, `/min-sida/`, wishlist, sign-out, `/api/cart*`, `/api/checkout`, `/api/order`, `/api/account/*` | `private, no-store` (whatever the route set) |
| Any response that sets a cookie | `private, no-store` |
| Errors (4xx/5xx), including the outage answer (503 + `Retry-After: 30`) | `no-store` |
| Public HTML pages | `no-cache` (revalidate every time). Not a short `s-maxage`: a page held at the CDN until the next deploy would freeze prices, stock and partial-outage renders, and how DO's CDN treats `s-maxage` is unverified. Revisit with the `cf-cache-status` header on the default domain if WordPress load needs it. |
| `/sitemap.xml` | `public, max-age=21600, stale-while-revalidate=86400` (its own) |
| `/api/posturinn/droppoints` (200) | `public, max-age=600` (its own: public locker lists) |
| `/api/products`, `/api/healthz`, other JSON | `no-store` |
| `/_astro/*` | `public, max-age=31536000, immutable` (hashed names; the adapter's static handler) |
| `robots.txt`, favicons, prerendered pages | `public, max-age=0` (the static handler's default) |

`headers.txt` from the ticket's probe shows each of these. To turn the CDN off entirely: `disable_edge_cache: true`
in the spec.

### Errors and logs

- Logs are one JSON object per line (`{time, level, msg, …}`) in the runtime logs: `[woo]` request failures,
  `upstream unavailable` for each 503, `server error` for other 5xx, `request failed` (with the error) when a page
  throws (Astro then renders `500.astro`), `unhandled rejection`, and shutdown. Fields are the method, the
  **pathname only** (queries carry order and reset keys), status and ms. Every string is passed through
  `redactSecrets`, which blanks `consumer_key`, `consumer_secret`, `key`, `password`, `token` and similar values; the
  WooCommerce REST key travels as a query param, and `lib/woo` also scrubs it from errors it rethrows.
- Unhandled promise rejections are logged and the process keeps serving (this replaces the node adapter's own
  listener, which logged the raw request URL). Uncaught exceptions are logged and then crash as usual; App Platform
  restarts the container (`RESTART_COUNT` alert in the spec).
- WordPress unreachable: pages answer 503 with `Retry-After: 30` and `no-store` (`markUnavailable`); `404.astro`
  and `500.astro` render with the layout's degraded chrome.

### Rate limits

Per visitor (`do-connecting-ip` on App Platform), per process, in `src/lib/rateLimit.ts` windows. A refused request
gets 429 with `Retry-After`, `no-store` and an Icelandic `{message}`. Numbers are generous because Icelandic mobile
carriers put many phones behind one address (CGNAT).

| Route | Limit |
|---|---|
| Sign-in | 10 failed attempts / 15 min (existing) |
| Lost / reset password | 5 / h, 10 / h (existing) |
| Contact | 5 / 15 min (existing) |
| `POST /api/cart`, `/api/cart/update`, `/api/cart/remove` | 120 / min, shared |
| `GET /api/products` | 60 / min |
| `GET /api/posturinn/droppoints` | 60 / min (a bad postcode costs nothing) |
| `POST /api/checkout` | 10 / min (the order-placing route; checked before WooCommerce is called; approved by the owner 2026-10-26) |
| `POST /api/checkout/status` | 30 / min (the checkout page's follow-up after an order whose answer was lost: about 6 asks per lost answer; read-only, checked after the attempt id is validated) |
| `GET /api/order` | 20 **misses** / 15 min (a found order gives its slot back, so the thank-you poll is never limited) |
| Filtered listings | Not per visitor: cold Store API count requests (`collection-data`) are capped at 240 a minute per process. Past that, listings render without option counts (or with stale ones) instead of asking WordPress; the product grid is unaffected. |

Not limited, on purpose: `GET /api/cart` (every page view), and the rest of the payment flow — the calls
the checkout page makes (`/api/cart/customer`, `/api/cart/select-shipping`, `/api/cart/coupon`,
`/api/cart/remove-coupon`), and the thank-you page `/gera-upp/order-received/<id>/?key=…`, which looks the order
up by the URL's key outside the `/api/order` limiter. Those wait for the owner's sign-off (ticket 02).

### Graceful shutdown

On redeploy App Platform drains the instance at its load balancer (`termination.drain_seconds`, default 15), then
sends SIGTERM, then SIGKILL after `grace_period_seconds` (default 120)
([app spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/)). The node adapter installs no
SIGTERM handler, so the bare entry exits at once and drops in-flight requests (a checkout can wait 25 s on the Store
API). `server.mjs` stops accepting connections, lets in-flight requests finish, and exits, with a 30 s backstop
(`MOS_SHUTDOWN_TIMEOUT_MS`). Nothing in-process needs flushing: every cache (catalog, counts, photo edges, rate-limit
windows) is disposable and rebuilt on demand.

### Straumur at cutover

The storefront holds no Straumur key and calls no Straumur endpoint: it only follows the hosted-checkout URL the
WordPress plugin returns, and only to `https://*.straumur.is` (`src/lib/checkoutRedirect.ts`). Everything below is
the WordPress plugin's (Straumur Payments for WooCommerce, WooCommerce → Settings → Payments → Straumur). Its key is
LIVE: check these settings by reading them, never by calling Straumur.

- `test_mode` off: the plugin then uses `production_url` (default `https://greidslugatt.straumur.is/api/v1/`);
  test mode uses `checkout-api.staging.straumur.is`.
- `api_key`, `hmac_key`, `terminal_identifier`, `gateway_terminal_identifier`: unchanged by the move.
- `webhook_url`: the plugin's default is `home_url('/wp-json/straumur/v1/payment-callback')`, i.e. on `WP_HOME`.
  After cutover `WP_HOME` is the WordPress hostname, so the callback must be registered **there** (in the plugin and
  wherever Straumur's merchant dashboard holds it). A callback still pointing at `https://musikogsport.is/wp-json/…`
  would reach the storefront, which has no `/wp-json/`, and payment confirmations would be lost.
- Return URLs are built on `home_url('/')` with `wc-api=straumur`, so they also land on the WordPress host; the
  bridge (`headless-bridge.php`) and headless mode (`MOS_STOREFRONT_URL`, `MOS_HEADLESS_REDIRECT_STATUS`) then send
  the shopper to `musikogsport.is/gera-upp/...`.
- `custom_success_url` / `abandon_url`: leave empty (WooCommerce's own return URL, rewritten by the bridge), or
  point them at the storefront's `/gera-upp/...` paths.
- A shopper who is on Straumur's page during the switch returns to whatever `WP_HOME` was when the order was
  placed. Change `WP_HOME` and DNS in the same window, outside opening hours, and check the orders placed during
  it.

### mu-plugin deploy checklist

On the WordPress host, in this order. Each step has its check; stop at the first that fails.

1. **Prerequisites.** WordPress, WooCommerce, ACF (free) and the jwt-authentication-for-wp-rest-api plugin active;
   `JWT_AUTH_SECRET_KEY` defined in `wp-config.php`.
   Check: `wp plugin list --status=active` lists `woocommerce`, `advanced-custom-fields`,
   `jwt-authentication-for-wp-rest-api`.
2. **Upload** to `wp-content/mu-plugins/`: `mos-posturinn-droppoints.php`, `headless-bridge.php`,
   `mos-headless-api.php`, `mos-headless-mode.php`, `mos-account-api.php`, `mos-checkout-fields.php`,
   `mos-size-index.php`, `mos-catalog-clean.php`, `mos-nav.php`, `mos-stillingar.php`. **Never
   `headless-bridge-local.php`** (the local-dev shim rewrites redirects to localhost).
   Check: `wp plugin list --status=must-use` shows exactly those ten, and `ls wp-content/mu-plugins` has no
   `-local` file. `mos-headless-mode.php` does nothing until `MOS_STOREFRONT_URL` is defined (step 4), so uploading
   it before cutover is safe; the others act at once but only add routes, fields and the wp-admin "Stillingar" page.
3. **Size index backfill**: `wp mos-size reindex` (seconds; rerunnable). Until it runs, size filters match nothing.
   Check: it prints per-group counts, and
   `curl -s 'https://<wp-host>/wp-json/wc/store/v1/products/collection-data?mos_size_counts=1' | jq '.mos_size_counts | length'`
   is above 0.
3b. **Catalog clean-up** (writes product data; the filters' brand, gender, sport and colour coverage depends on it):
   `wp db export pre-mos-clean.sql`, then `wp mos-clean preview` (writes nothing: read the term changes, the skipped
   variation products and the coverage), then `wp mos-clean apply` (a few minutes; one run is enough). Keep the
   journal it names (`wp-content/uploads/mos-clean/journal-<time>-<random>.json`): `wp mos-clean restore <journal>`
   undoes that run (not later save-time fills; the SQL export covers those). The folder gets an `.htaccess` deny;
   on nginx, block `/wp-content/uploads/mos-clean/` in the server config (or move the journal off the server). From then on new and edited products are filled
   on save, never refilling a field the owner cleared. `wp mos-size reindex` is not needed again (sizes are untouched).
   The same apply also tidies the categories (`mos_clean_category_ops`): the Íþrótt tree becomes the sport filter,
   the club categories (Stjarnan, FH, Fimleikafélagið Björk) the club filter, the top-level Didriksons the brand,
   Boltar and Félag/lið merge into Æfingavörur › Boltar and Liðafatnaður, Sumar moves under Æfingavörur, empty
   categories go. The storefront 301s every removed category URL (`MOVED_CATEGORIES` in `src/lib/paths.ts`), so
   deploy the storefront first or together.
   Check: a second `wp mos-clean preview` sets 0 brand/gender/sport/colour and lists no category changes, and
   `python3 wp-mu-plugins/tests/store_api_colour_test.py https://<wp-host>` passes.
3c. **Main menu** (after 3b, which it counts): `wp mos-nav preview` (prints the menu with product counts), then
   `wp mos-nav apply`: writes the menu "Aðalvalmynd 2026" and puts it in the primary location; the old menu stays.
   Rollback: Útlit → Valmyndir → Stjórna staðsetningum → Aðalvalmynd. Rerun `apply` when the catalog changes a lot
   (it rebuilds the menu, dropping hand edits made to it). Check: every menu link opens a page with products.
4. **`wp-config.php` constants** (at cutover, not before): `MOS_STOREFRONT_URL` = `https://musikogsport.is`,
   `MOS_HEADLESS_REDIRECT_STATUS` = `301`.
   Check: `wp eval 'echo MOS_STOREFRONT_URL, " ", MOS_HEADLESS_REDIRECT_STATUS;'`, and
   `curl -sI https://<wp-host>/verslun/` answers `301` to `https://musikogsport.is/verslun/`, while
   `curl -sI 'https://<wp-host>/wp-json/'` still answers 200 (REST is never redirected).
5. **WooCommerce settings.**
   - Guest checkout on (Settings → Accounts & Privacy). Check: `wp option get woocommerce_enable_guest_checkout` is
     `yes`.
   - `woocommerce_price_num_decimals` = `0`. Check: `wp option get woocommerce_price_num_decimals` is `0`.
   - A **Read/Write** REST key for the storefront. Check: WooCommerce → Settings → Advanced → REST API lists it with
     "Read/Write"; `curl -s -o /dev/null -w '%{http_code}' 'https://<wp-host>/wp-json/wc/v3/products?per_page=1&consumer_key=…&consumer_secret=…'`
     is 200 (run it from your machine, never paste the key into logs or tickets).
6. **Public endpoints answer.** Check:
   `curl -s 'https://<wp-host>/wp-json/mos/v1/front-page' | jq 'keys'`,
   `curl -s 'https://<wp-host>/wp-json/mos/v1/menu/location/primary' | jq 'length'`, and
   `curl -s 'https://<wp-host>/wp-json/mos/v1/droppoints?postcode=101&type=postbox' | jq '.ok'` (`true`).
7. **WP-Cron runs** (it clears the sign-out denylist transients). Check: `wp cron event list` shows events due in
   the future, not hours overdue; with `DISABLE_WP_CRON`, a system cron runs `wp cron event run --due-now`.
8. **IP or WAF limits on public write routes** (`jwt-auth/v1/token`, `mos/v1/contact`,
   `mos/v1/account/lost-password`, `…/reset-password`): App Platform's egress address is not fixed by default, so
   rate-limit them in the WAF (or buy DO's dedicated egress IP and allow only it). The sign-in route has no
   limit inside WordPress on purpose (a per-IP cap there would be shared by every shopper; see
   [WordPress host](#wordpress-host)), so this rule is its only protection against password guessing.
   Check, without side effects: 15 rapid `POST`s of a made-up user and wrong password to
   `/wp-json/jwt-auth/v1/token` from your own machine end in 429 or a WAF block (don't test with the contact form:
   each accepted post e-mails the shop). And the user list stays closed:
   `curl -s -o /dev/null -w '%{http_code}' 'https://<wp-host>/wp-json/wp/v2/users'` is `404`.
9. **Straumur settings** as in [Straumur at cutover](#straumur-at-cutover). Check (read only): WooCommerce → Settings
   → Payments → Straumur shows test mode off and the webhook URL on the WordPress host.

### Node 24 (plan only, not done)

Node 22 reaches end of life in April 2027. The move to Node 24 LTS: set `engines.node` to `24.x` and `.nvmrc` to
`24`, run the gates (`npx vitest run`, `npx astro check`, `npm run build`, the route and link checks) on Node 24 —
note the local gates currently run on Node 26, not the 22 that App Platform uses — then deploy to App Platform
(the buildpack follows `engines`). Check sharp's prebuilt binaries and `@astrojs/node` support for 24 first
(`npm view sharp engines`, `npm view @astrojs/node engines`).
