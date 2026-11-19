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
- **mos-staff-flag.php** — tells the storefront's admin bar that the browser is signed in to wp-admin as
  staff: a non-secret `mos_staff=1` cookie on the host the shop and WordPress share, for accounts that may
  edit products, removed on sign-out. Without it the bar shows only after the storefront's own login.
  Tests: `php tests/mos_staff_flag_test.php` (the cookie-domain rule).
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
- **mos-search.php** — the product search behind the storefront's `/?s=` page and the live results in its search
  sheet. It swaps the search clause of the Store API's `search` (and WordPress's `s`) for its own: every word has to
  match, in the title, the SKU or a term name (category, brand, tag, attribute); words match by their stem
  (peysa / peysur), a misspelt word becomes the nearest word the shop has (addidas → adidas), and when no product
  has all the words those with any are shown. The index lives in the transient `mos_search_index_v1` (twelve
  hours; dropped when a product or a term is saved). Tests: `tests/mos_search_test.php` (pure) and
  `tests/mos_search_wp_test.php` (against the site's catalogue).
- **mos-account-api.php** — `POST /wp-json/mos/v1/account/lost-password` and `…/reset-password`
  for the headless `/min-sida/` area (generic responses). Per-visitor limits live in the storefront,
  because WordPress only sees the storefront server's address; the WP-side limit (60 per 15 min) is a
  store-wide safety net. The reset email is WooCommerce's own. `POST …/account/from-order {order_id, order_key}` is the
  checkout's "Stofna aðgang" box: it makes an account on a fresh guest order's e-mail, puts the order on it and
  mails a link to choose a password (an e-mail that already has an account is left alone, same answer). Sign-in itself uses the
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
    Run it again after uploading a copy whose normaliser changed (2026-11: "22/23" is the pair 22/23, no longer
    the typo "22 2/3"), so existing products are re-read.
  - **No WP-CLI on the host (Plesk):** `php bin/mos-cli.php mos-size reindex` (Scheduled Tasks → "Run a PHP script"
    → Run Now; `--dry-run` writes nothing). `bin/mos-cli.php` runs every `mos-*` command this way, with the commands'
    own code, and logs to `<home>/mos-cli-logs/`; `bin/mos-size-reindex.php` is the older single-purpose runner.
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
  - Category tidy-up (`mos_clean_category_ops()`, same preview/apply/restore): merges, category → attribute term
    (clubs → `pa_felag-lid`, the Íþrótt tree → `pa_ithrott`), category → brand, reparent, rename, delete empty (never
    the default category). A product the op would leave with no category besides Kyn/sale gets the op's fallback.
    The journal records deleted categories' parents and reparents, so restore rebuilds the tree. Storefront 301s for
    removed URLs: `MOVED_CATEGORIES` in `src/lib/paths.ts` (keep in step).
  - Tests: `php tests/mos_clean_rules_test.php` (the pure rules) and `python3 tests/store_api_colour_test.py`
    (after an apply: colour counts match the filtered listings).
- **mos-nav.php** — builds the main menu from the catalog: `wp mos-nav preview` prints it with product counts,
  `wp mos-nav apply` writes it as "Aðalvalmynd 2026" in the primary location (the previous menu is kept for
  rollback). Konur/Karlar/Börn get the same columns (Fatnaður, Skór, Íþróttir, Félagslið, Vörumerki, Úrval); links
  are picked by product count (at most 8 per column, none under 5 products) and listed alphabetically (Icelandic
  order); sports and clubs link to the filters (`?ithrott=`, `?team=`). The clubs in `MOS_NAV_PINNED_TEAMS`
  (Félag/Lið slugs) are always listed under Íþróttir › Félagslið, whatever their product count (unless they have
  none). National teams (`MOS_NAV_NATIONAL_TEAMS`) are not clubs: under Íþróttir they have their own column,
  Landslið. The teams in `MOS_NAV_FEATURED_CLUBS` and `MOS_NAV_FEATURED_NATIONAL_TEAMS` lead their columns, in the
  order of those lists (the featured clubs are also always listed under Íþróttir › Félagslið); the rest of a column
  stays alphabetical. An ordinary
  menu afterwards (editable in wp-admin; a later apply rebuilds it). The "Endursmíða valmynd" button in the
  "Valmynd" box on the Stillingar page (administrators) does what `apply` does, so the owner needs no WP-CLI. A
  rebuild replaces the whole menu, hand edits included: the build it replaces is kept as "Aðalvalmynd 2026 (afrit)"
  (one backup; switch back in Útlit → Valmyndir, and a rebuild after that keeps the menu they switched to).
  Tests: `php tests/mos_nav_rules_test.php` (the pure builder), `php tests/mos_nav_write_test.php` (the writer,
  the backup, the button and the box against in-memory menus) and, on a local site,
  `wp eval-file tests/mos_nav_wp_test.php` (the same against real menus; it rebuilds the menu and puts it back).
- **mos-newsletter.php** — `POST mos/v1/newsletter {email}`: the storefront footer's mailing-list sign-up
  (`/api/newsletter` → here → Mailchimp). It needs the Mailchimp for WooCommerce plugin connected: it reads that
  plugin's API key, audience and double opt-in setting (`mailchimp_get_api_key()`, `mailchimp_get_list_id()`,
  `mailchimp_list_has_double_optin()`) and makes one PUT on the audience member itself; without the plugin it answers
  503 and the footer says the sign-up failed. New address: pending (confirmation mail) with double opt-in, else
  subscribed; already on the list: untouched; left the list earlier: pending again. Same answer in all three cases.
  Capped per address, per caller and store-wide per hour; failures are logged as `[mos-newsletter]` with Mailchimp's
  status, never the key or the address. Tests: `php tests/mos_newsletter_test.php`.
