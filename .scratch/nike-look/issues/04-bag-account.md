# 04 Bag, checkout, account

Type: task
Status: done
Blocked by: 00

## Question

See map.md Destination and the matching nike.com section in reference/SPEC.md.

## Answer (2026-10-23, built, uncommitted: the orchestrator verifies and commits)

Presentation only on the money path. The React islands changed copy, SVGs, classes and JSX order only. No change to:
- request bodies, `/api/*` or the cart store
- totals maths, `formatISK`/`formatStoreMoney` or `cartSubtotal`
- coupon and shipping logic, validation, or payment selection

Four expressions moved verbatim:
- `ShippingBarView … cartSubtotal($cart)` and the `err &&` line in CartView
- the checkout coupon block (same `couponOpen` state and `onClick`)

`CouponField`, `ShippingCalc`, `ShippingBarView` and `DroppointSelect` are untouched.

**Built:**
1. **/karfa/**
   - Layout: a 1084px block. The server-rendered h1 "Karfa" (24/500, in karfa.astro) sits over the lines. The 335px "Samantekt" column is lifted 56px at ≥992 so it sits level with the h1.
   - Lines: a 150px 1:1 #F5F5F5 image (contain, multiply); name 16/500; variation and "/ stk." in #707072; the line total 16/500 at right; a 44px stepper pill (1px #CACACB drawn inset, so the buttons stay 44×44); a 44px trash button; #E5E5E5 rules.
   - The underlined 14px "Halda áfram að versla" now sits under the lines.
   - Summary rows: Millisamtala, coupon rows, Vörusendingar + calculator, then Samtals between #E5E5E5 rules (16/500, amount 20/600).
   - Below the rows: "Ertu með afsláttarkóða?" as a native `<details>`; the free-shipping bar as a 14px message over a 4px #111 track; "Ganga frá pöntun" as a 60px pill; 12px #707072 small print.
   - Phones stack, the summary under the lines.
   - Empty: the h1 is visually hidden; "Karfan er tóm" 24/500 and a black "Halda áfram að versla" pill. Under them, the home "Vinsælt núna" tiles:
     - new `lib/cartSuggest.ts`: the WP front-page `popular` row, cached a minute like the front page
     - rendered hidden and shown by `.cart-wrap:has(.cart-empty) ~ .cart-suggest`
     - laid out while hidden, so the carousel measures its arrows correctly
2. **Side cart:** a 440px white panel over a #111/.4 scrim with a .4s slide.
   - "Karfa (1)" at 24/500, a 44px close.
   - 96px line anatomy, with the trash button at the top right.
   - #E5E5E5 rules; Millisamtala, the bar, then the black "Ganga frá pöntun" pill over the outline "Skoða körfu" pill.
   - Empty: "Karfan er tóm" and a black pill.
3. **Checkout:** `.checkout-header` (logo only, no footer) and `.checkout-wrap` share one centred 1056px frame, so the logo lines up with the form.
   - Columns: the form is 600px, "Þín pöntun" 360px with no grey panel; the old 58.333vw gradient is gone.
   - Fields, shared by checkout, account, sign-in and contact:
     - the label above, 16px; drawn first through a flex column with `order:-1`, while the DOM stays input-then-label
     - 48px, r4, 1px #949494, 24px apart
   - Headings are 20/500. The summary uses the cart anatomy: 80px image, qty as "× 1" in #707072 (it was white on 50% black, about 4:1), and the total between rules.
   - The discount-code toggle moved from the top of the form into the summary, as a 56px row.
   - Payment methods are 56px bordered rows with r4; the selected one gets a #111 ring.
   - "Panta" is kept: the re-quote error message tells the shopper to press „Panta“.
4. **Thank-you and view-order:**
   - white, a 24/500 heading
   - the overview as label/value pairs on #F5F5F5 r4: 4-up, 2×2 under 768px
   - receipts: a 14px #707072 thead, 1px #E5E5E5 rules on every row, the total 20/600
   - the `review-table__amount/text` wrap rules are kept
   - view-order "40× 1" got its missing space (`{' '}`)
5. **Account:**
   - "Mín Síða" 24/500 over a 220px nav: plain 16px links, a 2px ink left bar and 500 on the current one.
   - Phones: a row of 44px scrolling chips, the current one filled #111. A small script centres the current chip by scrolling the row only.
   - Content h2 24/500; the orders table with #E5E5E5 rules.
   - Addresses (and view-order's addresses) as cards with 1px #CACACB, r8, 24px padding.
   - Edit forms use the checkout fields (600px); buttons are pills.
6. **Sign-in, lost password and popup:**
   - a centred 400px column with 24/500 headings, the checkout fields, a black "Skrá inn" pill, and 14px underlined links with 44px rows
   - the eye button is anchored to the input's bottom
   - `.popup` (login and size chart): white, r8, #111/.4 backdrop, round 44px close
7. **Content pages and errors:**
   - `.page-title` and `.page-head h1`: the uppercase display face, 40/32px, `line-height:1`, `overflow-wrap:anywhere`
   - `.prose`: 760px, h2 20/500
   - WPBakery: h2/h3/h4 20/500, a 24px column gap, full rows on `--gutter`
   - contact: the checkout fields, a 600px form, the black "Senda" pill
   - NotFound (404, 500, 503, order-not-found): "Villa 404" 14px over the display headline (64/40px), 16px text, a black "Á forsíðu" pill and an outline "Í verslun" pill
8. **Dead CSS removed:**
   - the grey totals panel and the checkout gradient
   - `.cart-empty__icon`, `.cart-page__back`, the heading `::after` dashes, floating-label transforms, the 58px/18px/r0 `.input-text`
   - the `--field-border-surface` and `--line-strong` tokens (both now unused)
   - new token `--rule` #E5E5E5
   - the base field rule now also covers `input:not([type])`: lost-password `#user_login` and the shipping calculator were 34px

**Gates (final build):**
- vitest 234/234; astro check 0 errors, 0 warnings, 1 hint (the old one); build OK
- routes 31 PASS, 0 FAIL; crawl OK
- content pages: 6 PASS through `harness/content-pages-4323.py`, a wrapper, because the script is hard-wired to :4322. It also posts one local contact-form submit, as the original does.
- `harness/area04-hscroll.mjs`: 210 checks, 0 overflowing, over 15 widths (320–1920). It covers:
  - /karfa/ with an item and the coupon open
  - /gera-upp/ with the coupon open
  - the side-cart panel edge
  - the empty /karfa/ with its tiles
  - 10 account, content and error pages
- console-check: 0 errors (7 pages × 1440/390)
- refined-goya `cart-qty-probe`: stepper 112×44, buttons 44×44; qty 2 shows "/ stk.", − back to 1 hides it
- `ship-fixes-probe`:
  - "+" is hit-testable at 992/1024/1100/1199/1440
  - #5 now reports the coupon before checkout: expected, the brief puts it there
  - the probe then crashes on a `.campaign` selector that area 00 removed (not this area)
- metrics vs `area04-before` (the area-03 state of these pages):
  - contrast failures 0 on every area page, unchanged
  - small phone targets: cart 3→0, checkout 8→5 (the 20px checkboxes and radios inside larger labels), side cart 14→10, other pages equal
  - empty cart 0→7: the "Vinsælt núna" tile titles, the same anatomy (the title link's `::after` covers the card) the home rows have
  - the signed-in account probe: 0 small targets and 0 overflow on all 24 pages

- `harness/area04-states.mjs` (`/api/checkout` aborted, no order), at 1440 and 360:
  - /karfa/ calculator: its 3 inputs are 48px; postcode 220 gives 4 rates in 44px rows (68px for the 2-line one)
  - Póstbox: the locker picker is 48px with 11 options
  - coupon `<details>` with a bogus code: "Afsláttarkóðinn er ekki til."
  - /gera-upp/: the moved coupon block shows the same error and stays on /gera-upp/
  - the HOKA size-chart popup: r8, the table scrolls inside its figure
  - overflow 0 on every state; cart emptied
  - shots in `shots/area04-states/`
- Contrast: `shots.mjs` measured 0 failures on the unsigned pages. `area07-signed.mjs` doesn't measure contrast. The tightest new pair is the thank-you overview labels, #707072 on #F5F5F5 at 14px: 4.53:1 by calculation, not measurement.

**Smokes (guarded, bacs only):**
- baseline: stock 5, total_sales 3, newest order 264920
- guest order 265113: on-hold, bacs, 12.495 kr., Sótt í verslun, ssn and skiptimiði saved, cart 0. Deleted: `deleted=yes stock=5 total_sales=3`.
- signed-in order 265114, by test customer 1237 (`area07-customer.py`; random password in the non-repo cred file, never printed):
  - `customer_id` 1237
  - deleted: `deleted=yes stock=5 total_sales=3`
  - user 1237 deleted, cred file removed, no `*refined-goya-smoke*` user left
- after both: `smoke-state` shows 5 / 3 / 264920

**Shots:**
- `harness/shots/area04/` (1440/390/360):
  - cart, cart-empty, checkout, checkout-failed, account, lost-password
  - contact, terms, hours, sizes, about, privacy, notfound, wishlist
  - ov-sidecart, ov-login
- `area04-signed/`: thankyou, dashboard, orders, view-order, addresses, edit-billing, edit-shipping, edit-account (fold png, full jpg, metrics.json)
- `area04-smoke/`: checkout-filled and order-received at 1440
- `area04-before/`: the baseline
- `area04-cartqty/`: cart-qty-probe

**Per item:**

| Item | Status |
| --- | --- |
| 1 Cart page | Closed. "Samantekt" level with "Karfa" is a CSS offset (−56px at ≥992), not a shared grid. |
| 1 Empty cart + tiles | Closed. |
| 2 Side cart | Closed. |
| 3 Checkout | Closed. Phone "Sýna samantekt" `<details>` not done; reason below. |
| 4 Thank-you / view-order | Closed. The `--good` paid pill stays unexercisable (card only; Straumur is off limits). |
| 5 Account | Closed. |
| 6 Sign-in / popup / lost password | Closed. |
| 7 Content pages, contact, 404/500 | Closed. 500 and 503 share NotFound; only 404 was rendered. |
| 8 Dead CSS | Closed for this area's selectors. The `product-row--related` CSS stays for /ship (area 03's note). |

**Deliberately not done:**
- The phone "Sýna samantekt" collapse. `.checkout__review` holds the payment methods, the terms and the submit button, so collapsing or moving it isn't presentational. The summary stays under the form.
- "Panta" was not renamed (see Built 3).
- No VSK note: none existed. The 12px small print makes no tax or legal claim.

**Open questions:**
- Copy changed:
  - "Karfan er tóm" (was "Karfan þín er í augnablikinu tóm.")
  - "Halda áfram að versla", "Samantekt", "Ganga frá pöntun"
  - the small print "Sendingarmáti og greiðslumáti eru staðfestir í næsta skrefi."
  - "Skrá inn" (submit), "Villa 404", "Í verslun"
  - checkout toggle "Ertu með afsláttarkóða?" (dropped "Smelltu hér til að slá inn kóðann")
  - Does the user want any of it back?
- The wishlist title (`.page-title`) is now the uppercase display face, like the other content pages; its grid is unchanged.
- Thank-you is a 770px column inside the 1056px checkout frame, so its left edge doesn't line up with the logo.
- `/karfa/` now makes one cached Store API products call per minute (cold: once) for the empty-state tiles, even when the cart has items. A failed load renders no tiles.
- The test customer's login and email still say `refined-goya-smoke` (the area-07 script was reused unchanged).
- Pre-existing logic quirk, not touched: the calculator prints "Sending til 220 &#8211;.".
  - `ShippingCalc` hides a placeholder city by comparing it to `'-'`, but the Store API returns it as `&#8211;`.
  - Fixing it is logic in a money-path island, so it's left for a decision.
- The two refined-goya `ship-fixes-probe` runs crashed on area 00's removed `.campaign` before emptying their carts. That left two abandoned local Store API carts (qty 2). They are not orders: the final `smoke-state` read 5 / 3 / 264920.
