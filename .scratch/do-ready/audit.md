# Full audit, consolidated (ticket 03)

Branch `feat/do-ready`, audited at HEAD e93d8b5 / 3c78755 (read-only), fixes in the working tree after 3c78755.
Area reports (evidence, probes, suggested fixes): [pages-api](audit/pages-api.md) · [lib-catalog](audit/lib-catalog.md) ·
[lib-money](audit/lib-money.md) · [components](audit/components.md) · [mu-plugins](audit/mu-plugins.md).

Batches: **A** = storefront, not money path (fixed here) · **B** = `wp-mu-plugins/` (separate batch) ·
**M** = money path / cart / checkout / order behaviour, awaiting the user's sign-off · **info** = waived or informational.
"Money" is the area reviewer's money-path flag; a money=y finding can still be batch A when the work is tests only or
outside the cart/checkout code (CO-10, LC-14, LM-11).

## Files reviewed

Built mechanically: `git ls-files src scripts public wp-mu-plugins server.mjs astro.config.mjs` (219 files) diffed
against the file names in the five area tables. Every tracked file is named by an area table, either by name or by the
area's shorthand (`X.ts (+test)`, `api/cart/* (7 files)`, `api/account/login, logout, lost-password, …`,
`min-sida/edit-account, edit-address/*`, `tests/* (6 files)`). Not reviewed by any area: the binary assets
`public/favicon.ico`, `favicon.svg`, `logo-footer.webp`, `logo-header.webp`, `placeholder.svg` (images, nothing to audit).
Outside the brief's scope and not reviewed: `.do/app.yaml`, `DEPLOY.md`, `README.md` (ticket 01/02 deliverables), `audit/*.md` (old reports).

| area | files | report |
|---|---|---|
| pages + api | `src/middleware.ts`, `server.mjs`, `astro.config.mjs`, `public/robots.txt`, `src/layouts/Base.astro`, every `src/pages/**` (52 routes incl. 22 `api/*`), `scripts/*.py` (3) | [pages-api.md](audit/pages-api.md) |
| lib catalog + shared | 44 `src/lib` modules (allowedHosts … wpbakery, cache, http, logger, woo, wp …) and their 31 tests, plus `apiLimits.test.ts`, `mediaHost.test.ts` | [lib-catalog.md](audit/lib-catalog.md) |
| lib money | `account.ts`, `accountFormat.ts`, `auth.ts`, `cartCity.ts`, `cartProxy.ts`, `cartStore.ts`, `cartSuggest.ts`, `cartView.ts`, `checkoutRedirect.ts`, `droppointStore.ts`, `orderAmounts.ts`, `shippingBar.ts`, `storeApi.ts`, `wishlist.ts` (+ their 5 tests) | [lib-money.md](audit/lib-money.md) |
| components | all 41 `src/components/*`, `src/styles/global.css` | [components.md](audit/components.md) |
| mu-plugins | the 8 `wp-mu-plugins/*.php`, `seed/` (4), `tests/` (6), `README.md` | [mu-plugins.md](audit/mu-plugins.md) |

Files the area tables call clean: server.mjs, astro.config.mjs, robots.txt, karfa/oskalisti, utskra, vara, verslun
routes, voruflokkur/brand/merkimidar, min-sida index/customer-logout/lost-password, allowedHosts, archiveNav, cachePolicy,
categoryTree, dismiss, facets, gridNav, megaMenu, menuPanels, img, logger, photoBgServer, price, productCard, rateLimit,
responseHeaders, safeUrl, sanitize (config), securityHeaders, serial, storeMap, validate, variations, visitor,
accountFormat, cartCity, cartSuggest, cartView, shippingBar, wishlist, droppointStore, AccountLayout, Breadcrumbs,
CampaignBar, FilterOption, Icon, NotFound, Pagination, PdpGallery, PdpRail, PriceTag, ProductGrid, ProductRow,
RelatedProducts, WpContent.

## Consolidated findings

Status legend: **fixed** (test name) · **skipped** (reason) · **open** (batch B/M, not this batch) · **info** (no action).

