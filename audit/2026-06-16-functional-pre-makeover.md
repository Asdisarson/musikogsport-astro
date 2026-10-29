# Functional audit — musikogsport storefront (app-astro) — 2026-06-16

**Pre-makeover pass.** Goal: surface functional **bugs** and **missing features** before a visual/UX redesign.
Cosmetic / CSS / component-structure concerns are **deliberately out of scope** (the makeover owns them).

Method: differential multi-agent review (29 agents) — 5 targeted lenses (end-to-end flow, integration
contracts, missing features, logic-to-preserve map, Postís locker) seeded with the two prior audit docs
(`2026-06-03`, `2026-06-13`) + `STOREFRONT-GAPS.md` as *already-known*, then an adversarial verify pass on
every candidate (24 candidates → **20 confirmed in-scope, 4 refuted/out-of-scope**). Straumur key is LIVE →
**static source review only**, no gateway/checkout calls executed, read-only. The DPT finding below was then
verified by hand against the Pósturinn plugin source.

> **TL;DR.** The storefront is functionally solid for its **currently-live BACS (bank-transfer) checkout**.
> Two things deserve attention now: **(1) the DPT/Pakkaport parcel-locker selection is entirely missing**
> (a live fulfillment risk *if* DPT is an enabled rate), and **(2) the entire Straumur card failure/return
> path dead-ends outside the storefront** — a hard **card-go-live blocker**, but inert until card is enabled.
> Everything else is low-severity polish or already-known deferred backlog. **No active money-loss, no
> data-loss, no security regression** was found; the 2026-06-13 money-path hardening landed cleanly.

---

## A. Live functional issues — act before/independent of the makeover

### A1 🟠 DPT (Pakki Pakkaport) parcel-locker selection is unimplemented — order placed with no locker
- **Where:** `src/lib/droppointStore.ts:42` (`rateNeedsPostbox` matches only `DPO`/`DNO`).
- **Backend reality:** `app/.../plugins/posturinn/wc-posturinn-shipping-api.php:127-133` lists active
  domestic services `DPH, DPP, DPO, DPT` — **`DPT` (Pakki Pakkaport, parcel locker) is active**; `DNO` is
  **commented out (:131)**. The plugin's own `CLAUDE.md:73` + `:69`: *"Postbox (DPO) **and parcel point
  (DPT)** selections require additional UI"*; order meta carries `postis_dpo_postbox` **and
  `postis_dpt_parcelpoints`** via separate `/postboxes` vs `/parcelpoints` endpoints.
- **Verified rate_id format** (`inc/postis.class.php:566-604`): the real API-driven rate builder emits the
  postbox service as a **single generic `'id' => 'DPO'`** rate (:583), and every other service — including
  **DPT** — as `'id' => $service['deliveryServiceId']` (:596), so a DPT rate_id is **prefixed `DPT`**. This is
  bare-code, not `postis:DPO` (the plugin's own matching uses `substr($id,0,3)` :568 and
  `preg_replace('/[0-9]+/','',$rate_id)` :1008). So `.startsWith('DPO')` **correctly** catches the live
  postbox rate (DPO capture works), but a `DPT…` rate slips straight through as a plain non-locker rate. `DNO`
  is dead two ways — commented out of the fallback **and** folded into the generic `DPO` rate in the real path.
- **Bug:** the storefront builds the full **postbox (DPO)** flow (DroppointSelect → `postis_dpo_postbox`)
  but has **no parcel-point (DPT)** equivalent. A shopper who selects Pakkaport gets no picker and the order
  is placed with no `postis_dpt_parcelpoints` → unfulfillable-to-locker. The `DNO` branch is also **dead**
  (commented out upstream).
- **Severity:** **HIGH if DPT is offered to shoppers**, which is a WP-DB/Mappan-runtime config I can't read
  statically. **Confirm first:** does checkout actually present a "Pakki Pakkaport" rate? If yes → fix is
  required (and it's more than a one-liner: needs DPT detection **+** a `/parcelpoints` proxy/picker **+**
  the `postis_dpt_parcelpoints` top-level field). If DPT is disabled, this is latent — still worth fixing
  `rateNeedsPostbox` to drop dead `DNO` and be ready for DPT.
