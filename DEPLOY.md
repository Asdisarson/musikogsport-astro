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
| `Host` (kept) or `X-Forwarded-Host` | `musikogsport.is` / `www.musikogsport.is` | Same check. Only the hosts in `security.allowedDomains` (`astro.config.mjs`) are trusted. That list is generated from `MOS_EXTRA_ALLOWED_HOSTS`, so add an exact staging host to that variable and rebuild. |
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
| `WP_INTERNAL_URL` | build time | Baked into the bundle: set it before `npm run build`. No page is prerendered and nothing is fetched at build time, so the build passes before WordPress answers; pages answer 503 until it does. |
| `MOS_MEDIA_BASE_URL` | build time (+ runtime for `server.mjs`) | Optional, default `https://musikogsport.is`. The host serving WordPress media: local media URLs are rewritten onto it and `photoBg` samples product photos from it only. Once the apex points at the storefront, set WordPress's public origin (e.g. `https://wp.musikogsport.is`). Inlined into the client bundle too (the cart uses it). |
| `MOS_WP_ADMIN_URL` | run time | Optional. The origin whose `/wp-admin/` the staff admin bar links to (`api/account/editor`). Default: `MOS_MEDIA_BASE_URL`, WordPress's public origin. Set it only where the two differ (local development: `http://localhost:10025`). |
| `MOS_TRUSTED_PROXY_HOPS` | build time | How many proxies in front of Node append to `X-Forwarded-For`. Default `1`, the TLS proxy above; add one per extra layer (e.g. a CDN in front of nginx). Never expose Node directly with `1`: a client could then pick its own rate-limit key. `0` is only for Node facing visitors directly: the socket address is the key, and any request carrying `X-Forwarded-For` goes into one shared bucket. Behind a proxy, `0` makes every visitor share one limit. |
| `MOS_CLIENT_IP_HEADER` | build time | Optional. A header the hosting edge sets to the visitor's IP; when present it is the rate-limit key and `MOS_TRUSTED_PROXY_HOPS` is only the fallback. Leave unset behind nginx; App Platform: `do-connecting-ip`. |
| `MOS_EXTRA_ALLOWED_HOSTS` | build time | Optional, comma-separated exact hostnames added to `security.allowedDomains` (`src/lib/allowedHosts.mjs`), e.g. a staging host. No wildcards. |
| `ASTRO_KEY` | build time and run time | Set it in production (a secret), in both environments: the key Astro encrypts server-island props with (the product page's related products, `server:defer`), and the page store reads it at run time to name the pages it keeps. Unset, every build makes a new one, so a product page opened before a deploy loses its related row (the island request fails after it). Without it at run time every process start gets a new store id, so the stored pages are never read again after a restart. Make one with `npx astro create-key` and keep it across builds and restarts. |
| `HOST`, `PORT` | runtime | Own server: leave `HOST` unset (the build's default bind is `127.0.0.1`): Node must only be reachable through the proxy; with `MOS_TRUSTED_PROXY_HOPS=1` a directly reachable Node lets a client choose its own rate-limit key. `PORT` defaults to 4321. App Platform: `HOST=0.0.0.0`, `PORT=8080` (the container is reachable only through DO's ingress). |
| `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` | runtime only | Secrets: pass them to the Node process (`node --env-file=.env server.mjs`). `lib/woo` reads them when it makes a request, so `npm run build` needs neither (checked with a clean `npm ci && npm run build` without them). Without them every WooCommerce REST call fails (product pages, wishlist, receipts). |
| `MOS_HSTS` | runtime | `1` sends `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no preload). Off by default: turn it on only once DNS and TLS on the apex are settled. |
| `MOS_LOG_LEVEL` | runtime | `debug` / `info` (default) / `warn` / `error` for the JSON logs; `debug` adds one line per request. |
| `MOS_SHUTDOWN_TIMEOUT_MS` | runtime | Optional, default `30000`: how long `server.mjs` waits for in-flight requests after SIGTERM before exiting. |
| `MOS_SHELL` | runtime | Optional. `off` turns the rendered-page store off: every page is rendered on every request, as before. Default: on. |
| `MOS_SHELL_DIR` | runtime | Optional. The folder the rendered pages are kept in. Default: `mos-shells` in the system temp directory, which a reboot can clear (the pages are then rendered again). Set a durable folder on the server. |
| `MOS_SHELL_FRESH_MS` | runtime | Optional, milliseconds: overrides every stored page's lifetime. For tests and a quick check of the refresh path; leave unset in production. |
| `MOS_SHELL_REBUILD_AT` | runtime | Optional. **The nightly rebuild is off by default**: it runs only when this holds a time, or when it is switched on in wp-admin (Stillingar → Síðugeymsla). The time of day (`HH:MM`, Atlantic/Reykjavik, which is UTC all year) at which every stored product page and listing is marked stale and walked again ("Nightly rebuild" below). `off` turns it off. A value that is neither a time nor `off` leaves the rebuild off (05:00 is then only the time it would use) and writes one log line; fix it and restart the app. |
| `MOS_SHELL_REBUILD_BASE` | runtime | Optional, an `https://` (or `http://`, for a local run) origin: the one the nightly walk requests (only its origin is used). Default: `https://` plus the first host of `MOS_EXTRA_ALLOWED_HOSTS`, read from the run-time environment or, when that is unset, from the build-time value (so the build-time value is enough). Never the apex, which is behind the CDN cache. With neither, the nightly rebuild does nothing (the development server does nothing too). |
| `MOS_SHELL_REBUILD_CONCURRENCY` | runtime | Optional, default `2`: how many pages the nightly walk renders at once, an integer `1` to `4`. Anything else gives `2` and a log line. Drops to `1` by itself while WordPress answers badly (see "Nightly rebuild"). |
| `MOS_SHELL_REBUILD_PAUSE_MS` | runtime | Optional, default `100`: the base pause in milliseconds between renders, an integer `0` to `30000`. Anything else gives `100` and a log line. The pause doubles on each bad answer (from at least 100 ms, so a base of `0` still backs off to 200 ms, 400 ms and so on, up to 30 s) and halves back towards this value. |
| `MOS_IMG_CACHE_DIR` | runtime | Optional. The folder the converted `/img/` files (AVIF and WebP) are kept in. Default: `mos-img` in the system temp directory (a reboot clears it; the files are made again on the next request). |
| `MOS_SHELL_BASE` | `npm run shells` only | Optional, default `http://127.0.0.1:10026`: the origin the pre-build script visits. The server does not read it. On the server, pass `--base` instead (see "Pre-building pages"). |
| `MOS_SHELL_POKE_KEY` | runtime | Optional. A shared secret for `POST /api/shell-refresh` and for the admin endpoint `/api/shell-admin` (where, without it, every request is refused: 403). Set the same value as the WordPress constant `MOS_SHELL_POKE_KEY` (in `wp-config.php`): WordPress then sends it as `X-Mos-Shell-Key`, and any other caller is refused (403) before it counts against a limit. Unset: the route stays open but bounded by the path budgets (see Rate limits). **Set it in production**: until it is set, any address can spend that budget. No secret is shared by WordPress and the storefront today (the only credential both hold is the WooCommerce key pair, which this route does not use), so generate a new one, for example `openssl rand -hex 32`, and put it in both places. Changing it needs a restart only. |

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
- Define `MOS_SHELL_POKE_KEY` in `wp-config.php` as well, with the same value as the storefront's `MOS_SHELL_POKE_KEY`.
  The product poke (`mos-shell-poke.php`) and the Síðugeymsla page (`mos-shell-admin.php`) both send it; without it the
  storefront treats the poke as unkeyed, and the admin page shows what to set instead of its cards.

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
| `ASTRO_KEY` | RUN_AND_BUILD_TIME | yes | output of `npx astro create-key`, kept across builds and restarts (server-island props, and the page store's identity at run time, see [Environment](#environment)) |
| `MOS_SHELL_POKE_KEY` | RUN_TIME | yes | the same value as the WordPress constant `MOS_SHELL_POKE_KEY` (WordPress host, checklist step 4). Without it `/api/shell-admin` answers 403 and the poke is unkeyed (see [Rate limits](#rate-limits)). |
| `WP_INTERNAL_URL` | BUILD_TIME | no | WordPress origin: `https://wp.musikogsport.is`, WordPress's own hostname (step 1). The build does not call it, but pages answer 503 until it resolves and serves valid HTTPS. It does not change at cutover. |

`.do/app.yaml` has to match this table. Until its spec carries the `ASTRO_KEY` scope and the `MOS_SHELL_POKE_KEY` secret, set both by hand in the control panel with the scopes shown.
| `MOS_MEDIA_BASE_URL` | RUN_AND_BUILD_TIME | no | WordPress's public origin, where its media is served: `https://wp.musikogsport.is`, the same as `WP_INTERNAL_URL`. `photoBg` samples product photos from this host only. |
| `MOS_CLIENT_IP_HEADER` | BUILD_TIME | no | `do-connecting-ip` |
| `MOS_TRUSTED_PROXY_HOPS` | BUILD_TIME | no | `1` (fallback only) |
| `MOS_EXTRA_ALLOWED_HOSTS` | BUILD_TIME | no | `new.musikogsport.is`: the host the storefront is served on before cutover. Form POSTs from any other host get 403, the default `<app>.ondigitalocean.app` included; to test there, add that exact hostname (comma-separated) and rebuild. |

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
2. **Check the spec**: `WP_INTERNAL_URL` and `MOS_MEDIA_BASE_URL` are `https://wp.musikogsport.is`, the WordPress
   hostname of step 1. The build does not call WordPress (no page is prerendered), so it passes before that name
   resolves; the pages answer 503 until it does, while `/api/healthz`, which calls nothing upstream, still passes. Set
   `github.branch` to the branch to deploy (the spec says `main`). Validate it: `doctl apps spec validate .do/app.yaml`.
   If a CDN or WAF in front of that hostname challenges the app's requests, the pages answer 503: allow `/wp-json/` for
   server traffic there.
3. **Create the app**: `doctl apps create --spec .do/app.yaml` (or Apps → Create App → import the spec in the
   control panel). Connect GitHub to DigitalOcean first so it can read `Asdisarson/musikogsport-astro`. The spec has no
   custom domain yet, on purpose (step 6).
4. **Secrets**: in Settings → `storefront` → Environment Variables, enter `WOOCOMMERCE_CONSUMER_KEY` and
   `WOOCOMMERCE_CONSUMER_SECRET`, tick **Encrypt**, keep the scope "Run time", save, and redeploy. The build
   succeeds without them, but until they are set every WooCommerce REST call fails (product pages answer 503).
   Also enter `MOS_SHELL_POKE_KEY` the same way (encrypted, run time; the value WordPress holds too, see
   [Environment](#environment)) and `ASTRO_KEY` (encrypted, scope "Run and build time", so the page store keeps its
   pages across restarts).
5. **Point `new.musikogsport.is` at the app**: the spec lists it as the primary domain. At the DNS provider add a
   CNAME `new` → the `<app>.ondigitalocean.app` name shown in Settings → Domains, **DNS-only** (in Cloudflare: grey
   cloud). Proxied through Cloudflare, App Platform sees Cloudflare's addresses as the visitor, so the per-visitor
   rate limits become shared. The certificate is issued once the record resolves. Canonical links, the sitemap and
   Open Graph URLs keep saying `https://musikogsport.is` (`site` in `astro.config.mjs`), so search engines don't
   index the `new.` host. For checkout and payment returns to land here, WordPress needs `MOS_STOREFRONT_URL` =
   `https://new.musikogsport.is` — that also redirects the live WordPress front end, so leave it until cutover and
   test payments then.

   **Test on `https://new.musikogsport.is`** (in the commands below, use it in place of
   `https://<app>.ondigitalocean.app`): `/api/healthz` → `ok`, home page, a
   category, a product, cart, sign-in.
   - A home page that answers 503 while `/verslun/` works means the headless mu-plugins of step 1 are not on the
     WordPress host yet (`/wp-json/mos/v1/front-page` and the menu routes answer 404; the log says
     `[cache] load failed: front-page -> 404`).
   - First, one failed sign-in must come back as a redirect to `/min-sida/?login=failed`. A 403 instead means the
     host you are on isn't trusted: add that exact hostname to `MOS_EXTRA_ALLOWED_HOSTS`, rebuild, and retry.
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
- Open owner decisions from the review: the 30 s cache of the in-stock option count; a photo original too big to sample,
  kept as a decided null for 24 hours; whether `POST /api/content-refresh` needs a key or a cap (today it has neither,
  only the two-second window).

## Plesk

The storefront on the same server as WordPress, under Plesk's Node.js extension (Phusion Passenger), served on
`new.musikogsport.is` until cutover.

- **Files:** Plesk's Git extension pulls this repository into the subdomain's folder (the application root).
- **Node.js:** version 22 (Astro needs 22.23.4 or newer; installed under Plesk → Node.js → Node versions). Application Startup File `app.cjs`: Passenger loads it
  with `require()`, and it imports `server.mjs`. Passenger takes over the port, so `HOST` and `PORT` are not set.
- **Build:** "NPM install", then "Run script" `build:plesk`. That script carries the build-time values
  (`WP_INTERNAL_URL`, `MOS_MEDIA_BASE_URL`, `MOS_EXTRA_ALLOWED_HOSTS`, `MOS_CLIENT_IP_HEADER`) and skips
  `astro check`, whose packages are devDependencies that a production install leaves out. Repeat both and
  "Restart App" after every pull.
- **Pre-building pages (after Restart App):** wait until `/api/healthz` answers 200 and one light page (for example `/`)
  renders. Only then, and only on the owner's word, run `npm run shells -- <args>` against the storefront. It visits
  the product and category URLs from `sitemap.xml` one at a time, with a pause (`--delay`, default 500 ms) that
  doubles on any answer other than 2xx, 3xx, 404 or 410 (so 401, 403, 429 and 5xx), on a timeout, and on an answer
  slower than `--slow` (default 3000 ms). It stops after `--max-failures` (default 5) failures in a row with exit
  status 2. Run it slowly, for example `--delay=1000`, and start with `--limit=30`. It can be run again later and
  carries on from the pages already kept, while the app keeps the same `ASTRO_KEY` (see [Environment](#environment)).
  Stop it if WordPress slows
  down; cold caches are what stalled production WordPress once (see the mu-plugin checklist).
  **The run on the server.** Passenger takes the port, so there is no fixed local address; run it against the host
  the storefront answers on, which the app keeps pages for (`MOS_EXTRA_ALLOWED_HOSTS` lists it):

  ```
  npm run shells -- --base=https://new.musikogsport.is --allow-remote --delay=1000 --limit=30
  npm run shells -- --base https://new.musikogsport.is --allow-remote --delay=1000
  ```

  `--base` takes its value either as `--base=https://…` or as `--base https://…`; a missing or bad value prints the usage
  line and exits with status 1. The script reads each page's `X-Mos-Shell` header: `miss` is a page rendered and kept,
  `hit` and `stale` are pages the store already held, and `refused` is a page rendered that the store would not keep (a
  cookie, `no-store`, or an incomplete render). A refused page is rendered again on every visit, so the run counts those
  apart and warns at the end.

  Do not use the apex (`musikogsport.is`) for the run: it is behind the Cloudflare cache, which may answer from its own
  copy, so the app never renders and nothing is kept. Where the app listens on a local port (`PORT`), the script can
  instead take `--base=http://127.0.0.1:<PORT> --host=new.musikogsport.is`, which sends `X-Forwarded-Host` (the app
  trusts it only for its allowed hosts). The script first checks that the first URL answers 200 with `X-Mos-Shell` (`miss`, `hit`
  or `stale`) and that its repeat is a hit, the repeats using the same pause and backoff as the run; if not, it stops
  with exit status 3 and says why (a host the app does not trust, or
  `MOS_SHELL=off`). Without `--allow-remote` it refuses any host that is not local (`127.0.0.1`, `localhost`, `::1`,
  `*.localhost`, `*.test`).
- **Document Root:** `dist/client` under the application root, never the root itself: nginx serves the document
  root as static files, and the root holds the source and any `.env`. Changing it moves the Application Root to its
  parent (`dist`): set the Application Root back to the project folder afterwards.
- **Custom environment variables** (Node.js → Environment): `WOOCOMMERCE_CONSUMER_KEY`,
  `WOOCOMMERCE_CONSUMER_SECRET`, `MOS_HSTS`, `MOS_LOG_LEVEL`, `MOS_MEDIA_BASE_URL` (the run-time CSP reads it),
  `MOS_SHELL_POKE_KEY` (the same value as WordPress's) and `ASTRO_KEY`. `ASTRO_KEY` has to be in the environment of the
  build as well: without it at run time the page store starts a new set of pages at every restart (see Environment).
- **Visitor IP:** `build:plesk` sets `MOS_CLIENT_IP_HEADER=cf-connecting-ip`, because Cloudflare is in front. That
  header is only trustworthy if the server accepts web traffic from Cloudflare's addresses alone; a caller reaching
  the server's IP directly can forge it and get its own rate-limit bucket.

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

Cloudflare is in front of the app and ignores `Vary: Cookie`, so the rules (`src/lib/cachePolicy.ts`, applied by the
middleware) never rely on `Vary`. Public pages are the same for every visitor (no public page reads a cookie; cart
count, wishlist and consent are drawn in the browser), so they may be held at the CDN for five minutes
(`s-maxage=300`, and `stale-while-revalidate=60` after that).

Cloudflare only stores HTML once a rule makes it eligible. In the Cloudflare dashboard: **Caching → Cache Rules →
Create rule**: *Hostname equals* `musikogsport.is` → **Eligible for cache**, Edge TTL **Use cache-control header if
present, bypass cache if not**. Leave Browser TTL on "Respect origin". Without the rule every page answers
`cf-cache-status: DYNAMIC` as before; with it a public page answers `HIT`, and `private, no-store` / `no-store`
responses are never stored. To turn page caching off again, disable the rule.

The storefront keeps rendered pages itself (`src/lib/shellStore.ts`, policy in `src/lib/shellPolicy.ts`), on disk
under `MOS_SHELL_DIR`, and serves a kept page at once: product pages for a day, listings and the home page for five
minutes, filtered listing URLs for two minutes in memory only (at most 500; a stock-filtered one, `?lager=1`, is never kept, see below). A page past its lifetime is still served
and rendered again in the background. WordPress marks a saved product's page stale through `mos-shell-poke.php`
(`POST /api/shell-refresh`), and a product that leaves the shop is dropped. A save of the front page or its chrome (`POST /api/content-refresh`, WordPress's "Forsíða" save, with no key) re-reads the front page and the chrome; calls within two seconds share one read. When what the pages render has changed, every stored page is marked stale. The answer is 204, or 502 when WordPress could not be read in full. A product whose slug or category changed
has its old address dropped too, and a stored page whose re-render answers 404 or a redirect is removed (it is not
served as 200 any more); a re-render that fails (5xx, an incomplete page, a copy the store will not keep, or an error) keeps the stored copy and
waits longer before the next try (30 s, doubling, up to 30 minutes). Background re-renders run six at a time; up to 200
more wait, and any beyond that are skipped while the stored copy is served. A bulk change (more than 50 paths in one save or import) is sent in batches of 50 without `MOS_SHELL_POKE_KEY`
(at most 20 batches; the rest is logged as unsent). With the key it may be sent as one "every product" mark, which also
makes the storefront's product and grid lookups read WooCommerce again (the mark is refused without the key). A page rendered while a poke arrived is not kept if the
poke came after the render started. A drop that lands while a page is being written wins: the write is not renamed
into place, and a page on disk that was rendered before a drop is not served. A failed write removes its partial file
at once, and `prune` removes any partial file older than ten minutes. A scheduled sale (WooCommerce's cron, or the
Action Scheduler actions that start and end a product's sale, save the product with no one logged in) pokes as an
editor's save does, unless the save changed only stock. Any change between published and not published pokes too: a
scheduled product going live without a save is marked, and one taken off the shop is dropped. A render that is running when a poke arrives is treated as
stored, so the poke still applies to it. A path longer than
200 characters is logged and left out of its poke; the rest of the poke is sent. The build id covers the server build and the island key, so a release that
changes only server markup starts a new set of pages. Stock is never in a rendered page and is
never kept: it is read live from `/api/live/` (`no-store`) and filled in the browser. A price is baked into the page
and corrected in the browser from the same live answer, so a changed price shows within about a tenth of a second
of the page's arrival. Cart and checkout read WooCommerce live. The product and variation caches hold no stock, and search suggestions carry
none (their sold-out marks come from `/api/live`). The product page's related row is rendered with 24 candidates for its
12 tiles, and the browser hides the ones the live answer names sold out, so a spare shows in their place. The in-stock
count on the stock-filter row is the one exception: it is held for 30 seconds with the other option counts (an open
owner decision, see Not done). A variable product with more than 500 variations (five pages of 100, `MAX_VARIATION_PAGES`
in `src/lib/woo.ts`) is shown as degraded: its sizes are unavailable, the page is not stored as complete, and its live
stock answers 502. A page rendered with content missing (a failed lookup, a product photo whose colour sampling failed
or timed out, or filter terms that are degraded) is sent `no-store` and never held, neither by the CDN nor by the store.

**Filtered listings.** A stock-filtered listing (`?lager=1`) is never stored, not even in memory. It is sent
`private, no-store`, and its grid is read from WordPress on each request, at most 120 new reads a minute for the whole
process (`STOCK_GRIDS_PER_MINUTE` in `src/lib/storeCatalog.ts`). Past that the listing answers 503 with `Retry-After: 30`.
Picks are capped at 6 values per filter group and 12 in all (`MAX_PICKED_PER_FILTER` and `MAX_PICKED_TOTAL` in
`src/lib/liveFilters.ts`). A URL over the cap is redirected (302) to the same page with only its search text kept, and
the rail shows the options past the cap as unavailable, with a note. Sizes, price and flags are not capped.

**Product photos.** A photo whose colour sample fails with a transient error (a reset, a timeout, a 5xx, or a 403 or 429
from the media host) stays undecided for 60 seconds and is then tried again, so a page showing it is not kept as
complete. A decided outcome (a 404 or 410 from the media host, or bytes the image library cannot read) is kept for 24
hours.

**Nightly rebuild.** Off by default; switched on in wp-admin (Stillingar → Síðugeymsla) or by a time in `MOS_SHELL_REBUILD_AT`. When on, once a day at its time (05:00 unless set), the storefront walks the product and category
URLs of its own sitemap, marking each path stale just before it is requested (so only the pages the walk has reached are stale, and
real visitors see the stored copy until then), by requesting their paths on `MOS_SHELL_REBUILD_BASE` (the storefront's own host;
only the path of each sitemap URL is taken, and redirects are not followed). Two workers (`MOS_SHELL_REBUILD_CONCURRENCY`, default 2)
take paths from one shared queue; each worker waits for its page's refresh to end before it takes the next, so at most two renders run at once.
The pause between renders is `MOS_SHELL_REBUILD_PAUSE_MS` (100 ms by default) per worker.

**Settings and precedence.** The four `MOS_SHELL_REBUILD_*` variables above are the defaults. The WordPress page "Síðugeymsla"
(card "Stillingar næturkeyrslu") saves five settings, which win over them: `enabled` (on or off), `at` (`HH:MM`, Reykjavík),
`concurrency` (1 to 4), `pauseMs` (0 to 30000 milliseconds) and `catchUp` (whether a run missed while no process was up is
caught up within three hours; off leaves only a five-minute grace after the time). The precedence, per field: a saved value;
else the environment (an unset `MOS_SHELL_REBUILD_AT`, or `off`, is `enabled` false, with the time 05:00; a time in it is `enabled` true; a value that is neither a time nor `off` is `enabled` false too, with a log line); else the default. A field that is
not saved falls back the same way. Out-of-range values are refused with a line of text, never clamped.
The copy on the storefront is kept in `nightly-settings.json` beside the stamp file (in `MOS_SHELL_DIR`, or the temp folder), with
the last seven runs, written whole and atomically. A save takes effect at once: a new time moves the next run, but a save never starts
one. Switching the run off does not stop a walk already going; use "Stöðva keyrslu" for that.
**The source of truth is WordPress**: the option `mos_shell_settings` (never autoloaded, administrators only). The storefront holds only a copy,
and a reboot that clears its temp folder loses that copy. The page therefore compares the storefront's saved copy with the option on
each fresh status read and re-sends the option when they differ (at most once per read, and not again within a minute of a failed
push). When it has re-sent, the page says so. "Nota sjálfgefin gildi" removes the option and asks the storefront to drop its copy.
Fallback: a bad answer drops the walk to one page at a time and doubles the pause (from at least 100 ms, up to 30 s); a good
answer halves it back towards the base. A bad answer is any status other than 2xx, 3xx, 404 or 410 (so a 401, 403, 429 or
5xx), a timeout, or a first answer over three seconds. A stale page's refresh is judged by that first answer, and a refresh
that runs past 90 seconds or ends stale is bad too. A `Retry-After` on a bad answer (a 429 or 503 that carries one) sets the
pause before the next page to that delay when it is longer than the backoff, capped at 30 s: the walk waits what the
storefront asked, not the backoff. After 20 good answers in a row with the pause back at the base, the walk returns to its configured workers. Failures are counted across both workers, and five bad answers in a row stop the run, as before. The admin page
shows the workers in use ("2 síður í einu", or "1 síða í einu (hægt á vegna svartíma)" while degraded).
The run is logged: its start, a progress line every 500 pages, and an end line with
the visited, hit, rendered, gone and failed counts, whether it stopped early, and its duration. A stamp file
(`nightly-rebuild.json`, beside the stored pages under `MOS_SHELL_DIR`, which should be a durable folder) keeps the start and
the end of the last run. A process that was down at 05:00 runs the walk when it is up again, if that is within three hours
after 05:00 and today's run has not happened. The timer lives in the Node process, so a process that is not running at 05:00
runs nothing until a request reaches it: keep the app process up (Passenger: a minimum of one instance, and no idle timeout)
or the day's run is missed, which the log says ("the run due today was missed"). A run that started and never ended (the
process stopped during it) is logged at the next start and is not resumed; it runs again at the next 05:00.
The walk is set up only in production (`NODE_ENV` production build); `astro dev` never arms it. A run in progress is never joined by another.
The expected duration is about 4,100 pages, two at a time, at about 1 s per round (render plus pause): about 35 minutes. This is an
unmeasured estimate; the first real run's end line gives the true figure. It is longer when WordPress is slow, and the walk falls back to one
page at a time while it is. Run it at the hour the shop is quietest and watch WordPress's response times for the first night after a change.

**Admin endpoint and the "Síðugeymsla" page.** `GET /api/shell-admin` returns the store's and the nightly rebuild's status as
JSON (`no-store`). `POST /api/shell-admin` takes `{"action": …}`:

- `run`: starts the walk now (202). 409 with `error` `no-base` (no `MOS_SHELL_REBUILD_BASE` nor `MOS_EXTRA_ALLOWED_HOSTS`),
  `store-off`, `running` (never a second run) or `clearing` (a clear is going). Works whether or not the nightly time is set.
- `stop`: asks the walk to stop before its next page (202; the pause after the current page still runs first). 409 `not-running`.
- `refresh` with `"path"`: marks one stored page stale, so the next visit renders it (200). The path must be a storefront
  product or category path (`/vara/nafn/`, `/verslun/flokkur/nafn/`); anything else, a full URL included, is 400.
- `clear`: drops every stored page of this build and answers 200 with `removed` and `failed`. `failed` counts page files that
  could not be removed; above zero, some may still be served, and the page warns. A clear holds the run slot, so a walk
  cannot start meanwhile. 409 `running` while a walk goes, `clearing` while another clear goes, `store-off` when the store
  is off.
- `settings` with `"settings": {…}`: saves the nightly settings (200, with `settings` (the effective values), `source` (`saved` or
  `env/default` per field), `saved` and `persisted`). Any field may be left out (it then falls back to the environment); an unknown
  field, or a value out of range, is 400 with `problems` (one line of Icelandic text each) and nothing changes. `"settings": null`
  drops the saved copy. The body is the same JSON as the other actions.

Without `MOS_SHELL_POKE_KEY` on the storefront every request answers 403, the GET and the POST alike. With it, WordPress sends the
same value as `X-Mos-Shell-Key`. 120 keyed requests a minute per process (429 beyond); a body over 16 KB is refused (413).
Disk counts are taken at most once a minute. The status fields: `store` (`on`, `build` (8 characters), `folder` (`durable` when
`MOS_SHELL_DIR` is set, else `temp`; never the path), `pagesInMemory`, `pagesOnDisk`, `diskBytes`, `diskAt`, `fresh`),
`scheduler` (`armed`, `why` (null when armed; else `store-off`, `off` (saved or environment), `no-base` or `waiting` for a first
request), `at` (null when off), `hasBase`, `nextRunAt`, `lastStart`, `lastEnd`, `unfinishedStart` (the start of a run that never
ended, null when none)), `settings` (`effective`: `enabled`, `at`,
`concurrency`, `pauseMs`, `catchUp`; `source`: per field `saved` or `env/default`; `saved`: the saved copy or null; `estimateMs`:
the estimated duration of a run of every page at the effective concurrency, from the last run's measured time per page, or null),
`run` (`running`, `startedAt`, `total`, `visited`, `hits`, `rendered`, `gone`, `failures`, `pauseMs`, `lastPath`, `stopRequested`,
`workers`, `concurrency`, `clearing` (true while a clear holds the slot)), `lastRun` (the newest of `recentRuns`, or null: `startedAt`, `endedAt`, `durationMs`, `total`, `visited`,
`hits`, `rendered`, `gone`, `failures`, `stoppedEarly`, `stoppedWhy`, `concurrency`, `msPerPage`, `pagesPerMinute`), `recentRuns` (the
last seven runs, newest first, the same fields) and `failures` (the last 20 bad answers, newest first: `path`, `status`, `at`).

The WordPress page "Síðugeymsla" (`wp-mu-plugins/mos-shell-admin.php`, a subpage of Stillingar, for those who may edit pages)
reads that status with a 5 s timeout and sends the four actions through admin-post with nonces. It needs
`MOS_SHELL_POKE_KEY` in `wp-config.php` (the same value as the storefront's) and `MOS_STOREFRONT_URL`. When the key is missing,
the storefront does not answer, or it answers 403, the page explains what to set instead of the cards. The status is kept
for 10 seconds in WordPress, and the page reloads itself every 15 seconds only while a run or a clear is going. Run now and clear need
`manage_options` (administrators); stop and rebuild one page stay with editors.

Cache-Control by response:

| Response | Cache-Control |
|---|---|
| Cart, checkout and thank-you, `/min-sida/`, wishlist, sign-out, `/api/cart*`, `/api/checkout`, `/api/order`, `/api/account/*` | `private, no-store` (whatever the route set) |
| Any response that sets a cookie | `private, no-store` |
| Errors (4xx/5xx), including the outage answer (503 + `Retry-After: 30`) | `no-store` |
| Public HTML pages (200) | `public, max-age=0, s-maxage=300, stale-while-revalidate=60`: browsers revalidate every time, the CDN holds the page for five minutes. `no-cache` while `MOS_MAINTENANCE` is on (the owner's preview must not reach the CDN). |
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
  WooCommerce REST key travels in the `Authorization` header, and `lib/woo` also scrubs it from errors it rethrows.
  An error line `[woo] … 401 with the keys in the Authorization header, 200 with the same keys in the URL` means the web
  server in front of WordPress drops that header: the shop keeps working with the key in the URL (so it is back in
  the WordPress access log) until the header is let through (the app tries the header again every 15 minutes).
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
| `/api/live` and `/api/live/product/<id>/` | 120 requests per minute per visitor (429 with Retry-After). Process-wide: 600 upstream calls per minute across both routes (one call can make up to five WooCommerce requests, for a variable product's variations; 503 with Retry-After 60 and no-store when spent; cards stay neutral, the product page shows its retry state; one warning per minute in the log). |
| `GET /img/<width>/<format>/…` (AVIF or WebP conversion of a media photo) | 60 **cache misses** / min per visitor, a kept file costs nothing. A miss is never waited for: it gets a 302 to the original on the media host (`no-store`) at once, and the conversion runs in the background, at most 2 at once per process with 40 waiting. Past the visitor's 60, or with the queue full, the 302 is still sent and no conversion starts. |
| `POST /api/shell-refresh` (WordPress's "a product was saved" poke) | With `MOS_SHELL_POKE_KEY` set: 600 / min for the whole process, any other caller is refused (403), and a bulk "every product" mark is honoured. Without it (set the key in production): 300 requests a minute per address, counted before the body is read; then 300 **path slots** a minute per address, taken before any store lookup, so junk paths cost only their own address's share. Only a path the store knows (a stored page, or a render waiting for it) also spends the shared pool of 600 a minute for the whole process, forgets its cached product and is marked or dropped; any other path costs nothing shared. A poke cut short by a budget applies the paths it could take and answers 429 with `Retry-After: 60` and `{message, untaken}`, the list of paths it did not apply, so the sender can resend exactly those. A poke that applies nothing is refused whole. An empty poke costs one slot. The bulk mark is refused (WordPress then sends bulk changes in batches of 50, at most 20 per change). A listings mark is honoured once in five minutes, and that window starts only once the mark is applied. Refusals are counted and logged once a minute (`shell poke refused`), never with their paths. A body over 16 KB is refused before it is read. |
| Filtered listings | Not per visitor: cold Store API count requests (`collection-data`) are capped at 240 a minute per process. Past that, listings render without option counts (or with stale ones) instead of asking WordPress; the product grid is unaffected. |
| Stock-filtered listings (`?lager=1`) | Not per visitor: a new read of the stock-filtered grid is capped at 120 a minute per process. Past that the listing answers 503 with `Retry-After: 30` and `no-store`; joining a read already in flight costs nothing. |
| `GET /api/search/suggest` | 120 / min per visitor (429 with Retry-After) |
| `POST /api/newsletter` | 5 / 15 min per visitor; a failure of the upstream service gives the slot back |
| Product page related row (`/_server-islands/RelatedProducts`) | 60 / min per visitor. Over it the row is left out, as when every lookup fails. |
| Edit account, wrong current password | 5 / 15 min **per customer**, not per visitor. Further attempts in the window are refused. |

Accepted limits, shared by design: the 600 upstream calls a minute for `/api/live` are one budget for every visitor, so a few addresses sending many different id sets can use it up, and until the minute ends product cards stay neutral and stock calls answer 503. The image conversion queue (2 running, 40 waiting) is shared the same way, and misses are limited per visitor only, so many addresses can fill it and legitimate requests then get unoptimised originals until it drains.

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

### Maintenance switch

Two run-time settings on the Node app (no rebuild; restart the app after changing them). Code: `src/lib/maintenance.ts`.

| Variable | Effect |
|---|---|
| `MOS_MAINTENANCE=1` | Every page answers 503 (`Retry-After: 600`) with the notice from `/vidhald/`; every `/api/` route answers 503 JSON. `/api/healthz` and static files stay up. |
| `MOS_MAINTENANCE_KEY=<16+ characters>` | Opening any page once with `?forskodun=<key>` sets a cookie (7 days) that lets that browser use the whole shop, checkout included. Without a key nobody gets in. |

To open the shop: remove `MOS_MAINTENANCE` (or set it to `0`) and restart.

### Valitor

Valitor's plugin (Payment Gateway via Valitor for WooCommerce, read at 1.9.41) does not hand back a hosted-checkout
URL. It answers with WooCommerce's own pay-for-order page on the WordPress host
(`/gera-upp/order-pay/<id>/?pay_for_order=true&key=…`), which posts the shopper on to `paymentweb.valitor.is`.

- The storefront follows that page only on WordPress's public origin (`MOS_MEDIA_BASE_URL`) and only at that path
  (`src/lib/checkoutRedirect.ts`). The page is drawn by the WordPress theme, so it must be reachable by a signed-out
  shopper: a WordPress maintenance plugin that covers it stops every card payment.
- Valitor returns the shopper to `/gera-upp/order-received/<id>/?key=…` on the WordPress host. The bridge
  (`headless-bridge.php`, section 3) lets the gateway confirm the payment there and sends the shopper on to the
  storefront's receipt. Valitor's server-side call (`?wc-api=WC_Gateway_Valitor`) confirms it as well.
- The return and callback addresses are built from `WP_HOME` for each payment; nothing is registered at Valitor by
  this code. Whether Valitor's merchant settings restrict them is not known.
- If the gateway's "Success Page URL" setting is filled in, the gateway sends the shopper there instead of the receipt.
- **Not yet proven with a real payment.**

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
   `mos-size-index.php`, `mos-catalog-clean.php`, `mos-nav.php`, `mos-stillingar.php`, `mos-instagram.php`,
   `mos-newsletter.php`, `mos-search.php`, `mos-staff-flag.php`, `mos-shell-poke.php` and `mos-shell-admin.php`. **Never
   `headless-bridge-local.php`** (the local-dev shim rewrites redirects to localhost).
   Check: `wp plugin list --status=must-use` shows exactly those sixteen, and `ls wp-content/mu-plugins` has no
   `-local` file. `mos-shell-poke.php` does nothing until `MOS_STOREFRONT_URL` is defined (step 4), like
   `mos-headless-mode.php`; without it the storefront is not told when a product is saved, and its pages stay stale
   until their lifetime ends. `mos-headless-mode.php` does nothing until `MOS_STOREFRONT_URL` is defined (step 4), so uploading
   it before cutover is safe; the others act at once but only add routes, fields and the wp-admin "Stillingar" page.
   `mos-shell-poke.php` and `mos-shell-admin.php` changed in the latest round (a scheduled product going live pokes, and
   the Síðugeymsla page reports a clear that left files behind): copy them again where a copy is already installed.
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
3d. **Instagram row** (the owner; any time, also after cutover; free). Until it is done the home page ends with a
   "Fylgdu okkur á Instagram" banner instead of the latest posts.
   Meta now offers new apps only "API setup with Unified login", so the key is a **system-user token** of the
   "Músík Og Sport" business portfolio. It never expires and needs no App Review for the store's own account.
   1. @musikogsport is a professional (Business) account in the "Músík Og Sport" portfolio (business.facebook.com →
      Settings → Accounts → Instagram accounts). Its page there shows its **ID** (digits): note it.
   2. The portfolio's app is "Musik og Sport vefur" (developers.facebook.com, app 2353329905428084) with the product
      "Instagram" → "API setup with Unified login".
   3. business.facebook.com → Settings → Users → System users → Add: name `vefur`, role Employee. Then "Assign assets":
      the app "Musik og Sport vefur" (Develop app) and @musikogsport (full control is not needed; content access is
      enough). If Meta also lists the store's Facebook Page, assign it too.
   4. On the system user: "Generate token" → app "Musik og Sport vefur" → expiry **Never** → permissions
      `instagram_basic` (plus `pages_show_list` if it is offered) → Generate, and copy the token. Meta shows it once;
      keep it out of e-mail and chat.
   5. wp-admin → Stillingar → Instagram (administrators only): paste the token and the ID from step 1 → Tengja. Both
      are checked with Meta (the account must be @musikogsport) before they are saved. The token stops working only
      if it is revoked or the system user loses the account; then generate a new one the same way. (Ops may instead
      set both `MOS_INSTAGRAM_TOKEN` and `MOS_INSTAGRAM_ACCOUNT_ID` in `wp-config.php`; that pair wins over the box.)
   Check: `wp mos-instagram status` says "Connected as @musikogsport", and within a few minutes
   `curl -s 'https://<wp-host>/wp-json/mos/v1/instagram' | jq '.posts | length'` is above 0. The pictures are copied
   to `wp-content/uploads/mos-instagram/`, which must be publicly served like the rest of `uploads/` (no deny rule).
4. **`wp-config.php` constants** (at cutover, not before): `MOS_STOREFRONT_URL` = `https://musikogsport.is`,
   `MOS_HEADLESS_REDIRECT_STATUS` = `301`.
   Also `MOS_SHELL_POKE_KEY` = the same value as the storefront's (see [WordPress host](#wordpress-host)): the poke and the
   Síðugeymsla page both need it.
   Check: `wp eval 'echo MOS_STOREFRONT_URL, " ", MOS_HEADLESS_REDIRECT_STATUS;'`, and
   `curl -sI https://<wp-host>/verslun/` answers `301` to `https://musikogsport.is/verslun/`, while
   `curl -sI 'https://<wp-host>/wp-json/'` still answers 200 (REST is never redirected), and
   `wp eval 'echo defined("MOS_SHELL_POKE_KEY") ? "set" : "MISSING";'` prints `set` (the value itself is never printed).
5. **WooCommerce settings.**
   - Guest checkout on (Settings → Accounts & Privacy). Check: `wp option get woocommerce_enable_guest_checkout` is
     `yes`.
   - `woocommerce_price_num_decimals` = `0`. Check: `wp option get woocommerce_price_num_decimals` is `0`.
   - A **Read/Write** REST key for the storefront. Check: WooCommerce → Settings → Advanced → REST API lists it with
     "Read/Write"; `curl -s -o /dev/null -w '%{http_code}' -u 'ck_…:cs_…' 'https://<wp-host>/wp-json/wc/v3/products?per_page=1'`
     is 200 (run it from your machine, never paste the key into logs or tickets).
6. **Public endpoints answer.** Check:
   `curl -s 'https://<wp-host>/wp-json/mos/v1/front-page' | jq 'keys'`,
   `curl -s 'https://<wp-host>/wp-json/mos/v1/menu/location/primary' | jq 'length'`, and
   `curl -s 'https://<wp-host>/wp-json/mos/v1/droppoints?postcode=101&type=postbox' | jq '.ok'` (`true`), and
   `curl -s 'https://<wp-host>/wp-json/mos/v1/instagram' | jq '.handle'` (`"musikogsport"`; `posts` is empty until 3d).
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
