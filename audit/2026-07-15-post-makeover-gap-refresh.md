# Post-makeover gap refresh — musikogsport storefront (app-astro) — 2026-07-15

**Question answered: "is there anything missing?"** — audited the **uncommitted visual makeover**
(working tree on `main @ 92fa734` + untracked files) for (1) coverage gaps / dropped logic and
(2) a refresh of the "still missing" backlog from the three prior audits + `STOREFRONT-GAPS.md`.

**Method:** 6-lens multi-agent workflow (52 agents, ~2.6M tokens): orphaned-CSS coverage ·
logic-to-preserve verification (June-16 §E) · full 1,803-line diff read · gap-status refresh ·
headless-bridge review · live probe of `127.0.0.1:10026`. Every non-info finding adversarially
verified — **46 confirmed, 0 refuted**. Straumur key is LIVE → static/GET-only, no payment call
executed. Static gates: `astro build` exit 0, `astro check` 0 errors / 0 warnings / 0 hints (76 files).

---

## TL;DR

**The makeover itself is clean.** All 16 logic-to-preserve items from the June-16 map survived
(wishlist `data-*` layer, price states, sanitize/decode boundaries, checkout gates, JSON-LD/noindex,
facet semantics, prerender flags — verified in source *and* live). Zero orphaned CSS classes of
consequence; fonts fully migrated (no hanken/schibsted residue anywhere, new files 200 live).

Four things deserve attention:

1. 🟠 **Straumur card payment is now ENABLED at checkout** (`payment_methods: ['bacs','straumur']`,
   gateway `enabled: true`) — a status change from June-16's "inert until card launches." The
   remaining B-series items (B2/B4/B5) are now **live-relevant**, and the LIVE key is armed in dev:
   exercising checkout here can open a real payment session.
2. 🟠 **Header nav cap orphans two categories** — `stjarnan` (26 products) and `sumar` (21) now have
   zero internal navigation entry points (see R1).
3. ✅ **B1 — the June audit's top card blocker — is CLOSED** by the new `headless-bridge.php`
   (deployed, byte-identical): declined/cancelled card returns now route to `/utskra/villa`.
4. ⚠️ **Everything since 2026-06-13 is uncommitted** — the makeover, the B1 fix, the 500 page —
   with no test/lint/CI net under it. Committing is the single cheapest risk reduction available.

---

## R. Makeover regressions (confirmed, all verified against diff + live site)

- **R7 🔴 Wishlist and Recently-viewed images rendered invisible — the audit's own miss.**
  The rewritten `global.css:688-690` sets `.product-card__media img { opacity: 0 }` and restores
  visibility only for `img.is-on` (`:693`), a contract `ProductCard.astro:35` satisfies
  (`class={i === 0 ? 'pc-img is-on' : 'pc-img'}`). But `WishlistView.tsx:120` and
  `RecentlyViewed.tsx:77` render their own **class-less** `<img>` inside the same container, so
  every image on `/oskalisti` and in the recently-viewed rail on every PDP was permanently
  invisible — and `.product-card__media`'s background went `var(--surface)` → `transparent`, so
  they were blank, not even grey. **FIXED** — both components now emit `pc-img is-on`, plus a
  `img:only-of-type { opacity: 1 }` safety net so a lone image can never be hidden by a missing
  class again.
  **Why the 6-lens audit missed it:** the CSS-coverage lens checked one direction only — classes
  *used* in markup but not *defined* in CSS. This is the opposite direction: a **new CSS rule
  changing the default state of untouched components' markup**. Neither `astro check` nor any
  static gate can see a markup↔CSS contract. Worth adding to the next audit's lens list.

- **R1 🟡 Header nav capped at 6 orphans `stjarnan` + `sumar`** — `SiteHeader.astro:11`
  `.slice(0, 6)` (pre-makeover: unsliced). Live API: 8 nav-eligible top categories, all `count>0`,
  ordered by count desc → slice drops stjarnan/sumar (47 products, pages still 200 but unreachable).
  The in-code comment "full list lives in /verslun + footer" was wrong on both counts: the footer
  was already capped at 6 at HEAD, and /verslun renders no full category list.
  **FIXED** — the footer "Verslun" column is now uncapped (`SiteFooter.astro:7-13`), so the header
  keeps its deliberate single-row cap while every category stays reachable; the header comment was
  corrected to match.