- **Postís DPO note (resolved, NOT a bug):** the long-standing "verify-first" concern from the 2026-06-13
  x-ray — that `postis_dpo_postbox`/`postis_dpt_phonenumber` are spread at the **top level** of the checkout
  body — is **confirmed correct**. The plugin's Store-API hook `Postis_Blocks_Integration`
  (`blocks-support.php:306-323`) reads `$request->get_params()['postis_dpo_postbox']` at top level, and WP
  REST retains unknown top-level keys. The **DPO** locker IS captured.

### A2 ⚪ Phone is optional in the form but never required for non-postbox carrier delivery
- **Where:** `src/components/CheckoutForm.tsx:255-256` (no `*`, excluded from `validate()` :119-128); enforced
  only for postbox rates (:157-159, `canPlace` :225). Non-postbox orders send `phone: ''`.
- **Impact:** the carrier loses the optional delivery/SMS-coordination number. **Not a break** — the plugin
  tolerates a blank phone (`posturinn/inc/api.class.php:213-219` blanks an invalid phone for DPP/DPH; no hard
  gate before `wp_remote_post`). **Low.** Consider requiring phone for home/post-office rates too.

### A3 ⚪ Variation resolver prefers first wildcard ("Any") match — display/waitlist only
- **Where:** `src/components/ProductPurchase.tsx:61-72` (`.find()` first-match, treats `option===''` as
  wildcard).
- **Impact:** on a product mixing an explicit variation and an "Any" catch-all on the **same** attribute, the
  PDP could **display** the wildcard's price/stock and target restock-waitlist at the wrong variation id. The
  **money path is unaffected** — `handleAdd` sends the *selected attribute values*, not `resolved.id`, and
  WooCommerce does its own authoritative server-side variation match/pricing. **Low**, data-shape-dependent
  (most stores fully enumerate). Fix = prefer a specific-option match over the wildcard.

---

## B. Card-payment (Straumur) go-live blockers — gated, but must-fix before enabling card

> Card/Straumur is **not enabled today** (BACS is the only live gateway; Straumur is LIVE-key-mock-only,
> real E2E deferred to a TEST key). These are inert until card launches, but they break the **failure leg of
> the money path** the moment it does. All converge on one structural asymmetry: **the headless bridge
> rewrites only the SUCCESS return; every failure/cancel branch escapes the storefront.**

### B1 🟠 Declined/failed/cancelled card dead-ends on a raw WordPress page — `/utskra/villa` is unreachable
- **Where:** `app/.../straumur-payments-for-woocommerce/includes/class-wc-straumur-payment-gateway.php:505,
  523,548-550` — every non-success branch of `process_return()` redirects to `$order->get_checkout_payment_url()
  ?: wc_get_cart_url()` (classic WC order-pay / cart pages). The headless bridge
  (`app/.../mu-plugins/headless-bridge.php:22-28`) rewrites **only** `woocommerce_get_return_url` (success →
  `/utskra/takk`); it never filters `get_checkout_payment_url`/cart-url.
- **Why `/utskra/villa` never fires:** villa is reached **only** via the bridge's `template_redirect` handler
  keyed on `?straumurStatus=` (`headless-bridge.php:34-41`; `villa.astro:8-9`), but (a) the Straumur plugin
  **never emits `straumurStatus`** (grep across the plugin = 0 hits; it exists only in the bridge + villa),
  and (b) `process_return` runs on `woocommerce_api_straumur` during `parse_request` (priority 0,
  `LegacyRestApiStub.php:36,166`) and `wp_safe_redirect+exit` **before** `template_redirect` ever runs.
- **Impact:** once card is live, a **declined card** (the most common failure) lands the shopper on a raw
  WP-origin page with no storefront chrome and no "try again / pick another method" path — server cart already
  emptied. Lost-sale + broken UX on the highest-stakes branch. **HIGH.** Found independently by two lenses.
- **Fix:** add a bridge filter for the gateway failure-return (route `get_checkout_payment_url`/cart-url to
  `/utskra/villa`), **or** configure a Straumur abandon/fail URL that carries `?straumurStatus=…`.