- **mos-stillingar.php** — "Stillingar", the first item of the wp-admin sidebar (for anyone who can edit the front
  page): the front page's pictures on one screen — header logo, the eight banners, each hero slide's
  product and picture — laid out as a small copy of the storefront's front page, computed from the saved values with
  the storefront's rules (`src/lib/homeLayout.ts`: the first banner with a picture on top, or the slides when none
  has one; the other banners paired between the product rows), in sections (Haus, Forsíðumynd, Borðar; the
  unused slides folded under "Varaforsíða", empty banners last) beside a panel that counts unsaved changes and holds
  the save button. Saving the front page's fields (here or on the Forsíða screen) pokes the storefront
  (`mos_front_page_poke()` in `mos-headless-api.php` → `POST /api/content-refresh`), so the pictures show at once
  instead of after the storefront's one-minute cache. The footer logo field is not on the page: the
  storefront's footer draws its own small copy from the media library (`src/lib/site.ts`), beside the recognitions. It shows the existing ACF "Forsíða" fields of `mos-headless-api.php` for the front page (`acf_form()`), so
  it stores nothing of its own; texts, product rows and footer stay on the Forsíða edit screen. Needs ACF and a front
  page (otherwise it says so); when the slides are on top it warns about one the storefront would leave out
  (unpublished product or no picture). If `homeLayout.ts` changes, change `mos_stillingar_layout()` with it. Changes
  reach the storefront within a few minutes (the front-page caches). Test: `wp eval-file tests/mos_stillingar_wp_test.php`.
  Below the pictures it runs `do_action('mos_stillingar_after')` for other settings boxes (each checks its own rights).