- **R2 🟡 ShippingEstimator removed from the cart drawer** — `CartDrawer.tsx` diff removes import +
  `.drawer__ship` block; estimator remains only on `/karfa` (CartView.tsx:84). The rewritten
  global.css **still defines `.drawer__ship` (:1035)** — suggests the drop wasn't fully deliberate.
  **Component left as authored** (removing an estimator from the drawer is a plausible declutter)
  — *your call whether to restore it*. The dead `.drawer__ship` rule was **deleted**: keeping dead
  CSS on the chance a product decision goes the other way is not a decision worth deferring, and
  git history restores it in one command if you do bring the estimator back.
- **R3 — ❌ FALSE POSITIVE (retracted 2026-09-16).** The lens claimed the topbar free-shipping
  claim lost its "á höfuðborgarsvæðinu" qualifier. It did not: `SiteHeader.astro:26` reads
  "Frí sending á höfuðborgarsvæðinu yfir 15.000 kr." — the line only **moved** (left list → right
  list, gaining `topbar__item--hide`). All four placements carry the qualifier. This one survived
  its own adversarial verification and was caught only on a direct source re-read — a reminder that
  a CONFIRMED verdict is not proof. *What actually changed in that hunk:* the two trust badges
  (free shipping + "30 daga skilaréttur") were replaced by nav links (Um okkur / Hafa samband /
  Stærðartafla) and free shipping moved right. The 30-day promise is still advertised on the
  homepage (`index.astro:204`), the PDP (`vara/[slug].astro:209`) and in Skilmálar — **no loss.**
- **R4 ⚪ Theme toggle hidden on ≤430px phones** — the small-viewport squeeze used to hide the text
  wordmark; now it hides `.theme-toggle` (~global.css:1224). **Deliberate, not a slip:** the brand
  is now an `<img>` logo (no `.brand__text` to hide) and the rule carries an explicit comment about
  keeping the cart control on-screen. Left as authored — decide whether small-phone users should
  keep a theme control.