### B2 🟡 Whole card round-trip depends on hand-set Straumur dashboard fields with zero code validation
- **Where:** `class-wc-straumur-settings.php:146-159` (`abandon_url`, `custom_success_url` both default `''`);
  `class-wc-straumur-api.php:234-235`. The success path works **only** because `custom_success_url` is empty;
  the cancel→villa path works **only** if the merchant hand-types `?straumurStatus=canceled` into the Abandon
  URL field. No startup check / admin notice / fallback.
- **Impact:** a one-field misconfiguration silently breaks the headless payment UX with no signal. **MEDIUM.**
  Belongs in the go-live runbook (the project's already-tracked "pin Straumur host + runbook" item).

### B3 ⚪ `custom_success_url`, if ever set, strips `order_id`/`order_key` from the return
- **Where:** `class-wc-straumur-payment-gateway.php:537-541` uses `custom_success_url` verbatim, bypassing the
  bridge's `get_return_url` filter that appends the keys. `takk.astro` then falls back to the `mos_order`
  cookie (2h, sameSite=lax). **Low** — default is empty, set nowhere; fails only on cross-device / cleared /
  >2h cookie tail. Runbook: keep `custom_success_url` empty.

### B4 ⚪ Redirect allowlist `STRAUMUR_HOSTS=['straumur.is']` is asserted, not proven
- **Where:** `src/components/CheckoutForm.tsx:47,50-59`. The comment reasons from the **API base**
  (`greidslugatt.straumur.is/api/v1/`), but the shopper-facing **hosted-checkout page host** in `session['url']`
  is not pinned in source (can't hit the live gateway). If the pay page is served from a non-`*.straumur.is`
  host, **every** card redirect bounces to `/utskra/villa`. **Low** (unproven, card disabled) — but a real
  **must-verify-before-launch** item (already on the project's open list).

### B5 ⚪ Abandoned/failed card empties the server cart with no client-side re-hydration
- **Where:** `CheckoutForm.tsx:189-199` (server cart emptied at order creation; no `resetCart` on redirect
  hand-off); `villa.astro:19-25` offers no cart restore. **Low** — funnel annoyance only. The
  *orphaned-pending-orders* half is **refuted**: WooCommerce core `wc_cancel_unpaid_orders` cron
  (`wc-order-functions.php:1079`) auto-cancels + restocks pending orders past `hold_stock_minutes` (default 60).

---

## C. Missing functional features — all low / mostly known-deferred

All verified genuinely absent (no false-missing) and **in functional scope**, but each rated **low** after
scrutiny. Several are explicitly deferred in `STOREFRONT-GAPS.md`. None block the makeover; most are additive.

| # | Feature | Note | Sev |
|---|---------|------|-----|
| C1 | **Free-shipping progress bar** ("X kr. eftir í fría sendingu") | Threshold advertised in 4 places (`SiteHeader:20`, `index:162/188`, `vara:208`); cart/drawer show no progress. Data already on the wire. Best AOV lever here. | low |
| C2 | **Guest order-tracking page** | `/api/order` is built + IDOR-key-gated but reachable only from the thank-you poll. No `rekja/track` route. Email confirmation covers the common case. | low |
| C3 | **Contact form** (PARTIAL) | `hafa-samband.astro` is static (tel/mailto/address only) — no `<form>`, no `api/contact`, no email infra. Known-deferred (GAPS). | low |
| C4 | **Storedash "Frequently Bought Together"** | Backend endpoint exists (`storedash-essentials/.../FBTCartEndpoint.php`) but mutates the **classic** WC cart, not the Store API, and bundle defs aren't Store-API-exposed → **net-new backend work**, not just unwiring. | low |
| C5 | **Analytics / consent / Sentry** | None anywhere. Known-deferred (both prior docs). Consent only bites once analytics ships. | low |
| C6 | **Newsletter signup** | Privacy policy mentions newsletter consent but no signup exists (back-in-stock waitlist IS built). Fix = one-line copy edit until a newsletter exists. | low |
| C7 | **Custom 500 page** | Only `404.astro`. All demonstrated throw paths already guarded → defense-in-depth gap. | low |
| C8 | **Qty max from Store API stock** (PARTIAL) | Steppers unbounded; `quantity_limits`/`low_stock_remaining` ignored. Server still enforces (no overselling) — missing in-UI cap + "aðeins N eftir" hint. PDP could compute from `stock_quantity` it already holds. | low |
| C9 | **VSK/VAT breakdown line** | `total_tax`/`tax_lines` on the wire, unused. Prices are VAT-inclusive → optional transparency line. | low |
| C10 | **Product reviews/ratings** | Not fetched/shown. Contingent — `disable-comments` installed + backend empty → intended state. Revisit only if reviews get enabled. | low |
| C11 | **Tests / linter / CI** | None — type safety rests on `astro check`. Process gap; no regression net around the money-path seams. | low |

---

## D. Refuted / out-of-scope (don't act)

- **Stale cart nanostore after a bounced card redirect** — *refuted.* `window.location.href` is a full
  document navigation that tears down the JS context; the store re-evaluates `primed=false`/`cart=null` on
  the next page. Self-healing.
- **Guest card-return nonce minted without a WP session** — *refuted.* Paid status comes from the
  HMAC-verified webhook + `/api/order` poll, never from `process_return` succeeding; a nonce failure breaks
  only the landing, not money/reconciliation. Nonce is deterministic for a guest.
- **Web app manifest / apple-touch-icon** — real but **out of scope** (branding/iconography the makeover owns).
- **Social-media links in footer** — real but **out of scope** (footer content the makeover places).

---

## E. Logic-to-preserve map — the bridge to your visual makeover

When you rip out / redesign the UI, these are the places where **business logic is entangled with
presentation**. Losing any of them silently breaks a feature or a money/SEO/security guarantee. (16 items
distilled; full detail in the workflow output.)

**Highest silent-drop risk — the wishlist + behaviour layer lives in plain `data-*` attributes, not React:**
- `src/layouts/Base.astro:96-104,121-266` — two inline scripts are the **entire client behaviour layer
  outside React islands**: pre-paint theme (no-FOUC), **the whole wishlist feature** (localStorage
  `mos-wishlist` + count badge, cross-tab sync), mobile-nav, PDP gallery thumb-swap (with one-shot `onerror`
  re-arm), sticky-header shadow, scroll-reveal — all via **event delegation** re-init on `astro:page-load`.
- It depends on exact card/PDP hooks: **`data-wish`, `data-id`, `data-slug`, `data-name`, `data-image`** +
  the `[data-wish-count]` badge target, `[data-theme-toggle]`, `[data-nav-toggle]`/`.main-nav[data-open]`,
  `.pdp__thumb[data-full]`, `#pdp-main`, `[data-reveal]`. **A new product-card/PDP that renames or drops
  these silently kills wishlist + the header badge with no error.** Re-emit all five attributes, and keep the
  `astro:page-load` re-init or behaviours die after the first client-side navigation.

**Money / pricing (a designer must never inline-format):**
- `src/lib/format.ts:5-28` — single source of truth: `formatISK`/`formatStoreMoney`, **zero-decimal ISK**
  (`currency_minor_unit`=0, never `/100`), `'37.990 kr.'` grouping. Hardcoding `kr.` or assuming cents
  100×'s or ÷100's every price.
- `src/components/PriceTag.astro:12-33` + `price.ts:11-21` + `vara/[slug].astro:61-84` — **3 price states**
  (price_html / sale-with-struck-regular / plain) + variable `frá` prefix. The `on_sale` render **requires
  both** `sale_price` AND `regular_price`; `storeCatalog.ts:65-66` **blanks** regular/sale on variable parents
  on purpose. Dropping either guard resurrects a strikethrough-from-nothing bug.

**Checkout flow (highest-risk rewrite target):**
- `src/components/CheckoutForm.tsx:47-228` — preserve **every `canPlace` gate**, the two-step
  address→shipping→pay sequencing, `isAllowedRedirect` (loosening it = open redirect on the money path),
  **resetCart only on the non-redirect branch** (resetting before a Straumur hand-off clears the cart early),
  the `order_id`+`order_key` URL params on the takk redirect, and the **top-level** `postis_dpo_postbox`/
  `postis_dpt_phonenumber` field names. Payment method is **data-driven** from `cart.payment_methods` — never
  hardcode it.
- `src/pages/utskra/takk.astro` — keep `no-store`, URL-params-then-one-shot-cookie resolution, render-only-
  from-key-gated-lookup (removing `order_key` re-opens order enumeration), and the card-pending poll
  (`#order-status`/`order-copy` ids). On Local, card stays `pending` by design — not a bug.

**Cart state + security + SEO (easy to lose in a layout rewrite):**
- `src/lib/cartStore.ts` + `cartProxy.ts:9-89` — one shared nanostore across **8 subscribers**; `ensureLoaded`
  prime-once (else N parallel `/api/cart` calls + flicker); the **httpOnly `Cart-Token`** round-trips via
  `/api/cart*` (browser **cannot** call WP directly — CORS). Don't move the token to JS-readable storage.
- `src/lib/sanitize.ts:6-30` — the **XSS boundary** for every `set:html` of Woo content. Must stay wrapped;
  switching to raw `innerHTML` for "richer" rendering opens stored XSS. `price_html` needs `bdi/del/ins` allowed.
- `src/lib/decode.ts:19-30` — entity decode with the **codepoint range guard** (`num<=0x10FFFF`) that prevents
  an SSR-500 on a malformed product name; display names are **already decoded** — don't double-decode or pass
  through `set:html`.
- `src/lib/jsonld.ts` + `Base.astro:25-89` — canonical/OG/Twitter, Organization+WebSite JSON-LD, **`noindex`
  on cart/checkout/transient pages**, `slot="head"` injection for Product/Breadcrumb LD. A head rewrite can
  silently drop any of these (→ blank social cards, indexed checkout). Keep `ld()`'s `<`-escaping (raw
  `JSON.stringify` into `set:html` is an injection vector). Org address/phone are **legal facts**, not copy.
- `src/lib/img.ts:13-35` — every image must go through `mediaUrl`/`productImage` (rewrites local Woo hosts to
  prod, terminal `PLACEHOLDER`); gallery/variation swaps must keep the `onerror` **re-arm** (`Base.astro:214`,
  `ProductPurchase.tsx:85`).
- `src/lib/facets.ts` + `storeCatalog.ts` + `ShopFilters.astro` — **OR-within / AND-across** facet semantics
  (a second Store-API client exists *because* REST v3 can't express it); `toggleHref/clearHref` build param
  URLs (hand-rolling breaks the page reset); facet params carry through the sort form via hidden inputs;
  counts must keep mirroring the grid (omit on empty, never invent). `colourSwatch` is functional data, not decoration.
- `src/lib/brand.ts:25-35` — `splitBrand()` peels a known brand off the product name for the PDP eyebrow line;
  render `product.name` directly and you lose the brand line.
- **Per-page SSR / prerender:** keep `prerender=false` on every API/cart/checkout/PII/dynamic route (a stray
  `prerender=true` bakes stale or leaks order data), keep `no-store` on PII routes, and keep the `.catch(()=>[])`
  degradation on catalog fetches (removing it turns a Woo blip into a full-page 500). Don't move per-page data
  fetching into a shared prerendered layout.

---

## F. What's healthy (so the makeover doesn't "fix" it)
- Money-path hardening from 2026-06-13 **landed cleanly** (storeFetch/wooGet wrap fetch+timeout, log once at
  the boundary, return non-ok instead of throwing). Type safety clean (no `as any`/`@ts-ignore`).
- Security solid: anti-enumeration order lookup (constant-time `order_key`), env split (no secret in client
  bundle), all `set:html` sanitized, httpOnly cart/order cookies, redirect scheme+host allowlist.
- DPO postbox locker capture is **correct** (top-level param verified against the plugin).
- Commerce engine complete: browse → variations → cart → live Pósturinn shipping → DPO locker → coupon →
  BACS checkout → key-gated receipt.

---

## Suggested order of action
1. **Confirm DPT is/ isn't an enabled shipping rate** (A1). If enabled → build the DPT parcel-point flow; this
   is the only candidate **live fulfillment bug**.
2. **Before enabling Straumur card:** fix the failure-return routing (B1) + write the go-live runbook covering
   B2–B4 (empty `custom_success_url`/`abandon_url`, pin the hosted-checkout host).
3. **Quick wins alongside the makeover:** free-ship progress bar (C1), newsletter copy edit (C6), `DNO`→`DPT`
   in `rateNeedsPostbox`, phone-required for home delivery (A2).
4. **Backlog (own ticket):** order-tracking page (C2), contact form (C3), analytics/Sentry (C5), tests/CI (C11).
