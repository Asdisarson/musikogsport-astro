# 08 Cart, side cart, checkout

Type: task
Status: resolved
Blocked by: 04

## Question

Restyle `/karfa/`, the side cart and `/gera-upp/` like live, keeping the local plumbing (Store API cart and
checkout, Pósturinn rates and the locker picker, coupons, bacs and Straumur). Thank-you page at
`/gera-upp/order-received/<id>/`. Move the bridge return URLs. Run a bacs smoke test, then delete the test
order and restock.

## Answer

### Live reference

Captured in one visitor-cart session (2026-10-12):
- One Smell Well, qty 1, added. Side cart, `/karfa/` and `/gera-upp/` measured at 1440 and 390.
- No checkout field was ever typed into.
- The item was removed (empty confirmed) and only the musikogsport.is cookies were cleared.
- Empty states were captured first: an empty `/gera-upp/` redirects to `/karfa/`.

### Side cart

- A 460px panel over a whitened page. 70px `#f8f8f8` header with "Cart" plus a superscript count (live's
  untranslated string) and a round close button.
- 60px thumbs, quantity stepper and ×.
- Samtals, then Goya's free-shipping bar, then "Skoða körfu" (outlined) and "Greiðsluferli" (dark).
- The header count is an orange 16px circle taking inline space, as on live.

### Free-shipping bar

- Comes from WordPress: Goya's theme mods (goal 20.000, messages, `#ec652d`, mini cart and cart locations),
  exposed as `mos/v1/front-page` → `shipping_bar`.
- The maths is tested in `shippingBar.ts`: 1.990 of 20.000 shows 9% and 18.010 kr. left, as on live.

### `/karfa/`

- Bar plus "Continue Shopping" on top.
- Lines in a 900px column: 95px thumb, name and price, stepper, line total, ×.
- Coupon row: "Afsláttarkóði:" field plus "Nýta afsláttarkóða".
- Bordered 450px "Samtals í körfu" box:
  - Uppercase rows, coupon rows with "[Fjarlægja]".
  - WooCommerce's shipping calculator ("Reikna sendingarkostnað" opens Póstnúmer/Bær, then Pósturinn rates
    as radios, "Sending til …" and the locker picker).
  - "Áfram í greiðsluferli".
- Live's empty state: grey circle bag, "Karfan þín er í augnablikinu tóm.", "Til baka í vefverslun".
- It replaces the makeover `ShippingEstimator`; live has WooCommerce's calculator.

### `/gera-upp/`

Live's distraction-free classic checkout: `Base` `distractionFree` renders the logo only (no campaign bar,
menu, footer or side cart), with a grey right half from 58.333vw.

Left column:
- Coupon toggle bar, then "Greiðsluupplýsingar ——" and "‹ Back to Cart".
- Floating-label fields in live's order:
  - Eiginnafn | Eftirnafn
  - Kennitala
  - Nafn fyrirtækis
  - Country / Region
  - Heimilisfang
  - Apartment | Póstnúmer, then Borg / Bær
  - Sími, Netfang
- Fields use WooCommerce's `form-row-first/last/wide` floats, which reproduce live's Póstnúmer/Bær offset. Row
  gaps match live within 1–2px.
- "Senda á annað heimilisfang?" (shipping fields), "Viltu skiptimiða?", Skilaboð.

Right column:
- Review: 60px thumb with a "× n" pill, Samtals, Vörusendingar (rates re-quoted once the address is complete,
  like `update_order_review`), Samtals.
- Payment box: the local gateways, card logos for Straumur.
- Privacy text and a required terms checkbox (both link `/skilmalar/`, live's page 4999).
- "Panta".

Other behaviour:
- Errors show as a WooCommerce-style notice.
- `?straumurStatus=failed|canceled` shows a payment notice.

### Live's extra fields

`mos-checkout-fields.php` takes Store API `extensions.mos` and saves `_billing_ssn` and `skiptimidi`, the meta
keys live's Checkout Field Editor already uses for 18k orders.

### Thank-you

- `/gera-upp/order-received/<id>/?key=` (`OrderReceived.astro`), in the distraction-free layout.
- WooCommerce's notice, overview (number, date, total, payment method), bank-transfer note and order details.
- Gated by the order key; no email or address. A wrong key shows neutral copy only.
- The `getOrder` summary gained its non-PII details.

### Redirects

**Storefront:** `/utskra`, `/utskra/takk` and `/utskra/villa` 301 in one hop to `/gera-upp/`, the
order-received endpoint and `/gera-upp/?straumurStatus=` (`legacyCheckoutTarget`, tested).

**WordPress:**
- The bridge return URL is now `/gera-upp/order-received/<id>/?key=`; Straumur failures go to
  `/gera-upp/?straumurStatus=failed`.
- The pass-through is exact, so other `/gera-upp/` WP pages (order-pay) are still rewritten.
- Headless mode moved to template_redirect priority 5. Before, WooCommerce's empty-cart bounce sent
  `/gera-upp/?straumurStatus=failed` to `/karfa/` and dropped the status (found with `curl -I`).

### Safety

**Pre-flight** (a subagent audited the plugins; I re-checked the running DB):
- disable-emails supplies `wp_mail`.
- All 12 webhooks are disabled.
- StoreDash has removed Pósturinn's status-change hook.
- Pósturinn auto-shipment fires only at `wc-completed`.

**Rule:** never set Completed; cancel, then force-delete.

### Smoke test

Two local bacs orders:
- Order 265094: Pakki Heim. Saved `_billing_ssn`, `skiptimidi=1`, the note, DPH; total 14.495 kr. Stock went
  5→4.
- It exposed that the payment redirect URL can name another host (the dev shim's port). Fixed in
  `paymentRedirectTarget`: only the path of our own order-received URL is kept (tested).
- Order 265095: local pickup. Landed on the receipt.

Both were cancelled and deleted through WC REST. Afterwards:
- Stock is back to 5 and total_sales is unchanged.
- No rows remain.
- The Pósturinn log shows only the read-only rate quote.

### Verified

- Positions:
  - Cart lines at 405 (live 403), totals box 975/450.
  - Side-cart buttons at 742/801, as on live.
  - Checkout fields within 1–2px.
  - Empty cart within 1px.
- vitest 84/84, `astro check` 0/0/0, build green, routes 28/28 (5 new checkout checks).
