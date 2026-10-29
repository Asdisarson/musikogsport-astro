# WordPress mu-plugins (backend dependency of this storefront)

These files are **not loaded from here** — they are the version-tracked source of
WordPress must-use plugins this headless storefront depends on. The live copy must
live at `app/public/wp-content/mu-plugins/` (outside this repo).

- **mos-posturinn-droppoints.php** — public read-only REST endpoint
  `GET /wp-json/mos/v1/droppoints?postcode=&type=postbox|parcelpoint` that lists
  Pósturinn parcel lockers / post offices for a postcode (via the plugin's
  `POSTIS_API`). The storefront's `/api/posturinn/droppoints` proxy + the cart/checkout
  parcel-locker selector require it. If WP runs without it, the locker list is empty.
- **headless-bridge.php** — payment/return glue: keeps WC's order-received return URL on
  live's `/gera-upp/order-received/<id>/` (the key is dropped from Straumur returns, which could otherwise
  name any order; the thank-you page reads it from its checkout cookie) and routes every Straumur
  failure/cancel return to `/gera-upp/?straumurStatus=failed` (wp_redirect filter scoped to the
  `wc-api=straumur` request — without it a declined card strands the shopper on a raw WP
  order-pay page). Known limitation, documented in the file and deliberately not patched: the Straumur plugin
  saves the return URL's `checkoutReference` on the order without checking that the session belongs to it.
