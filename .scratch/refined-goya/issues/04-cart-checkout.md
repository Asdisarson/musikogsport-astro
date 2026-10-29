# 04 Cart and checkout (presentation only)

Type: task
Status: resolved (approved by the user 2026-10-18 with "continue"; review page: https://claude.ai/artifact/PAj89fHkHy7KKr4gbHk4vC)
Blocked by: 00

## Question

Cart:
- Equal gutters.
- Totals on a grey panel, with a Millisamtala row and a 22px/600 grand total under an ink rule.
- An outline coupon button and a "‹" text back link.
- Totals above the coupon on mobile.
- 44px quantity stepper and remove button.
- Unit price only when quantity is above 1.

Checkout:
- Field grid: Kennitala and company on one row, Land and Íbúð each full width, Póstnúmer and Borg on one row,
  shipping address line 1 full width.
- A uniform 28px row gap, with `space` removed.
- Skiptimiði and Skilaboð full width.
- A gap before label suffixes.
- Totals hierarchy and a "Þín pöntun" heading.
- The payment box indented, with a ring on the selected method.

No new state or handlers. Bacs smoke test (local only).

Closes:
- cart: totals-box-flush-right-edge, coupon-button-competes-with-checkout, continue-shopping-english-prominent,
  duplicate-samtals-weak-total, shipping-toggle-wraps, remove-x-orphaned-row, qty-stepper-unboxed-small,
  ambiguous-double-price, all lows
- checkout: postcode-city-row-broken, duplicate-samtals-weak-total, label-suffix-no-space,
  notes-squeezed-beside-checkbox, uneven-rhythm-lonely-halves, review-column-heading-and-gutters,
  payment-method-alignment-selection, shipping-hint-loose-ragged, mobile-product-line-wrap
- Partial: cart/mobile-checkout-below-fold, checkout/coupon-bar-and-mobile-top-stack

## Answer

Built in `db9915c`. Presentation only: no new state or handlers.

**Cart:**
- equal page gutters
- totals on a grey `--surface` panel, Millisamtala first
- the grand total at 22/600 under an ink rule (shared with `.review-table__total-row`, so thank-you and view-order
  get it too)
- "Vörusendingar" moved to a label row above the calculator: two `colSpan` rows, so table semantics stay
- outline coupon button (`btn-outline coupon__apply`, also on checkout)
- the back link as underlined text with a ‹
- on /karfa/ only: a boxed 44px stepper and a 44px remove button in row 1, in its own column
- the unit price as "N kr. / stk." only when qty > 1
- on phones the items wrapper uses `display: contents`, ordered lines → totals → coupon

**Checkout:**
- widths: Kennitala + company, Land / Heimilisfang / Íbúð wide, Póstnúmer + Borg; shipping address line 1 wide
- `FieldDef.space` and `.form-row--lg/--md` removed, for a uniform 28px rhythm
- a 0.25em `column-gap` on floated labels, so "(valfrjálst)" and "*" are spaced
- skiptimiði and Skilaboð full width (the ≥992 notes offset removed)
- a "Þín pöntun" heading at ≥992 (padding-top 97px, level with Greiðsluupplýsingar)
- the review product name takes the width
- the shipping label row stacked like the cart
- payment methods as stacked boxes; the selected one gets an ink border plus inset ring on white
- the `.pay-box` indented 30px

**Gates:**
- vitest 159/159, `astro check` 0 errors, build green
- routes 27/31 and crawl 22: the baseline, all from the missing key

**Probes on :4323:**
- qty 2 shows "12.495 kr. / stk."; one tap on − gives qty 1 and hides it (1440 and 390)
- stepper 120x44, remove 44x44
- phone order: lines 396, totals 644, coupon 1128
- 0 overflow

**Bacs smoke (local):**
- `harness/bacs-smoke.mjs` guards `/api/checkout` so only `payment_method: bacs` can pass
- order 265110: on-hold, bacs, 12.495 kr., Sótt í verslun, `_billing_ssn`, `skiptimidi=1` and the note saved; the
  cart emptied
- cancelled and deleted with wp-cli (`smoke-cleanup.php`, which refuses anything not carrying the smoke email)
- stock back to 5, total_sales to 3, newest order back to 264920
- the order-received page itself still needs the REST key (area 07)

**Partial, as planned:** the phone checkout button still sits below the fold on /karfa/, and the checkout coupon bar
still tops the page. Both need the deferred sticky bar or collapsible summary.

Ultracode was off, so there was no multi-agent review; the check was screenshots, probes, the smoke order and a
visual review.