- **mos-instagram.php** — the home page's "Músík og Sport á Instagram" row: `GET /wp-json/mos/v1/instagram` (public)
  answers `{handle, profile_href, posts: [{id, href, caption, image: {url, width, height, alt}}]}`, the latest 12
  posts of @musikogsport (`Cache-Control: public, max-age=60`, as the other public reads). The GET itself never waits
  on Instagram: when the feed is an hour old (15 minutes after a failure) it queues a refresh for `shutdown`, after the
  answer is sent (`fastcgi_finish_request`), one at a time (an atomic `mos_instagram_lock` option, expiring after 5
  minutes). The refresh reads the Instagram Graph API (`graph.facebook.com/v26.0/<instagram-account-id>/media`) and
  mirrors each picture — only from Instagram's CDNs (`*.cdninstagram.com`, `*.fbcdn.net`), at most 15 MB — into
  `uploads/mos-instagram/<id>.jpg` (a centred square, ≤ 640 px, re-encoded by the image editor; Instagram's own picture
  URLs expire), deleting the ones that left the feed. The browser never calls Instagram. On any failure (an error, an
  answer without a post list, no picture copied) the last good feed and its pictures stay; with no token, or nothing
  fetched yet, `posts` is empty and the storefront shows a "Fylgdu okkur" banner. Connecting fetches at once, so the
  row is there before the storefront asks. A Meta system-user access token (it never expires) and the Instagram
  account ID (digits) are pasted in an "Instagram" box on the Stillingar page (administrators only: `manage_options` +
  nonce; checked with `GET /<account-id>?fields=username` before they are saved, and refused when the account is not
  @musikogsport), stored in the `mos_instagram_token` option (`token`, `account_id`, `username`; not autoloaded), and
  the token is never sent anywhere but Meta (not in the REST answer, the page or the logs). A `MOS_INSTAGRAM_TOKEN` +
  `MOS_INSTAGRAM_ACCOUNT_ID` pair in `wp-config.php` wins over the option. WP-CLI: `wp mos-instagram status`,
  `wp mos-instagram refresh` (fails loudly when the refresh did). Logs as `[mos-instagram] …`: problems, plus
  connect/disconnect (with the user id) and each refresh's post count. Tests: `php tests/mos_instagram_rules_test.php`
  (normaliser, excerpt, account ID and token shape, redaction, payload) and `wp eval-file
  tests/mos_instagram_wp_test.php` (Meta stubbed: mirror, fallbacks, prune, the token form).

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
  images (spec: `seed/live-clone-spec.json`; an image entry without a local copy as `file` is downloaded from its
  `image_url`, https and the live store's own hosts only: `seed/seed-image-source.php`, test
  `php tests/mos_seed_image_source_test.php`).
- `wp eval-file seed/seed-live-menu.php seed/live-menu.json <topbar_id> <footer_id>` builds the
  "Aðalvalmynd" menu from live's mega-menu tree and assigns the locations. On the May-3 data pass
  `158 158`: menu 158 holds the five links live's footer shows (839 is a stale four-item copy).

Deploy: copy `mos-posturinn-droppoints.php`, `headless-bridge.php`, `mos-headless-api.php`,
`mos-headless-mode.php`, `mos-account-api.php`, `mos-checkout-fields.php`, `mos-size-index.php`,
`mos-catalog-clean.php`, `mos-nav.php`, `mos-stillingar.php`, `mos-instagram.php` and `mos-newsletter.php` to `wp-content/mu-plugins/` on the WP host (never the `-local` shim), then run
`wp mos-size reindex` once, and `wp db export` → `wp mos-clean preview` → `wp mos-clean apply` (keep the journal) → `wp mos-nav apply`. Requires ACF (free) for the Forsíða fields. In `wp-config.php` define
`MOS_STOREFRONT_URL` (the storefront's origin) and `MOS_HEADLESS_REDIRECT_STATUS` (`301`): without
`MOS_STOREFRONT_URL` headless mode does nothing, and card-payment returns, which WooCommerce builds on
`WP_HOME` (the WordPress host), never reach the storefront.

Uninstall / leftovers: apart from the size index (above), removing these files leaves `mos_contact` posts
(Fyrirspurnir: the visitor's name, e-mail and message, kept until deleted by hand; WordPress's personal-data
export/erase tools don't find them), the `mos_rl_*`, `mos_jwt_rv_*` and `mos_menu_*` transients (they expire),
the `mos_jwt_rehash` user meta, the `mos_seed_live_clone` option (small), and Instagram's `mos_instagram_token`
/ `mos_instagram_feed` / `mos_instagram_lock` options, the `mos_instagram_fresh` transient and `uploads/mos-instagram/`
("Aftengja" on the Stillingar page removes all of them first). The `seed/` scripts refuse to run on a
`production` environment unless `MOS_SEED_FORCE=1` is set.