- **R5 ⚪ Breadcrumbs dropped from hafa-samband** in its 96-line restyle. **Reads as deliberate:**
  the page now opens with a full-bleed `.contact-band` map strip, where a breadcrumb row would sit
  awkwardly above it. `Breadcrumbs.astro` emits no JSON-LD, so there is **no structured-data cost**.
  Left as authored. *(An earlier draft of this note also argued the sibling pages "open with a
  `.container`" — that reasoning was wrong: `Breadcrumbs.astro:12` is `<nav class="breadcrumbs
  container">`, i.e. it containers itself. The full-bleed argument is the one that holds.)*
- **R6 ⚪ `.eyebrow--plain` referenced on 3 pages, no longer defined** — inert (its
  ::before-suppressing purpose vanished with the new `.eyebrow`). **FIXED** — dead class removed
  from index/villa/takk.
- **Nits:** product-card gallery arrows are `<button>` nested inside the card `<a>` (invalid HTML,
  behaviour verified safe) · `logo-musikogsport.jpg` is WebP bytes served as `image/jpeg` ·
  404/500 numeral requests `font-weight:700` from single-weight Fjalla One (synthetic bold) ·
  9 dead selectors in the rewritten global.css · no `.screen-reader-text` rule though sanitized Woo
  `price_html` can carry it (pre-existing, latent).

### Also surfaced by the /ship code-review pass (not fixed — your call)

- **R8 🟡 Global `h1..h4 { text-transform: uppercase }`** (`global.css:182`) exempts
  `.product-card__title` but not `.pdp__title` (`:944`), so a product name is natural-case in the
  grid and ALL CAPS on its own page. It also uppercases `.prose h2/h3` (`:956-957`), i.e. the
  WP-authored legal headings on /skilmalar, /personuvernd and /staerdir. The exemption shows the
  choice was considered, so this is left as a **typographic decision for you**, not a bug.
- **R9 🟡 Card gallery defeats lazy-loading** (`ProductCard.astro:30`) — up to 3 images per card
  are absolutely positioned in the same box, so `loading="lazy"` defers nothing: all three fetch
  together and the two never-displayed siblings compete with the LCP image. On /verslun that is
  roughly 24 → 72 image requests. Fixing it properly means deferring the hover/nav siblings until
  first interaction — a behaviour change to the makeover's gallery feature, so not done here.
- **R10 ⚪ `DNO` classification now disagrees across the stack** — `droppointStore.ts:46` was
  narrowed to `DPO` only (correct: DNO is commented out upstream), but the new
  `headless-bridge.php:125` still classifies `DNO` as a postbox service. Harmless while DNO stays
  disabled; if it is ever re-enabled the rate would be offered with no locker picker. Align the two.

## ✅ Newly closed since the June docs (all in the UNCOMMITTED tree)

- **B1 (was the top card-go-live blocker)** — `wp-mu-plugins/headless-bridge.php:57-81` adds a
  `wp_redirect` filter scoped to `$_GET['wc-api']==='straumur'` rewriting every non-success
  `process_return()` exit (gateway :495/:505/:523/:548-550) to
  `/utskra/villa?straumurStatus=failed&order_id&order_key`. Verified against WP core filter
  ordering (`wp_safe_redirect` → `wp_redirect` filter, pluggable.php:1628→1496); deployed copies
  byte-identical; villa renders live. **Static verification only** (LIVE key untouched).
  *Re-verified 2026-09-16:* the filter keys off `$_GET['wc-api']`, which would miss the
  `/wc-api/straumur/` permalink form — but the gateway never emits that form. Both return-URL
  builders (`class-wc-straumur-payment-gateway.php:261-267` and `:368-374`) use
  `add_query_arg(['wc-api' => $this->id, 'order_id' => …, 'straumur_nonce' => …], home_url('/'))`,
  i.e. always the query-string form, and never `WC()->api_request_url()`. The filter fires.
- **C7** — custom `500.astro` exists and renders.
- **A1 sub-item** — dead `DNO` branch removed from `rateNeedsPostbox` (droppointStore.ts:41-47,
  with a correct "DPT must not reuse this flow" comment).
- **C6** — privacy-policy newsletter claim corrected to describe the real back-in-stock waitlist.
- Homepage address fixed Faxafen 14 → Dalshraun 10 (now consistent with JSON-LD/footer/contact).
- `STOREFRONT-GAPS.md` "search facets" entry is stale — facets shipped in June.

## 🟠 Straumur go-live items — now LIVE-relevant (gateway is enabled)

- **B4 (bumped low→medium):** `STRAUMUR_HOSTS = ['straumur.is']` (CheckoutForm.tsx:47) still
  asserted from the API base, never proven against the real hosted-checkout page host. Wrong host
  ⇒ **every** card redirect bounces to villa. Verify on the first controlled TEST/live transaction.
- **B2:** dashboard `abandon_url` / `custom_success_url` still hand-set, zero code validation.
  The new bridge covers the *failure* leg regardless of config, but the shopper-initiated
  **cancel/abandon leg does not pass through wc-api** and still depends on the dashboard field.
  (WC REST shows both empty, but the same view shows `api_key` empty despite a LIVE key being
  configured — REST reads a different option group, so current values are unverifiable statically.)
- **B3 (worse failure mode):** a set `custom_success_url` bypasses the bridge; a non-`/utskra/`
  value would now render the **failure** page after a **successful** charge. Runbook: keep it empty.
- **B5:** failed/cancelled card still empties the server cart; villa offers no restore.
- **Residual B1 crack:** cancel vs failure distinction lost on the wc-api leg; a nonce-failure
  still dies on a raw WP page.
- **Runbook precondition:** the bridge emits `home_url()`-based targets — prod WP `home` must point
  at the storefront origin or takk/villa 404 on the WP origin. Unverifiable from Local
  (`home == siteurl == :10025`; the dev shim compensates).
- **Dev gap:** `headless-bridge-local.php` doesn't host-rewrite the new failure redirect (hooks
  `woocommerce_get_return_url` + `template_redirect` but not `wp_redirect`) → a simulated failure
  return lands on the WP origin locally. Add a priority-11 `wp_redirect` rewrite to the shim before
  any TEST-key E2E. The shim would break prod if deployed — README now forbids it (it is correctly
  present only in Local's mu-plugins).

## 🔴 SECURITY — `order_key` disclosure oracle in the new bridge (found + fixed 2026-09-16)

The /ship security review found a **HIGH severity flaw in the B1 fix itself** — the same
`headless-bridge.php` filter this document praised two sections below. Fixed; recorded here because
the earlier "B1 CLOSED" verdict was correct about the routing and blind to this.

**The flaw.** The `wp_redirect` filter gated on `$_GET['wc-api'] === 'straumur'`. But `wp_redirect`
fires on *every* redirect in *every* request, and `$_GET` is attacker-controlled — so any
unauthenticated request that merely carried `?wc-api=straumur` and produced a redirect ran the
filter body, **never passing the gateway's `straumur_nonce` check**. The body then did
`wc_get_order(absint($_GET['order_id']))` and wrote `$order->get_order_key()` into the `Location`
header. Verified against WP core in this install: `wp_safe_redirect()` calls `wp_validate_redirect()`
*first* and `wp_redirect()` — which applies the filter (`pluggable.php:1496`) — *last*, so filter
output is never re-validated. Trigger candidates are ordinary nonce-free core redirects
(`wp-login.php?action=rp`, `redirect_canonical`).

**Why it mattered here specifically:** `order_key` is the *sole* authorization secret for orders in
this design — `/api/order` gates on a constant-time `order_key` compare precisely to prevent
enumeration (`lib/woo.ts:168`). Looping `order_id=1..N` would have harvested every key on the store,
defeating that gate and exposing order number, status, paid flag, total and payment method (and, via
Woo's own `order-received`/`order-pay` URLs, guest billing details).

**The fix** (both halves, defence in depth):
1. Gate on actually being inside the gateway's own handler — a priority-1 `woocommerce_api_straumur`
   action sets a flag the filter requires — instead of on a query parameter.
2. **Stop emitting `order_key` entirely.** `villa.astro` reads only `straumurStatus` — it never used
   the key, so this was gratuitous exposure. Only the non-secret `order_id` breadcrumb remains.

The **success** path (`woocommerce_get_return_url` → `/utskra/takk`, bridge `:22-28`) is unaffected
and correct: it takes `$order` from WooCommerce's own filter argument, never from `$_GET`, and
`takk.astro` genuinely needs the key for its gated lookup.

`php -l` clean; the deployed copy in the Local install was re-synced (it had been running the
vulnerable version).

**Verified by executing the real filter** under a stubbed WordPress (PHP CLI harness; the Local
stack is stopped and the Straumur key is LIVE, so no gateway call was made). A/B on the identical
unauthenticated request `/wp-login.php?action=rp&wc-api=straumur&order_id=1234`:

| | `Location` returned |
|---|---|
| **old filter** | `…/utskra/villa?straumurStatus=failed&order_id=1234&order_key=wc_order_…` ← **key leaked** |
| **new filter** | input passed through unchanged — no rewrite, no key |

And the legitimate leg still works: with the gateway flag set, a failure redirect becomes
`…/utskra/villa?straumurStatus=failed&order_id=1234` (B1 still closed, no key), while an already
storefront-bound `/utskra/takk?...` passes through untouched. A canonical-redirect attack variant
(`/?p=1` plus the query params) also passes through clean.

Still worth one live curl when Local is next up, to confirm the same holds through a real WP
bootstrap rather than stubs.

## 🔬 /ship x-ray pass (2026-09-16) — 5 lenses over `src/`

Run as part of the pre-commit quality suite. **No Critical security findings**; the lenses
independently confirmed secrets never reach a client bundle, no injection sink exists, every
`set:html` is sanitized, layering is clean (no `lib`→`pages` imports, no cycles), and
`isAllowedRedirect`'s suffix match is correct (`.straumur.is`, so `evilstraumur.is` fails).

**Fixed in this pass** (all pre-existing, all verified after):
- `CartView.tsx` + `CartDrawer.tsx` — the placeholder `onError` handler lacked the loop guard its
  five siblings have, so a 404 on `/placeholder.svg` would have retried forever. Guard added.
- `api/cart/customer.ts` — `typeof body.billing_address !== 'object'` accepted `null`
  (`typeof null === 'object'`), so `{"billing_address": null}` reached `updateCustomer`. Replaced
  with a real `isPlainObject` guard (new, in `lib/validate.ts`), and only valid addresses are
  forwarded. Flagged independently by the security and API lenses.
- `lib/storeCatalog.ts` — its two raw `fetch` calls bypassed the `[tag]` boundary-logging
  convention that `storeApi`/`woo` follow, so a Store API outage rendered an empty shop with
  **zero** server-side trace. New `catalogFetch` logs once and re-throws, preserving the existing
  contract. Verified live: hitting `/verslun` with WordPress down now emits
  `[store-catalog] products transport failure` where it previously emitted nothing.

- `Breadcrumbs.astro` — the component self-applied `.container` while **all 11 call sites already
  wrap it**, so on the 8 `container--wide` pages the trail clamped to `--maxw` (1240px) inside a
  `--maxw-wide` (1440px) parent. Measured live at a 1500px viewport: the crumb row sat **59px
  inboard** of the `<h1>` beneath it (left 123 vs 64, width 1240 vs 1358). Class removed; now
  pixel-aligned. Padding is unaffected — `.breadcrumbs`'s own `padding: 1.25rem 0 0` already
  outranks `.container`'s `padding-inline` by cascade-layer order.
- `global.css` — added `.screen-reader-text` to the `.visually-hidden` rule. WooCommerce emits that
  span inside `price_html`, `sanitizeHtml` allows `span[class]`, and no stylesheet hid it — so on
  **sale-priced variable products** every card rendered Woo's a11y text inline, reading roughly
  "Áður 12.990 kr.9.990 kr.Nú 9.990 kr.". (`lib/price.ts:17` strips this same span for the wishlist
  API path, which is how we know the markup carries it. PDPs were unaffected — `vara/[slug].astro`
  guards `PriceTag` behind `type !== 'variable'`.) Hiding it beats stripping it: the text is
  genuinely useful to a screen reader.
- `CartView.tsx` + `CartDrawer.tsx` — the cart line total rendered in a class-less `<div>` while
  `global.css:1045` defines `.cart-line__price { font-weight: 600 }`. Class now emitted, so the
  price reads as a price again. Same markup↔CSS contract class as R7, inverted.

**Open, not acted on (deliberate — each is pre-existing and wider than this change set):**
- 🟠 **`prerender = true` bakes the category nav into 4 content pages.** `hafa-samband`,
  `personuvernd`, `skilmalar` and `um-okkur` are prerendered, but `<Base>` calls
  `listTopCategories()` via the header *and* footer, and both swallow failure into `cats = []`.
  A production build run while WordPress is unreachable therefore freezes a **permanently empty
  nav** into those four pages until the next build, with no error. Confirmed in this session: the
  build log shows `[woo] GET /products/categories failed` for exactly those four pages. Either
  make them SSR (the project's own default per `astro.config.mjs`) or add "WP must be up" to the
  deploy runbook. *This also gates the R1 fix above: on those four pages the footer list is
  whatever the build saw.*
- 🟡 `/api/order` collapses a Woo outage into `404 Pöntun fannst ekki` (`woo.ts:165` blanket
  catch), so the `/utskra/takk` poll reports "order not found" during an outage. `/api/products`
  treats the same condition as 502 and explicitly documents why. Splitting the transport case out
  costs nothing — the anti-enumeration guard is key-mismatch, not transport.
- 🟡 Duplication clusters worth one refactor ticket: the product card is hand-rolled three times
  (`ProductCard.astro`, `WishlistView`, `RecentlyViewed`) each restating the CSS contract — which
  is exactly how R7 happened; the cart line + `slugFromPermalink` are near-identical in `CartView`
  and `CartDrawer`; the wishlist storage contract is spread across three files while `lib/wishlist.ts`
  owns only a constant; `Base.astro`'s ~160-line inline script does six unrelated jobs.
- ⚪ `waitlist.ts:14` returns `{message}` where its own documented contract is `{ok, code, message}`.
- ⚪ `verslun/[category].astro:33` runs 5 upstream facet fetches before the 404 short-circuit.

## ❌ Still missing (unchanged from June unless noted)

**High (conditional):**
- **A1 — DPT (Pakki Pakkaport) parcel-locker picker.** Storefront handles DPO only; zero
  `postis_dpt_parcelpoints` in src. *Progress:* the new bridge exposes
  `GET /wp-json/musikogsport/v1/postis/parcelpoints` (headless-bridge.php:136-157) — remaining work
  is the Astro proxy + picker UI + checkout field. Whether a DPT rate is actually offered is still
  unverifiable statically — **confirm the live rate list first.**

**Medium:**
- No security headers / CSP (no middleware.ts) · no rate limiting on any `/api/*` route.
- No tests / linter / CI — and a 1,803-line uncommitted makeover has no regression net.
- WP-side legal pages still unreconciled: Skilmálar (id 4999) `modified: 2025-05-14` — still serves
  14-day/Valitor/old-address facts to anyone hitting the WP origin.
- No customer accounts / order history (guest checkout valid; large build).
- No search autocomplete. **NEW:** Meilisearch is half-wired — the deployed bridge fires product
  save/delete webhooks at `{MOS_ASTRO_INTERNAL_URL}/api/internal/meili-upsert`, but no such Astro
  route exists, `scripts/sync-meili.ts` doesn't exist, and the guarding constants are undefined in
  wp-config (guaranteed no-op today). Don't forget the half-built seam.
- No image optimization / responsive srcset (raw `<img>` everywhere).

**Low (the June C-list, all re-verified still absent):** free-shipping progress bar (C1 — threshold
advertised in 4 places, data already on the wire; best AOV lever) · guest order tracking (C2) ·
contact form (C3 — page restyled, still static) · FBT (C4, net-new backend) · analytics/consent/
Sentry (C5) · qty caps from `quantity_limits` (C8) · VSK breakdown line (C9) · reviews (C10,
intended-absent) · A2 phone optional for home delivery · A3 wildcard variation resolver · default
og:image (home has none; PDPs without `short_description` emit empty description metas) · web
manifest + apple-touch-icon (makeover owned, didn't add) · footer social links (same) · skeleton
loaders · sitemap cold fetch ~8.2s.

---

## Suggested order of action
1. **Commit the working tree** (makeover + bridge + 500 page). Everything valuable since 06-13
   lives uncommitted; gates are green. (House rule: never `git checkout --` here.)
2. Decide the three small product questions the makeover raised: category cap (R1 — restore
   stjarnan/sumar reachability), drawer estimator (R2 — restore or delete `.drawer__ship`),
   free-shipping wording (R3 — pick one claim).
3. **Straumur is live now** → run the B-series runbook: verify hosted-page host (B4) with one
   controlled transaction, confirm dashboard URLs empty (B2/B3), patch the local shim's
   `wp_redirect` leg, verify prod `home_url`. Until then consider disabling the gateway if real
   shoppers aren't meant to see it.
4. Confirm whether DPT is an offered rate (A1) — if yes, build the picker (WP side is ready).
5. Then the standing mediums: middleware (CSP + rate limit), tests/CI, WP legal-page reconcile.