- **mos-checkout-fields.php** — live's extra checkout fields for the headless checkout: Kennitala and
  "Viltu skiptimiða?" arrive as Store API `extensions.mos` and are saved as `_billing_ssn` / `skiptimidi`
  (the keys live's Checkout Field Editor uses). A kennitala that isn't 10 digits is rejected (400).
- **headless-bridge-local.php** — Local-dev-only shim: rewrites redirect hosts to
  the astro dev server (`http://localhost:10026`, Local's headless add-on port)
  and pins HTTPS for WC REST Basic Auth over HTTP. It does nothing unless `wp_get_environment_type()` is
  `local` (`WP_ENVIRONMENT_TYPE` in `wp-config.php`; Local sets it), but still: do NOT deploy it to production.
- **mos-headless-api.php** — the storefront's public API:
  - `GET /wp-json/mos/v1/menu/location/<primary|topbar|footer>` and `GET …/menu/<id>`:
    nested menu trees with storefront-relative paths. It registers those three menu locations,
    so editors assign menus under Appearance → Menus.
  - `GET /wp-json/mos/v1/front-page`: the homepage and site chrome, from the ACF
    "Forsíða" fields on the static front page (campaign bar, hero product slides, two product
    rows, eight banners, footer) plus `shipping_bar`: Goya's free-shipping progress bar settings,
    read from the `theme_mods_goya-child` option (goal, messages, colour, mini-cart/cart locations).
  - `GET /wp-json/mos/v1/page/<slug>`: the raw content of a published, non-password page (the storefront parses
    the WPBakery shortcodes itself; `src/lib/wp.ts`). `modified` is ISO 8601 with its offset.
  - Store API `mos_and_cat=<ids>` on `wc/store/v1/products` and `…/collection-data`: a second, independent
    `product_cat` clause (OR within its ids, AND with every other filter), for live's `?kyn=` filter. At most 20 ids;
    it ends with the request.
  - `POST /wp-json/mos/v1/contact`: the contact form (live's "Contact Me"), stored as a private
    `mos_contact` post and emailed to the site admin. At most 5 per IP and sender per 15 minutes, 30 per IP per
    clock hour and 60 per clock hour store-wide; the storefront limits each visitor first (WordPress sees only the
    storefront's address, so its visitors share the per-IP cap). The mail's Reply-To is the sender's address,
    with a name cleaned of commas, quotes and brackets.
  - No public user enumeration (user slugs are login names): `/wp/v2/users` and `/wp/v2/users/<id>` are
    removed for anyone who can't edit posts (404), `?author=<id>` and `/author/<slug>/` are 404 for them,
    oEmbed answers carry no author, and feed items name the shop as the author. `/wp/v2/users/me` (the
    storefront's identity check) and the block editor's author picker keep working.
  - Menu and ACF links leave WordPress only as http(s), mailto, tel or relative URLs (any other scheme
    becomes `#`); the storefront filters them again (`src/lib/safeUrl.ts`).
  - It also makes product permalinks follow the Yoast primary category (priority 20, after free
    Yoast's legacy-ordering filter), matching live's `/verslun/<cat path>/<slug>/` URLs.
- **mos-headless-mode.php** — redirects WP front-end page requests to the storefront at the same
  path (`MOS_STOREFRONT_URL`, else `MOS_DEV_ASTRO_URL`; 302 unless
  `MOS_HEADLESS_REDIRECT_STATUS`). It runs at template_redirect priority 5: after the bridge's
  straumurStatus routing (0–1), before WooCommerce's own redirects (10), so query strings survive. wp-admin, REST, wc-api, wp-login, cron, feeds, previews,
  uploads and WooCommerce's order-pay page (emailed "pay for this order" links) are not redirected. It
  does nothing when neither constant is defined.
- **mos-account-api.php** — `POST /wp-json/mos/v1/account/lost-password` and `…/reset-password`
  for the headless `/min-sida/` area (generic responses). Per-visitor limits live in the storefront,
  because WordPress only sees the storefront server's address; the WP-side limit (60 per 15 min) is a
  store-wide safety net. The reset email is WooCommerce's own. Sign-in itself uses the
  jwt-authentication-for-wp-rest-api plugin (`jwt-auth/v1/token`); the token lives only in the
  storefront's httpOnly `mos_auth` cookie. `POST …/account/logout` (Bearer) puts that token on a denylist
  until it expires, and tokens carry a keyed fingerprint of the stored password hash, so a password
  change or reset (even to the same password), a direct database reset or a rotated auth salt refuses
  every older token; WordPress's login-time rehash carries sessions over (one-step alias). After a direct
  database reset on a host with a persistent object cache, flush the user's cache entry. Checked in `determine_current_user` after the plugin, reading the token
  exactly as the plugin does (fail closed). Consumer-key REST calls are unaffected.

- **mos-size-index.php** — a derived, read-only size index for the size filter: a hidden taxonomy `mos_size`
  (no UI, not public, not in REST) built from the local "Stærðir"-style attributes (every misspelling: stærðir,
  STærðir, Stæðir, Stærð) and the global `pa_staerdir`/`pa_skostaerdir`, with the spellings normalised
  ("38 2/3" = "382/3", "38,5" = "38.5"; the rules are documented in the file). A product gets a size only while
  that size is available (a published variation with it is in stock or on backorder; simple products: the
  product is). Product data is never written: only the taxonomy's terms and relationships.
  - Store API: `mos_size=<slug,slug>` on `wc/store/v1/products` and `…/products/collection-data` (OR within the
    sizes, AND with every other filter, incl. `mos_and_cat`); `mos_size_counts=1` on collection-data adds
    `mos_size_counts: [{slug, label, group, sort, count}]` (group `shoe|letter|kids|other`), counted for the
    current filters without the size filter itself, sorted by group then size; selected sizes stay listed.
    `mos_extra_counts=1` adds `mos_extra_counts: {price: [n…], on_sale: n|null}`: products per
    `mos_price_ranges=min:max,…` range (inclusive, minor units, either side open; it replaces the request's own
    price filter) and, with `mos_sale_count=1`, on sale — within every other filter, as one collection-data
    request each would count them. The storefront's price presets and Útsala use it (one request instead of five)
    and fall back to one request each when the field is missing (plugin not deployed).
  - Woo internals it calls on the request path (FilterDataProvider, ProductQueryFilters) are checked first and
    wrapped: a failure is logged (`mos-size-index: … failed: …`) and the response goes out without the field.
  - `GET /wp-json/mos/v1/sizes`: `{sizes: [{slug, label, group, sort, count}]}`, every size with products (10 min cache).
  - Sync: product/variation saves and stock-status changes (incl. order stock reduction) recompute that product,
    200 at a time: before the response of a REST product write (`wc/v3/products…`, variations, batch), otherwise
    at the very end of shutdown, after the response is sent (`fastcgi_finish_request`).
  - WP-CLI: `wp mos-size reindex [--batch=200] [--dry-run] [--unmapped=40]` (backfill; prints per-group counts
    and unmapped raw values) and `wp mos-size purge`.
  - **Production (the owner's step):** upload it to `wp-content/mu-plugins/`, then run `wp mos-size reindex`
    (a few seconds; rerunnable). Until the reindex runs, size filters match nothing.
  - **Uninstall:** `wp mos-size purge` *while the file is still installed* (deletes the terms and their
    relationships), then delete the file. Nothing else to clean up.
  - Tests: `php tests/mos_size_normalise_test.php` (normaliser), `php tests/mos_size_helpers_test.php` (guards,
    sync routes and chunks, price-range parser), `python3 tests/store_api_size_test.py` and
    `python3 tests/store_api_extra_counts_test.py` (Store API, against the local site after a reindex), and
    `wp eval-file tests/mos_size_guard_wp_test.php` (a failing Woo internal leaves the response intact).

- **mos-catalog-clean.php** — catalog data hygiene and gap-filling for the filters. Unlike the size index it
  WRITES product data, always into WooCommerce's own fields (so every value can be corrected in wp-admin):
  - Term hygiene (a rule table at the top of the file): merges duplicate/typo terms (Keflavik → Keflavík,
    Totttenham → Tottenham, …), tidies names, moves sports filed under Félag/Lið to Íþrótt, deletes empty colour terms.
    A product whose attribute is used for variations is skipped and listed (merging it would break the variations).
  - Gap filling, only where a product has no value: brand (`product_brand`) from `pa_vorumerki` or the start of the
    name (missing brand terms are created); gender (the Karlar/Konur/Börn categories under "Kyn") from
    `pa_kyn`/`pa_aldur` or name words (adult Unisex = Karlar + Konur); sport (`pa_ithrott`) from the categories, then
    name words; colour (`pa_litur`) from the first colour the name names (none for "nokkrir litir"). A value is set
    only when exactly one rule matches; conflicts are listed and left empty. Inferred attributes are hidden on the
    product page and never used for variations. Writes go through `WC_Product::save()` so the attribute lookup
    table the Store API filters on stays in step.
  - New and edited products: the same gap-filling runs at the end of the request (fills empty fields only; a value
    set by hand is never replaced). Each product remembers which fields the plugin filled (`_mos_clean_filled`), and
    those are never filled again: clearing a wrong inferred value in wp-admin sticks. These save-time fills are not
    in any journal. The hook runs only for catalog editors (wp-admin, REST, WP-CLI), never for a checkout's stock
    save or any other visitor request.
  - WP-CLI: `wp mos-clean preview` (writes nothing; lists every change, conflicts and coverage), `wp mos-clean apply`
    (one run is enough; writes `uploads/mos-clean/journal-<time>-<random>.json`, folder denied to the web by `.htaccess`), `wp mos-clean restore <journal>` (undoes that
    run: puts back the products' categories, brands and attributes, re-creates deleted terms, reverts renames, removes
    created terms; restore several journals newest first; fills made later by the save hook are not undone). Local run 2026-10-29, published products: brand 86.4 → 93.1%,
    gender 62.6 → 93.2%, sport 8.7 → 37.0%, colour 1.5 → 39.4%.
  - Tests: `php tests/mos_clean_rules_test.php` (the pure rules) and `python3 tests/store_api_colour_test.py`
    (after an apply: colour counts match the filtered listings).

Other tests (all read-only; the `wp eval-file` ones run against the local site's installed copies, so copy first):
- `php tests/mos_headless_api_test.php`: link guard, Reply-To header, `mos_and_cat` parser, user-enumeration helpers.
- `php tests/headless_bridge_local_test.php`: the local shim adds no hook outside a `local` environment.
- `wp eval-file tests/mos_headless_api_wp_test.php`: users routes for the public, a customer and an admin,
  `users/me`, author queries, oEmbed and feed authors, contact args, page `modified`, `mos_and_cat` cap and reset,
  Reply-To as the mailer sees it (aborted before sending).
- `wp eval-file tests/mos_account_jwt_wp_test.php`: sign-out denylist, password fingerprint, login-rehash alias,
  the Bearer check (with an in-memory user that doesn't exist in the database).
- `wp eval-file tests/headless_bridge_wp_test.php`: return URL, outcome matcher, the Straumur-return redirect rewrite.
- The three Python Store API tests use this database's term ids (653, 654, …), so they pass only on this local clone.

`seed/` holds one-off WP-CLI scripts (not mu-plugins) that make a fresh install match live:
- `wp eval-file seed/seed-live-clone.php <spec.json>` fills the Forsíða fields and imports the
  images (spec: `seed/live-clone-spec.json` plus local copies of the images as `file`).
- `wp eval-file seed/seed-live-menu.php seed/live-menu.json <topbar_id> <footer_id>` builds the
  "Aðalvalmynd" menu from live's mega-menu tree and assigns the locations. On the May-3 data pass
  `158 158`: menu 158 holds the five links live's footer shows (839 is a stale four-item copy).

Deploy: copy `mos-posturinn-droppoints.php`, `headless-bridge.php`, `mos-headless-api.php`,
`mos-headless-mode.php`, `mos-account-api.php`, `mos-checkout-fields.php`, `mos-size-index.php` and
`mos-catalog-clean.php` to `wp-content/mu-plugins/` on the WP host (never the `-local` shim), then run
`wp mos-size reindex` once, and `wp db export` → `wp mos-clean preview` → `wp mos-clean apply` (keep the journal). Requires ACF (free) for the Forsíða fields. In `wp-config.php` define
`MOS_STOREFRONT_URL` (the storefront's origin) and `MOS_HEADLESS_REDIRECT_STATUS` (`301`): without
`MOS_STOREFRONT_URL` headless mode does nothing, and card-payment returns, which WooCommerce builds on
`WP_HOME` (the WordPress host), never reach the storefront.

Uninstall / leftovers: apart from the size index (above), removing these files leaves `mos_contact` posts
(Fyrirspurnir: the visitor's name, e-mail and message, kept until deleted by hand; WordPress's personal-data
export/erase tools don't find them), the `mos_rl_*`, `mos_jwt_rv_*` and `mos_menu_*` transients (they expire),
the `mos_jwt_rehash` user meta and the `mos_seed_live_clone` option (small). The `seed/` scripts refuse to run on a
`production` environment unless `MOS_SEED_FORCE=1` is set.