| ID | sev | file:line | issue | money | batch | status |
|---|---|---|---|---|---|---|
| PA-01 | Medium | pages/[slug].astro:14 | English Woo pages /cart/ /checkout/ /my-account/ /shop/ served as indexable 200 content | n | A | fixed: 301 to /karfa/ /gera-upp/ /min-sida/ /verslun/. 301 rather than 404 + noindex: while Woo's page settings point at these pages it builds links to them (emails, returns, old bookmarks), a redirect keeps those working and nothing indexable remains at the English URL (paths.test "wooDefaultPageTarget (PA-01)"; probed 301s) |
| PA-03 | Low | pages/api/account/*.ts | no route-level tests for login/logout/lost/reset/details/address/contact | n | A | partly: contact route tested (contactRoute.test); login/logout/lost/reset/details/address route tests skipped (not cheap; money/session area) |
| PA-04 | Medium | lib/account.ts:50,134 | getCustomer/getOwnOrder swallow outages into null (blank forms, false 404) | n | A | fixed: loadCustomer/getOwnOrder tri-state, account pages 503 + notice, no form on outage; checkout prefill keeps getCustomer (null) (account.test "loadCustomer / getCustomer (PA-04)", "getOwnOrder"); page rendering needs a session: unit-tested, not exercised at runtime |
| PA-05 | Low | pages/min-sida/orders/[...page].astro:18 | page past the last answers 503 (Woo 400) | n | A | fixed: Woo 400 -> 'out-of-range' -> redirect to /min-sida/orders/ (also an empty page > 1) (account.test "listOrders (PA-05)"); redirect needs a session: not exercised at runtime |
| PA-06 | Low | pages/gera-upp/order-received/[id].astro:36 | neutral "order received" copy for any id/key | y | M | fixed: only a verified order (id + key) says "móttekin"; a miss answers 404 with neutral copy ("Pöntunin fannst ekki." + the confirmation comes by e-mail); an outage answers 503, Retry-After 30, no-store, role=alert notice. The cart token is still cleared on the first view of an order placed here (orderReceipt.test "receiptKey", "receiptStatus / RECEIPT_NOTICE"; verify_live_routes wrong-key check now expects 404; outage preview 503) |
| PA-07 | Low | pages/500.astro | direct /500/ answers a real 500 (alerts noise) | n | A | fixed: middleware rewrites a direct /500/ to the 404 page (probed /500/ -> 404). The thrown-error path (500.astro unchanged, rendered with the original path) is reasoned from Astro core (default-handler.js, render/page.js forces 500 on /500): unverified at runtime |
| PA-08 | Info | middleware.ts:26 | thrown errors skip finishResponse headers (server.mjs covers prod) | n | info | info |
| PA-09 | Low | sitemap.xml.ts:11, personuvernd.astro:53 | sitemap lacks /um-okkur/ /personuvernd/; privacy page names a wrong cookie | n | A | fixed: sitemap lists /um-okkur/ and /personuvernd/ (sitemap.test); cookie paragraph names wc_cart_token, mos_order, mos_auth, mos_li and the localStorage items (owner to review the legal wording). Skipped: slash-less prerendered pages (server.mjs static handler, low impact) |
| PA-10 | Low | index.astro:3 | `/?s=` (empty) answers 404 | n | A | fixed: empty/blank `/?s=` -> 302 /verslun/ (paths.test "homeSearch (PA-10)"; probed) |
| PA-11 | Info | securityHeaders.mjs:64 | CSP also on JSON/XML; form-action note | n | info | info |
| PA-12 | Info | pages/leita.astro:7 | dead `if (target)` | n | A | kept with a comment: removing the always-true guard makes astro check flag the variable (an unconditional frontmatter return reads as dead code); target moved to tested legacySearchTarget (paths.test) |
| PA-13 | Low | api/cart/*, cartProxy.ts:64 | cart GET primes a token; no sameOrigin on cart POSTs; address keys; error-body log | y | M | partly: the cart GET no longer primes a token (CO-02). sameOrigin on cart POSTs, address keys, error-body log: open (not in the batch M brief) |
| PA-14 | Info | api/checkout.ts:52 | fire-and-forget order link vs graceful shutdown | y | M | open (not in the batch M brief); the batch M recovery links a recovered order the same fire-and-forget way |
| PA-15 | Low | api/contact, droppoints, order, products | console.warn not logger; 404 not 405; contact error copy; passthrough | n | A | partly: contact route logs through lib/logger (contactRoute.test, red on the old code). Skipped: droppoints/order logging (money-path routes), 405 vs 404 (b), contact error copy (c), droppoints passthrough (d), timeout anomaly (e, not reproduced) |
| PA-16 | Low | scripts/*.py | hardcoded :4322, no exit codes, real contact POST each run, retry fallthrough | n | A | fixed: verify_content_pages uses STOREFRONT_URL, exits non-zero, sends no mail unless --send-contact (the incomplete-submit check stays: the route answers 400 before WordPress, contactRoute.test); crawl_links same-origin test uses BASE (now follows absolute same-origin links); verify_live_routes exits 1 when the storefront never answers. No checked behaviour changed |
| LC-01 | Low | lib/http.ts:76 | safeNext lets non-Latin-1/control chars through -> 500 after sign-in | n | A | fixed: printable ASCII without backslash (http.test "falls back for values a Location header cannot carry") |
| LC-02 | Low (latent) | lib/wpbakery.ts:105-114 | nested vc_row_inner drops following content | n | A | fixed: confirmed red, inner rows flow into the outer column (wpbakery.test "keeps everything around a nested vc_row_inner", "keeps vc_column_text inside an inner row") |
| LC-03 | Low | storeCatalog.ts:90-112,184-219; wp.ts; catalogTerms.ts | no failure memo / in-flight de-dupe for storeProducts, counts, getWpPage | n | A | fixed: storeProducts in-flight de-dupe + 10 s per-URL failure memo; collectionCounts 15 s failure memo; getWpPage in-flight de-dupe + 15 s memo (storeCatalogMemo.test, wp.test). Intentional test change: two storeCatalog.test cases that pinned "never caches a failure" now advance past the memo |
| LC-04 | Low | lib/woo.ts:256-283 | sitemap sweep re-runs on every request after a failure | n | A | fixed: a failed sweep with a stale copy waits 60 s before sweeping again (woo.test "listAllProductSlugs") |
| LC-05 | Low | lib/liveFilters.ts:148-164 | no length cap on `s` and filter lists | n | A | fixed: `s` capped at 100 characters, comma lists at 50 (staerd keeps its 60), search page title uses the capped text (liveFilters.test "parseLiveFilters caps (LC-05)") |
| LC-06 | Low | catalog libs (console.warn) | plain-text warn lines bypass the JSON logger | n | A | partly: storeCatalog, catalogTerms, wp, contact use lib/logger (storeCatalog.test F-16 assertion now reads the JSON line: intentional test change). Skipped: cache.ts and photoBg.ts (imported by client islands; the logger would ship to the browser), money-path libs |
| LC-07 | Info | liveFilters.ts:202, archive.ts:110 | explicit product-category replaces the archive scope | n | info | info |
| LC-08 | Info | liveFilters.ts:167-178 | unknown filter slug dropped silently | n | info | info |
| LC-09 | Low | catalogTerms.ts:65-67 | Félag/Lið terms required: a missing attribute degrades the whole catalog | n | A | fixed: a site whose attribute list lacks pa_felag-lid leaves Félag/Lið out (logged); a failing team-terms call still fails the sweep (catalogTerms.test "loadCatalogTerms sweep") |
| LC-10 | Info | catalogTerms.ts:48,92 | 20-page cap silent; tags swept every 10 min | n | A | fixed: the 20-page cap logs a warning (catalogTerms.test "says so in the log…"). Lazy tags skipped (design change) |
| LC-11 | Low | photoBg.ts:447-451 | failed resample overwrites a good reading with null | n | A | fixed: a failed re-sample keeps the last reading (photoBg.test "keeps a known colour… (LC-11)") |
| LC-12 | Info | lib/paths.ts:61-68 | slashRedirect('//evil') returns protocol-relative | n | A | fixed: slashRedirect returns null for `//…` and `/\…` (paths.test "slashRedirect never answers a protocol-relative target") |
| LC-13 | Low | woo.ts:217-219 + api/order.ts | getOrder: outage = wrong key, burns poll miss slots | y | M | fixed: lookupOrder is tri-state (found / not-found / unavailable). Only a real miss (WC 404/400/410 or a key mismatch) uses a poll slot; an outage (transport, 5xx, 401/403, 429, unset keys) refunds the slot and answers 503 + Retry-After 30 (woo.test "lookupOrder" incl. "answers unavailable for an outage… (LC-13)"; apiLimits.test "LC-13: a WordPress outage answers 503 and never uses up a miss slot"; outage preview 25 x 503, no 429; real misses 20 x 404 then 429) |
| LC-14 | Medium | missing tests | sanitize, getOrder key check, loadArchive and more have no unit tests | y (getOrder) | A | fixed (tests only; passed on first run as expected): sanitize.test, woo.test getOrder (key check, outage = miss as today; became the lookupOrder block in batch M, LC-13), archive.test (loadArchive), decode.test (decode, formatISK, scaleMinor, splitBrand), wp.test, siteChrome.test, frontPage.test. Not covered: jsonld, visitor, photoBgServer, cardPriceText |
| LC-15 | Low | homeLayout.ts:53, frontPage.ts:64 | no shape check on front-page JSON: a missing field 500s every page | n | A | fixed: normaliseFrontPage defaults every field (frontPage.test "defaults every missing field…") |
| LC-16 | Low | siteChrome.ts:79 | chrome all-or-nothing: front-page failure drops loaded menus | n | A | fixed: menus kept with the fallback campaign/footer when only the front page failed (siteChrome.test). Note: that partial chrome is cached for up to 60 s |
| LC-17 | Info | text.ts:35, types.ts:235, brand.ts:12,16 | dead/untidy bits (orphan comment, Mizuno twice) | n | A | fixed: duplicate Mizuno and the orphan comment removed. truncateWords kept (documented on purpose); brand prefixes untouched (no evidence) |
| LC-18 | Info | sitemap.xml.ts:57 vs cachePolicy.ts | CDN may freeze a degraded sitemap; hidden products listed | n | info | open (owner decision) |
| LC-19 | Info | rateLimit.ts, caches | per-process limits | n | info | info |
| LC-20 | Info | lib/http.ts:22-25 | sameOrigin ignores Sec-Fetch-Site | n | info | info (touches the checkout guard) |
| LC-21 | Info | lib/decode.ts:26 | `&#0;` decodes to NUL | n | A | fixed: C0 controls and DEL stay as written; also `&#X…;` (uppercase X) now decodes (decode.test) |
| LC-22 | Info | lib/cache.ts:42-50 | no max-stale age | n | info | info |
| LC-23 | Info | img.ts, securityHeaders.mjs, server.mjs, photoBg.ts | media origin derived four ways | n | A | skipped: one media-origin helper changes build-time vs run-time env semantics (server.mjs, img.ts inlined at build): owner decision, ties to CO-13 |
| LC-D1 | dup | cache / woo.runSweep / photoBg / wp | SWR cache written 3 times | n | A | not merged: runSweep throws on a cold failure and waits on a refresh, createCachedLoader serves stale and reports degraded: different contracts. LC-04 fixed in place |
| LC-D2 | dup | 7 fetch-JSON-with-timeout helpers | one upstream helper | n | A | partly: lib/upstream.ts (upstreamGet/upstreamJson) replaces 5 of 7 (catalogTerms, storeCatalog, frontPage, siteChrome, wp), timeouts and messages kept. Excluded: woo.wooGet (key pair, scrubbing, pagination) and photoBgServer (byte stream, redirect:error) |
| LC-D3 | dup | facets.countWord, productCard.colourLabel | Icelandic plural written twice | n | A | fixed: lib/plural.ts isSingular/countWord used by facets, productCard, CartButton and the orders table (plural.test) |
| LC-D4 | dup | 15 x `err instanceof Error ? …` | export logger errText | n | A | partly: the touched call sites pass `{ err }` to the logger instead of hand-formatting; errText not exported (no remaining need in batch A files) |
| LC-D5..D8 | dup | media origin, tree walks, warn throttles, isPosInt | see area file | n | info | info |
| LM-01 | Medium | storeApi.ts:36-53 | checkout timeout after success tells the shopper to retry | y | M | fixed: attempt id + server recovery + browser poll, never a second POST (see "Batch M results / LM-01"). checkoutFlow.test "submitCheckout" LM-01 cases, checkoutRecovery.test, woo.test "findAttemptOrder", mos_checkout_fields_wp_test; e2e lm01.mjs (held checkout -> recovered order -> receipt) and the bacs smoke (real attempt lookup) |
| LM-02 | Low | cartStore.ts:38 vs storeApi.ts:36 | client abort shorter than server backstop | y | M | fixed: lib/timeouts.ts holds every budget: browser cart call 30 s > Store API 25 s, checkout 45 s; after a 502/504 or no answer the next queued cart call waits 5 s (error shown at once); a transport failure never touches the Cart-Token cookie (timeouts.test, cartStore.test "cart calls wait longer than the server (LM-02)", storeApi.test "storeFetch failure mapping"). No automatic resync after a time-out (it would race the WC session); CO-05 and the next call's full cart cover it |
| LM-03 | Low | api/checkout.ts:27-46 | checkout body forwarded without an allow-list | y | M | fixed: lib/checkoutPayload.ts allow-list: address keys (strings, 200 chars), e-mail required, customer_note capped at 1000, payment_data always [], extensions only mos {kennitala digits or null, skiptimidi bool, attempt if 32 hex}, payment_method optional (<=64), postis_dpo_postbox only [A-Za-z0-9]{1,32} (checkoutPayload.test "checkoutPayload (LM-03)", checkoutRecovery.test "LM-03: forwards only the allowed fields…") |
| LM-04 | Low | api/account/logout.ts, cartProxy.ts | logout keeps cart token and order cookie | n | M | fixed: logout also deletes wc_cart_token and mos_order with the attributes they were set with (cartProxy cookieAttrs) (logoutRoute.test "POST /api/account/logout (LM-04)") |
| LM-05 | Low | cartProxy.ts:64-73 | failed prime still sends the mutation | y | M | open (not in the batch M brief) |
| LM-06 | Info | api/cart/* | coupon/customer unlimited; no sameOrigin | y | M | open (not in the batch M brief) |
| LM-07 | Low | orderAmounts.ts, OrderReceived.astro | fee_lines/refunds not shown | y | M | open (not in the batch M brief) |
| LM-08 | Low | order-received/[id].astro | failed card order shows "pending" | y | M | open (not in the batch M brief) |
| LM-09 | Low | auth.ts:55-56,103-124 | forged token-shaped cookies cost a WP call each | n | M | open (not in the batch M brief) (session code; behaviour change needs sign-off) |
| LM-10 | Info | rateLimit / account routes | shared-IP lockout observations | n | info | info |
| LM-11 | Low | auth, account, cartProxy, storeApi | no unit tests for the riskiest money-area logic | y | A (tests only) | fixed (tests only; passed on first run): moneyLib.test (storeApi, cartProxy, auth) and account.test LM-11 blocks (owner check, attach retries, address copy, link retries) |
| LM-12 | Info | validate.ts:18, cartStore.ts:43-49, orderAmounts.ts:30 | qty 0 -> 1; unparseable OK body; dead subtotal | n | M | partly: (b) fixed, a 200 that is not a cart is an error, not a null mirror (cartStore.test "a 200 that is not a cart (LM-12b)"); (a) clampQty(0) and (c) dead subtotal: open (not in the batch M brief) |
| LM-13 | Info | checkoutRedirect.ts | sound; port/userinfo optional | y | M | info |
| LM-14 | Info | droppointStore.ts | locker id kept/unchecked | n | M | partly: a saved locker missing from the postcode's fetched list is cleared and blocks checkout (CO-03). Clearing it after an order and the server-side check (Pósturinn plugin): open (not in the batch M brief) |
| LM-15 | Info | cartProxy.ts:16, auth.ts:174 | Secure cookies on a plain-http preview | n | info | info |
| CO-01 | Medium | CheckoutForm, CartView, CartDrawer, cartStore | failed first cart load shows "Sæki…" forever | y | M | fixed: a failed first load shows the error with "Reyna aftur" (retryCartLoad) on /gera-upp/, /karfa/ and the drawer; the drawer no longer says "Karfan er tóm" for a failed load (cartStore.test "first load failure and retry (CO-01)"; ui.mjs CO-01 x6) |
| CO-02 | Medium | CartButton, CartDrawer, cartStore | GET /api/cart on every page view | y | M | fixed: GET /api/cart without a cart token answers an empty cart locally (no-store): no upstream call, no cookie; the first add still primes a token (cartRoute.test "GET /api/cart (CO-02)"; ui.mjs CO-02 x2; outage preview 200) |
| CO-03 | Low | DroppointSelect.tsx | stale locker id submitted | y | M | fixed: the saved locker is checked against the fetched list (reconcileDroppoint); a stale one is cleared from storage and the select, and Panta is blocked until a listed locker is chosen (droppointStore.test "droppoint verification (CO-03)"; ui.mjs CO-03 x3 + the sent locker id) |
| CO-04 | Low | CheckoutForm.tsx | bfcache restore leaves Panta disabled | y | M | fixed: a bfcache restore (pageshow persisted, lib/pageLifecycle) resets placing/checking so Panta is enabled again. Component: no unit test (no DOM test setup); ui.mjs CO-04 x2 (real bfcache restore in Chromium) |
| CO-05 | Low | cartStore.ts, CartButton | cart mirror never refreshed | y | M | fixed: watchCartFreshness: a bfcache restore always re-reads the cart, tab return at most once per 10 s, only once the cart was loaded on the page (cartStore.test "refresh on return (CO-05)"; ui.mjs CO-05 x2) |
| CO-06 | Low | CartParts.tsx:31,35 | quick double "+" loses an increment | y | M | fixed: stepQty builds on the latest pending quantity (clamped 1-99) and clears it only when the answer is for that target (cartStore.test "quick stepper clicks (CO-06)"; ui.mjs CO-06: three fast "+" send 3,4,5) |
| CO-07 | Low | CheckoutForm, ShippingCalc, DroppointSelect | checkout a11y | y | M | open (not in the batch M brief) (CheckoutForm) |
| CO-08 | Low | ProductPurchase.tsx | add-to-cart error not announced; swatch tab stops | y | M | open (not in the batch M brief) (ProductPurchase); its stale onerror comment was corrected in batch M |
| CO-09 | Low | CartParts, CartDrawer, CouponField | cart a11y | y | M | open (not in the batch M brief) (side cart) |
| CO-10 | Low | CartButton.tsx:36 | "1 vörur" plural | y | A | fixed: "Opna körfu (1 vara)" via plural.countWord (plural.test) |
| CO-11 | Low | WishlistView:64, ContactForm:54, SizeGuide:26 | client fetches without a timeout | n | A | fixed: wishlist 10 s (falls back to the snapshot), contact 15 s (button back with a message), size guide 10 s (opens the page). Component scripts: no unit test (no DOM test setup); build + code |
| CO-13 | Low | HeroSlider, BannerRow, SiteHeader, Base | hero/banner/logo images bypass mediaUrl() | n | A | skipped: mediaUrl only rewrites a localhost/127.0.0.1 host, so in production (WordPress sends its public host) it changes nothing; locally it moved the logo, hero and banners off the local WordPress (where the 2026/10 uploads answer 200) onto a host without them, breaking the home page in local QA. The real production risk (an http or internal WordPress host) belongs with LC-23: owner decision |
| CO-14 | Low | ProductImage.astro:20,34 | inline `onerror` blocked under an enforced CSP | n | A | fixed: public/img-fallback.js (deferred, external; capture-phase error listener + scan of already-broken images), ProductImage uses data-fallback (imgFallback.test; browser check co14.mjs: 27/27 broken photos -> placeholder on /verslun/ and /voruflokkur/skor/, srcset dropped, no inline-handler CSP report). The "one-shot inline onerror" comment in ProductPurchase.tsx was stale; corrected in batch M |
| CO-15 | Info | ArchiveView, Base, global.css | dead wishlist dispatch, dead data-reveal, 11 unused classes | n | A | fixed: ArchiveView mos:wishlist dispatches, the data-reveal observer + CSS, ProductCard comment, and 10 unused classes removed (btn--lg, btn--white, container--narrow, container--wide, form-note, layout-2col, price--sale, price__html, price__was, prose--wide), after checking src (incl. template-built classes), the 4 WP content pages and all 3088 product descriptions/price_html for them. `w3` was a false positive (w3.org in data URIs) |
| CO-16 | Low | WishlistView.tsx | slash-less link, stale fallback URL, toggle+action semantics | n | A | fixed: /verslun/ link; old snapshots link /vara/<slug>/ (301s to the product); remove button lost aria-pressed (heart fill moved to CSS), focus moves to the next card and a status line announces the removal |
| CO-17 | Low | LoginForm, LoginPopup | popup always lands on /min-sida/; eye button semantics; focus | n | A | fixed: popup sends back to the current page (account pages: /min-sida/), focuses the username; the eye keeps its label and toggles aria-pressed (browser check ui.mjs) |
| CO-18 | Low | Base setOpen, SearchOverlay, SideMenu, StoreNotice | no focus trap; "Loka" is a link | n | A | fixed: Tab trapped in the open search overlay and side menu; store notice "Loka" is a button (ui.mjs). Background inert not added (aria-modal already) |
| CO-19 | Info | SiteFooter.astro | footer columns collapse after load | n | A | skipped: collapsing footer columns before paint needs a CSS/no-JS design choice (info) |
| CO-20 | Low | components (no tests) | no component tests | y | M | open (not in the batch M brief) (CheckoutForm logic moved into tested lib/checkoutFlow, lib/checkoutPayload; the component itself still has no test) |
| CO-21 | Info | CheckoutForm.tsx:248 | bacs on a zero-total order | y | M | fixed, a different defect than described: the Store API lists every gateway whatever needs_payment says (CartSchema), so a free order was posted as the default `straumur` and stamped as a card order (bacs only when it was the sole gateway). The form now sends no payment_method when the cart needs no payment; the server allows that, and WooCommerce's own missing-method refusal is shown as "Veldu greiðslumáta." (checkoutFlow.test "sends no payment method for an order that needs no payment (CO-21…)", checkoutPayload.test, checkoutRecovery.test "CO-21: …"). Not run with a real zero-total order (needs a free product or 100% coupon: product data) |
| CO-22 | Info | CheckoutForm.tsx:216-223 | verified ok | y | info | info |
| CO-23 | Info | ShippingBarView.tsx | no own guard on html/color | y | M | open (not in the batch M brief) (side cart) |
| CO-25 | Info | ArchiveView.astro:643-721 | load-more not in history; no de-dupe | n | A | partly: load-more skips a card already shown (by product link). History for load-more skipped (design change) |
| CO-26 | Info | NavItem, SideMenu, SiteFooter | `_blank` without rel=noopener | n | A | fixed: lib/safeUrl linkRel: rel=noopener for _blank/external menu links in NavItem, SideMenu, SiteFooter (safeUrl.test "linkRel (CO-26)") |
| CO-27 | Info | OrderReceived.astro:14,17 | invalid date throws | y | M | open (not in the batch M brief) |
| MU-01 | Medium | headless-bridge-local.php | local shim has no runtime guard; header claimed prod no-op | y | B | fixed: returns before any hook or the MOS_DEV_ASTRO_URL constant unless wp_get_environment_type() is 'local'; header corrected; DEPLOY says WP_ENVIRONMENT_TYPE must not be local (headless_bridge_local_test: production/staging/development/'' register nothing; local keeps all five hooks; local site still reports 'local' and still rewrites returns to :10026) |
| MU-02 | Medium | mos-headless-api.php (new section 5) | users enumerable (/wp/v2/users slugs = logins); jwt token unthrottled | n | B | fixed: /wp/v2/users and /users/<id> removed via rest_endpoints for non-edit_posts callers (404, case variants and ?rest_route too), ?author= and /author/<slug>/ 404 via the request filter, oEmbed author fields and feed dc:creator (display name = login) stripped. users/me kept (customer users/me?context=edit 200), admin list 200. jwt-auth/v1/token: documented, no in-code limit (a WP per-IP cap is one bucket shared by every shopper); DEPLOY WordPress host + step 8 extended, step 8 checks /wp/v2/users is 404 |
| MU-03 | Low | mos-checkout-fields.php | stale order meta on retry | y | M | fixed: a kennitala the shopper cleared or a gift receipt unticked is removed from a reused order; a field the request does not send (raw JSON body) is left alone; validation unchanged (mos_checkout_fields_wp_test, 22 PASS). Also stores the LM-01 attempt id and adds the `mos_attempt` REST orders filter (v1.1.0) |
| MU-04 | Low | mos-headless-api.php mos_contact_reply_to | Reply-To name can add recipients | n | B | fixed: name stripped of RFC 5322 specials (dots kept), quotes, CR/LF/controls; empty or invalid UTF-8 -> address only (unit tests; WP test: one Reply-To reaches the mailer, aborted in phpmailer_init; locally wp_mail is the Disable Emails mock) |
| MU-05 | Low | mos-headless-api.php contact caps; mos-account-api.php | store-wide buckets exhaustible by a direct caller | n | B | partly: contact now 5/15 min per IP+sender, 30/h per IP, 60/h store-wide (a single-address caller can no longer lock the form; the store-wide cap still bounds admin mail). The storefront forwards no visitor IP and a forwarded header would be spoofable, so WP keys on REMOTE_ADDR; account routes were already per IP. Not atomic (get/set transients). WAF rule documented as the real protection |
| MU-06 | Low | mos-account-api.php:63-78 | lost-password timing; reset key rotation | y | B | skipped: changes mail-send / reset-key behaviour on the account-recovery path (money flag); not cheap |
| MU-07 | Low | mos_storefront_href + src/lib/safeUrl.ts | `/\evil.example` passes as relative | n | B | fixed both sides: a leading backslash, or "/" then a backslash (after control/space stripping) -> '#'; `//host` stays external; PHP same-host URLs whose path starts `//` or `/\` (`https://<wp>//evil.example`) collapse to one `/`. PHP unit tests, safeUrl.test MU-07 cases; all 179 real menu and Forsíða links still resolve (none became '#') |
| MU-08 | Low | headless-bridge.php:44-53 | straumurStatus bounce reflects $_GET | n | M | fixed: the bounce carries only a known straumurStatus (canceled/failed/error) and a numeric order_id (mos_straumur_bounce_target); the local shim builds its bounce with the same function (headless_bridge_wp_test MU-08 checks; HTTP probe: extra params no longer reflected). The storefront reads only straumurStatus from the bounce (gera-upp/index.astro:12), so nothing it uses is dropped |
| MU-09 | Info | headless-bridge.php + Straumur | nonce failure -> wp_die 500 | y | M | fixed: inside the Straumur return handler only (the existing mos_in_straumur_return flag), wp_die() redirects to /gera-upp/?straumurStatus=error (the careful checkout notice) instead of a raw 500; falls back to the default handler if headers were sent. The gateway has already refused the return before touching the order, so nothing about the payment changes Scope checked in the Straumur plugin: in process_return (class-wc-straumur-payment-gateway.php:472-545, hooked on woocommerce_api_straumur at :79) the only wp_die is the nonce check at :480, before the order is read; every other branch redirects and exits. Straumur's server-to-server webhook is a REST route (class-wc-straumur-webhook-handler.php:71, 81-89, straumur/v1/payment-callback) where the flag is never set, so no acknowledgement path changes. A PHP fatal inside a return would now also land on the notice (whose copy says a payment, if made, is confirmed by e-mail) instead of WordPress's 500 page (headless_bridge_wp_test MU-09 checks, in memory; not HTTP-probed: it would run the Straumur plugin's return code) |
| MU-10 | Low | mos-headless-api.php contact route | no args: array fields warn | n | B | fixed: typed `args` (string); array field -> 400 rest_invalid_param before the callback (WP test) |
| MU-12 | Low | README.md | accuracy | n | B | fixed: page/<slug> route, mos_and_cat, contact caps, user-enumeration guards, Straumur limitation note, local-shim guard, uninstall/leftovers, test list |
| MU-13 | Info | mos-headless-api.php page route | `modified` without timezone | n | B | fixed: get_post_modified_time('c', true) -> `2023-01-04T23:25:45+00:00` (WP test) |
| MU-14 | Info | mos-posturinn-droppoints.php | per-postcode caching of the global parcelpoint list | n | info | skipped: refactor of the checkout's locker lookup, bounded today |
| MU-15 | Info | mos-size-index.php | extra-count queries; Woo filter-data cache cap | n | info | accepted (performance only) |
| MU-16 | Low | mos-headless-api.php mos_and_cat | ids uncapped; global never reset | n | B | fixed: mos_and_cat_ids() de-duplicates and caps at 20; reset at rest_request_after_callbacks 1000 (after the size-index count fields at 10). Unit + WP test (500 ids -> 20 reach the query; global [] afterwards); and_cat / extra_counts / size Python tests still pass |
| MU-17 | Low | wp-mu-plugins/tests | coverage | y | B | fixed (tests only): mos_headless_api_test (48), headless_bridge_local_test (10), mos_headless_api_wp_test (24), mos_account_jwt_wp_test (38: denylist key, verified claims, fingerprint, rehash alias, the Bearer check, sign-in fingerprint, wp_set_password alias writes intercepted), headless_bridge_wp_test (25: return URL, outcome matcher, wp_redirect rewrite; no behaviour change); ABSPATH guard on mos_size_guard_wp_test. Python tests' hardcoded term ids: documented, not changed |
| MU-18 | Info | seed/*.php | no environment guard | n | B | fixed: refuse on 'production' unless MOS_SEED_FORCE=1 (edited and linted, not run) |
| MU-19 | Info | mos-headless-mode.php | Host-header loop guard | n | info | none needed |
| MU-20 | Info | mos-headless-api.php page/menu routes | any published page/menu public | n | info | none needed (public data) |
| MU-21 | Info | mos-account-api.php | transient denylist + JWT class dependency | y | B | documented: DEPLOY (object-cache eviction re-validates signed-out tokens; class check after a jwt plugin update) |

## End-to-end path notes (summary)

- **Browse -> filter -> product.** Archive routes resolve terms through `createCachedLoader` caches (10 min, 15/60 s
  failure memo); `parseLiveFilters` -> `toStoreFilter` -> `storeProducts` (grid, uncached) + `collectionCounts` (30 s
  URL cache, in-flight de-dupe, 240 cold/min budget). Degraded terms with a filter answer 503 + Retry-After, unknown
  archives 404, legacy URLs 301. PDP via REST v3 with `status=publish`; descriptions through `sanitizeHtml`. Gaps:
  LC-03, LC-05, LC-07/08, LC-14.
- **Cart -> checkout -> Straumur -> order-received (read-only).** Token cookie primed in `ensureToken`, rotated per
  response; checkout sameOrigin + 10/min limiter, `mos_order` cookie httpOnly 2 h; redirect target allow-list sound
  (LM-13). Straumur return goes through the bridge's `wp_redirect` filter; the order-received page takes the key from
  the query or the cookie and polls `/api/order` (8 tries). Gaps: LM-01..08, CO-01..06, LC-13, PA-06, MU-03, MU-09.
- **Sign-in / out / lost / reset / account edits / order view.** sameOrigin everywhere, generic failures, limiter
  take-before/refund-after, safeNext on redirects, JWT revoked on logout and on password change. Gaps: LC-01, PA-03,
  PA-04, LM-04, LM-09, MU-02, MU-06.
- **Contact, wishlist, search, sitemap.** Contact validation and 303s probed; wishlist via `/api/products` (limited);
  search through the `/?s=` rewrite (PA-10); sitemap ~3150 locs (PA-09, LC-04, LC-18).
- **Redirects and 404/500.** Trailing-slash 301 never yields an open redirect (`//evil.com/x` -> `/evil.com/x/`, LC-12);
  WP-side headless redirect has no open redirect (MU-19). Gaps: PA-01, PA-07.
- **Outage behaviour.** With WordPress down every catalog URL answered 503 `no-store` with the outage page, the
  server stayed up; each failed upstream call logged (LC-03/LC-06).

## Batch A results (2026-10-26, working tree on 3c78755, not committed)

TDD: each fix had its test written first and seen red, except the tests-only items (LC-14, LM-11 and the LM-11
blocks of account.test), which pin current behaviour and passed on the first run, as expected. The contact-route
test was written after the logging change and confirmed red against the HEAD version of contact.ts.

### Gates

| gate | result |
|---|---|
| `npx vitest run --exclude '.claude/**'` | 52 files, 562 tests pass (baseline 39 / 457) |
| `npx astro check` | 0 errors, 0 warnings, 1 hint (the old auth.ts hint) |
| `npm run build` | complete. The `Astro.request.headers` warnings on prerendered um-okkur/personuvernd are pre-existing (same in a HEAD build) |
| `verify_live_routes.py` (preview :4323) | 32 PASS, 0 FAIL, unchanged script checks |
| `crawl_links.py` | OK (181 homepage links, 60 sitemap samples, 3154 locs, JSON-LD parses) |
| `verify_content_pages.py` | OK, no contact mail sent (complete submit skipped by default) |
| filter probes bf03-probe / bf03-extra / bf03-sort / bf04-probe | 167 / 12 / 1 / 18 PASS, 0 FAIL |
| CO-14 browser check (`/tmp/do-ready-co14/co14.mjs`, SSR pages) | 11 PASS: every broken product photo shows the placeholder, srcset dropped, no inline-event-handler CSP report (the 8 remaining reports are the known inline `<script>` blocks) |
| UI check (`/tmp/do-ready-co14/ui.mjs`) | 5 PASS: popup redirect + focus, Tab trap in search and side menu, notice button |
| route probes | /cart/ /checkout/ /my-account/ /shop/ 301 to the Icelandic routes; /500/ 404; `/?s=` 302 /verslun/ |

### Intentional changes to existing tests and scripts

- storeCatalog.test: the two "never caches a failure" cases now advance the clock past the new 15 s failure memo (LC-03);
  the F-16 log assertion reads the JSON logger line instead of console.error (LC-06).
- scripts: crawl_links now follows absolute same-origin links (it skipped them unless the base was :4322);
  verify_content_pages sends no contact mail unless `--send-contact`; verify_live_routes exits 1 if the storefront
  never answers. No route check changed.

### Not verified at runtime

PA-04 page rendering and the PA-05 redirect need a signed-in session (unit-tested in lib); PA-07's thrown-error path
(reasoned from Astro's error handler: errors render 500.astro with the original path, which is not /500/).

### Left for batch M (money path) and batch B

All of LM-01..LM-10, LM-12..LM-15, LC-13, CO-01..CO-09, CO-20..CO-23, CO-27, PA-06, PA-13, PA-14 and every MU-*
finding are untouched (MU-* were then handled in batch B, below). Note for batch M: ProductPurchase.tsx's comment "ProductImage's inline onerror is one-shot" is
now stale (its own `main.onerror` re-arm still works alongside /img-fallback.js).

## Batch B results (2026-10-26, wp-mu-plugins, working tree on 0b7bca6, not committed)

Per-ID status is in the table above (MU-01..MU-21). TDD: each code fix had its test written first and seen red
(headless_bridge_local_test, the href/Reply-To/and_cat/user-route cases of mos_headless_api_test, safeUrl MU-07);
the JWT and bridge WP tests pin current behaviour (tests only) and passed first time. The users-route fix was seen
open before (curl `/wp-json/wp/v2/users` listed `larus_c8rnd913`, `msportadmin`; oEmbed named the author).

Installed copies: `headless-bridge-local.php` and `mos-headless-api.php` copied to `app/public/wp-content/mu-plugins/`;
`cmp` of all 8 repo plugins against the installed dir: identical. `php -l` clean on every changed PHP file.

### Gates

| gate | result |
|---|---|
| `php tests/mos_size_normalise_test.php` / `mos_size_helpers_test.php` | 121 / 39 passed |
| `php tests/mos_headless_api_test.php` / `headless_bridge_local_test.php` (new) | 48 / 10 passed |
| `wpms eval-file` mos_size_guard / mos_headless_api_wp (new) / mos_account_jwt_wp (new) / headless_bridge_wp (new) | 10 / 24 / 38 / 25 PASS, 0 FAIL |
| Python store_api_size / extra_counts / and_cat | 19 / 19 / 4 PASS, exit 0 |
| curl probes (WP :10025) | `/wp/v2/users`, `/wp/v2/USERS`, `/wp/v2/users/`, `?rest_route=/wp/v2/users`, `/wp/v2/users/4` -> 404; `/wp/v2/users/me` -> 401 (route kept); no login in `/wp-json/`, `pages?_embed`, oEmbed, product feed (dc:creator now the shop name); `/?author=2` -> 302 to the storefront `/?author=2` (no slug; before: Yoast's 301 home, which depends on a Yoast setting) |
| local shim still active | `wp_get_environment_type()` = local; `/?straumurStatus=failed` -> `localhost:10026/gera-upp/?straumurStatus=failed`; return URL host :10026 |
| `npx vitest run --exclude '.claude/**'` | 52 files, 564 tests pass (562 + 2 MU-07) |
| `npx astro check` | 0 errors, 0 warnings, 1 hint (unchanged) |
| `npm run build` | complete |
| `verify_live_routes.py` (preview :4323) | 32 PASS, 0 FAIL |
| `crawl_links.py` | OK |
| sign-in | failed sign-in through the preview (made-up user) -> 303 `/min-sida/?login=failed` (WP token 403). A successful sign-in needs a real password: skipped; the identity call it makes (`users/me?context=edit` as a customer) is 200 in mos_headless_api_wp_test |

No WP/Woo data written (REST GETs, a POST rejected before its callback, in-memory current user and fake user,
pre_transient / user-meta filters, the mail aborted in phpmailer_init), no orders, no Straumur, no mail.

Behaviour changes to know about: the store-wide contact cap went from 30/h to 60/h (plus 30/h per address), so a
lockout now needs two addresses and the admin-mail ceiling doubled; a menu/ACF link starting with a backslash is now
`#` on both sides; `/mos/v1/page/<slug>` `modified` now ends in `+00:00` (nothing in `src/` reads it); `?author=` now
forwards to the storefront instead of Yoast's 301 to home; feed items name the shop as author. The Bearer ->
`users/me` path was verified with an in-memory customer via `rest_do_request`, not over HTTP with a real token.

## Batch M results (2026-10-27, money path, working tree on 1e668cb, not committed)

Approved boundary: no change to prices, totals, shipping cost computation or the Straumur payment itself. Nothing in
this batch sends an amount, changes a rate, or calls Straumur. Per-ID status is in the table above: fixed LM-01, LM-02,
LM-03, LM-04, LC-13, PA-06, CO-01..CO-06, CO-21, MU-03, MU-08, MU-09, plus LM-12b (overlap with CO-01) and part of
LM-14/PA-13 (overlap with CO-03/CO-02); ProductPurchase.tsx's stale onerror comment corrected. Nothing in the brief
was skipped. Not in the brief, left open: LM-05..LM-09, LM-12a/c, CO-07/08/09, CO-20, CO-23, CO-27, PA-13 (rest),
PA-14. TDD: each fix's test was written first and run red before the code (for the new modules and the new mu-plugin functions the red was "module/function not found"); CO-04 (component) is checked in the browser only.

### LM-01: how a lost checkout answer is recovered (never a second order)

WooCommerce 11.2.1 Store API (`plugins/woocommerce/src/StoreApi`):

- `Routes/V1/Checkout.php` process_order (:544): `create_or_update_draft_order` (:594, body :790) reuses the session's
  order, a draft or a pending/failed one with an unchanged cart hash (`Utilities/DraftOrderTrait.php`
  is_valid_draft_order :53-70). Then `update_order_from_request` (:597) fires
  `woocommerce_store_api_checkout_update_order_from_request` (`Utilities/CheckoutTrait.php` :254), and
  `update_status('pending')` (:675) saves the order before `process_payment` (`Utilities/CheckoutTrait.php` :88-96).
  A completed bank-transfer order empties the cart, so a retry stops at `validate_cart_not_empty` (:561).
- `GET /checkout` (get_route_response :217) is not a read-only probe (it rewrites a session order from the cart) and
  shows nothing for an on-hold order; the session's `order_awaiting_payment` (CheckoutTrait :92) has no reader.

So the order is tagged. The browser makes a 128-bit attempt id per click (`lib/attemptId.ts`; the server makes one if
none arrives) and sends it in `extensions.mos.attempt`. `mos-checkout-fields.php` stores it as `_mos_checkout_attempt`
in the update-order hook, so it is saved with the pending order before any gateway runs. Lookup is read-only:
`GET /wc/v3/orders?mos_attempt=<id>` (the plugin's `woocommerce_rest_orders_prepare_object_query` filter adds an exact
meta query) via `woo.findAttemptOrder`, which also checks the returned meta_data carries the id.

- Server (`/api/checkout`): on a transport failure (25 s time-out, dropped connection) or a proxy's 502/503/504 page
  (no WooCommerce error code) it looks the attempt up at once (`lib/checkoutRecovery.ts`): on-hold/processing/completed
  -> 200 `placed` + the `mos_order` receipt cookie (+ account link if signed in); pending/failed card order -> 409
  "saved, nothing was paid, Panta again reuses the order"; otherwise (draft, not found, WordPress down) -> 504
  `unconfirmed` with the careful message. The Cart-Token cookie is never touched on a lost answer.
- Browser (`lib/checkoutFlow.ts` submitCheckout): after any lost or unconfirmed answer it says it is checking and polls
  `POST /api/checkout/status` (6 x 4 s, 30/min limiter, same answer shape), then goes to the receipt, shows the
  awaiting-payment message, or "Ekki tókst að staðfesta hvort pöntunin fór í gegn … Athugaðu tölvupóstinn þinn áður en
  þú pantar aftur." It never re-POSTs /api/checkout by itself.

### Gates

| gate | result |
|---|---|
| `npx vitest run --exclude '.claude/**'` | 62 files, 640 tests pass (baseline 52 / 564; +10 files, +76 tests) |
| `npx astro check` | 0 errors, 0 warnings, 1 hint (the old one) |
| `npm run build` | complete (dist newer than every source file) |
| `php -l` / `cmp` installed mu-plugins | clean / all 8 identical (mos-checkout-fields, headless-bridge, headless-bridge-local changed and installed) |
| PHP unit: size_normalise / size_helpers / headless_api / bridge_local | 121 / 39 / 48 / 10 passed |
| `wpms eval-file`: size_guard / headless_api_wp / account_jwt_wp / headless_bridge_wp / checkout_fields_wp (new) | 10 / 24 / 38 / 37 (batch B: 25; +12 MU-08/MU-09 checks) / 22 PASS, 0 FAIL |
| Python store_api and_cat / extra_counts / size | 4 / 19 / 19 PASS, exit 0 |
| `verify_live_routes.py` (preview :4323) | 32 PASS, 0 FAIL (wrong-key receipt check now expects 404, below) |
| `crawl_links.py` | OK |
| Playwright `ui.mjs` (route-intercepted fake cart, bacs only, /api/checkout faked: no order) | 23 PASS: CO-01 x6, CO-02 x2, CO-03 x3, CO-21/LM-03 body, CO-04 x2, CO-05 x2, CO-06, LM-01 (a) found by the poll, same attempt id, one POST; (b) unknown after 6 polls; (c) awaiting payment |
| Playwright `lm01.mjs` (real server :4324 with a fetch preload: the Store API checkout is held and never forwarded, only the attempt lookup is faked) | 4 PASS: after the server's 25 s abort it answered 200 placed #999999, the browser went to the receipt with the httpOnly cookie, and the receipt (no such order in WP) showed the neutral not-found copy, not "móttekin" |
| outage preview (all WP fetches fail) | CO-02 200 empty cart, no cookie; PA-06 503 + Retry-After 30 + no-store + alert; LC-13 25 x 503, no 429; LM-01 504 unconfirmed, no Set-Cookie, log `[checkout] no answer from WooCommerce (network); recovery: unconfirmed/unavailable` |
| real WP | wrong-key receipt 404 neutral; 20 real misses 404 then 429; MU-08 bounce no longer reflects extra params |

### The bacs smoke (one order, deleted)

- Before (`smoke-state.php`): stock 5, total_sales 3, newest order 264920, gateways bacs + straumur.
- Guest, HOKA 257264 x1 through `/api/cart`, rate `local_pickup:14` (Sótt í verslun), Bankamillifærsla selected and
  checked in the DOM; the `/api/checkout` POST was intercepted and let through only as bacs with
  `smoke-test@example.invalid` (one POST, nothing blocked). Order **265116**: on-hold, bacs, 12495 kr., kennitala
  `0000000000` and skiptimidi `1` saved, note saved, `_mos_checkout_attempt` saved. The receipt answered 200 with
  "Takk fyrir. Pöntunin þín hefur verið móttekin.", Pöntunarnúmer and the bank-transfer copy.
  `/api/checkout/status` with the order's attempt id answered `placed #265116` (the real meta + REST filter path); an
  unknown id answered `unconfirmed`. The only order created in that hour was 265116.
- After (`smoke-cleanup.php 265116 5 3 delete`): deleted=yes stock=5 total_sales=3; `smoke-state.php` again: stock 5,
  total_sales 3, newest order 264920 (baseline restored).
- Harness notes: a first run stopped before submitting (a controlled radio can't be `check()`ed; no POST was sent),
  leaving a guest cart session with the item (holds no stock; WC sessions expire in 48 h). The submitting run's
  waitForURL expected no `?key=` on the receipt URL; the receipt and the attempt lookup were then checked read-only in
  a fresh browser before the cleanup.

### Intentional changes to existing tests and scripts

- woo.test: the `getOrder` block ("outage = null, LC-13 open") became the `lookupOrder` block (outage = unavailable).
- apiLimits.test: mocks `lookupOrder`; new LC-13 case.
- moneyLib.test: a transport failure now also carries `transportFailure: 'network'`.
- verify_live_routes.py: the wrong-key order-received check expects 404 and no "Pöntunarnúmer"/"móttekin" (was 200
  with the neutral "móttekin" copy, which PA-06 removes).

### Deploy notes and residual risk

- Order: the storefront is safe before the mu-plugin (WooCommerce drops the unknown `attempt` key; recovery then finds
  nothing and says "unconfirmed, check your e-mail"), but deploy `mos-checkout-fields.php` 1.1.0 first or together.
- An aborted request does not stop PHP: WooCommerce may finish the order after the storefront's 25 s; that is what the
  recovery poll (24 s) is for. An order finished later than that is reported "unconfirmed" with the e-mail advice.
- The recovery cookie path writes `mos_order` exactly as a normal checkout; PA-14's fire-and-forget account link
  applies to recovered orders too.
- During an early outage-preview attempt (an env override that did not apply, because `astro:env` public server vars
  are inlined at build) one probe POST `/api/checkout` with a made-up cart token reached the real local WooCommerce
  and was refused 401 `woocommerce_rest_missing_nonce` before any processing; no order was created (checked). The
  outage runs then used a fetch-patching `--import` preload instead.
