# 07 Signed-in account, thank-you, view-order

Type: task
Status: done (READY WITH NOTES); guest and signed-in items closed 2026-10-19.
Blocked by: none (was: 04, REST key, test account)

## Question

Check that areas 00 and 04 carried over:
- Millisamtala and the total hierarchy.
- The status pill in `--good`.
- Edit-address field widths like checkout.

Then the full signed-in bacs smoke test.

## Status note 2026-10-18

Still blocked: product pages answer 503 on :4323 because WooCommerce has no REST API key. The user asked to carry on
through every area; this one was not styled blind. Next step after the key is restored in wp-admin and `.env`: build
it, then run a delta /ship over it.

## Status note 2026-10-19

The REST key works now. The guest parts are built; the **signed-in parts are blocked on a test account**. Uncommitted
(the orchestrator verifies and commits).

**No usable sign-in account.**
- Test customer 1209 (live-clone 09) was deleted. The remaining WP users are cloned real customers plus two admins
  (two admin accounts), all with unknown passwords.
- No user was created and no password was reset (hard constraint).
- **Unblock:** the user supplies a disposable local test customer, or OKs creating one through WC REST and deleting
  it afterwards, as with 1209. The signed-in smoke is then `bacs-smoke.mjs` plus a login step, with the same
  `/api/checkout` guard.

**Changes** (`src/styles/global.css`, presentation only):
- The receipt `thead` rule widens from `.thankyou` to `:is(.thankyou, .account__content)`. Before, view-order's
  "Vara / Samtals" header was centred with no rule; the :10026 probe of a cloned table measured `center`/`none`.
- Receipt `tfoot td` may wrap on thank-you and view-order. "Millifæra inn á bankareikning" ran 14px past 390 and 44px
  past 360; this was pre-existing on :10026 too. Amounts stay whole, because the column floor is "bankareikning".
- `.thankyou__overview`:
  - one row at 768 and up (the wrap stranded Greiðslumáti under a dangling dashed rule)
  - number, date and total don't shrink
  - at 767 and below, a 2x2 grid with one dashed rule between the columns

**Smoke** (guest, unchanged `bacs-smoke.mjs`):
- order 265111: on-hold, bacs, 12.495 kr., Sótt í verslun, ssn and skiptimiði saved; cart 0 after
- deleted with `smoke-cleanup.php 265111 5 3 delete`: `deleted=yes stock=5 total_sales=3`, newest order back to 264920
- the `3b134443/tmp` helpers had been removed from disk; they were rebuilt verbatim from the 3b134443 transcript

**Per item:**

| Item | Status |
| --- | --- |
| Millisamtala and the total hierarchy on thank-you | Closed. Millisamtala first; total 22px/600; ink rule `rgb(40,40,40)` above it. :10026 showed "Samtals" twice, 18/500, a grey rule. |
| Millisamtala and the total hierarchy on view-order | Carried over by construction (same `.review-table` and `__total-row` markup, Millisamtala row in the source); thead fixed. Not visible: no account. |
| Status pill in `--good` | Carried over by token (`.thankyou__status[data-state=paid]` uses `--good` #2f7d49). Not visible: the pill renders for card orders only, and Straumur is off limits. View-order and orders show the status as text, with no pill. |
| Edit-address field widths like checkout | Carried over by construction (`.account-fields` shares every checkout field rule, including the phone collapse). Not visible: no account. |
| Dashboard, orders list and nav at 1440/390/360 | Not visible: no account. All classes have rules; not styled blind. |
| Signed-in bacs smoke | Not done: no account. Guest smoke done and cleaned up. |

The "Not visible: no account" rows above are superseded by the signed-in note below.

**Gates:**
- vitest 176/176; `astro check` 0 errors, 0 warnings, 1 hint; build green
- routes 31/31; crawl OK with 0 failures
- overflow 0 on thank-you at 320, 360, 390, 576, 768, 992, 1024 and 1440, and on account, lost-password, cart and
  checkout at 1440, 390 and 360

**Shots:**
- `harness/shots/area07/`: thankyou-{1440,390,360}, account, lost-password, cart, checkout
- `harness/shots/area07-before/`: thankyou and account/lost-password from :10026, GET only
- `harness/shots/area07-smoke/`: checkout-filled and order-received at 1440

**Probes:**
- `harness/area07-probe.mjs`: GET only, aborts any `/api/checkout`
- `harness/area07-overflow.mjs`
- `harness/area07-shiprow.mjs`: an injected paid row, "1.200 kr. Pósturinn – Afhent á pósthúsi Kópavogi". The amount
  stays on one line and overflow is 0 at 360, 390 and 1440.

## Status note 2026-10-19 (signed-in)

The user authorized one disposable local test customer. Created with wp-cli as **customer 1236**
(`refined-goya-smoke+<ts>@example.invalid`, a random password kept only in a non-repo file), then deleted with
`wp user delete --yes`. The deletion was verified: `user get` fails, no `*refined-goya*` user is left, and the cred
file was removed. No other user was touched and no password was reset. Uncommitted (the orchestrator commits).

**Signed-in bacs smoke** (`harness/area07-signed.mjs --smoke`):
- It is `bacs-smoke.mjs` plus a sign-in step, with the same `/api/checkout` guard. The billing email is
  `smoke-test@example.invalid`, so `smoke-cleanup.php` accepts the order.
- **order 265112:** on-hold, bacs, 12.495 kr., Sótt í verslun, ssn and skiptimiði saved. `customer_id` is 1236, so
  `/api/checkout` forwards the JWT. The cart was 0 afterwards. Checkout saved the billing and shipping addresses to the
  customer.
- **Baseline before:** stock 5, total_sales 3, newest order 264920.
- **Cleanup:** `smoke-cleanup.php 265112 5 3 delete` gave `deleted=yes stock=5 total_sales=3`. The customer then had
  no orders, the user was deleted, and `smoke-state.php` showed 5 / 3 / 264920 again.

**Shots:** `harness/shots/area07-signed/`, every page at 1440, 390 and 360 (fold png, full jpg, `metrics.json`).
- The pages are thank-you, dashboard, orders, view-order, edit-address, edit billing, edit shipping and edit-account.
- **Overflow:** 0 on all 24.
- **The grey bar in the full-page jpgs** is the fixed store notice, an artifact of full-page capture.

**Fixes** (presentation only):
- `src/pages/min-sida/view-order/[id].astro`: "Athugasemd:" ran into the note text ("Athugasemd:refined-goya…"), so an
  explicit `{' '}` was added.
- `src/styles/global.css`: the order-number link in the orders table and the "Breyta" links on edit-address measured
  68x31 and 46x31 on phones. They now have a 44px-tall hit area: inline-block with 7px padding and -7px margin, so the
  layout doesn't move and the 1440 orders row stays 79px. Phone small targets went from 1–2 to 0.

**Per item:**

| Item | Status |
| --- | --- |
| Millisamtala and the total hierarchy on view-order | Closed. Measured at 1440, 390 and 360: Millisamtala first, the total at 22px/600, an ink rule `rgb(40,40,40)` above it, and a left-aligned "Vara / Samtals" thead with a 1px rule. |
| Millisamtala and the total hierarchy on thank-you (signed in) | Closed. Same measurements; the 2x2 overview grid holds at 390 and 360. |
| Status presentation | Closed as text. Orders and view-order show the status as text ("Í bið"), bold in the view-order lead and ink in the orders table. A `--good` pill exists only on thank-you for paid card orders, which can't be exercised (Straumur). An on-hold bacs order shouldn't be green anyway. No new pill was added. |
| Edit-address field widths and rhythm like checkout | Closed. Billing and shipping: Eiginnafn and Eftirnafn paired, and Póstnúmer and Borg paired, at 1440; everything wide at 390 and 360. Row gaps are a uniform 28px. Floated labels, the 58px fields and the 1px border match checkout. |
| Account nav, dashboard and orders table at 1440, 390 and 360 | Closed. The 240px nav column sits beside the content at 1440 and stacks on phones. The orders table collapses to labelled rows on phones. 0 overflow. |
| Signed-in bacs smoke | Closed. Order 265112, cleaned up. |

**Gates:**
- vitest 176/176
- `astro check`: 0 errors, 0 warnings, 1 hint
- build green
- routes: 31 PASS, 0 FAIL
- crawl OK, 0 failures

**Open:**
- On phones the stacked account nav (5 rows, about 280px) pushes the content below the fold on every account page.
  This is WooCommerce's default and live's layout. A compact nav (horizontal scroller or `<select>`) is a design
  decision for the user.
- Whether to show a status pill (e.g. muted for on-hold, `--good` for completed) in the orders table and the
  view-order lead. Not added, because it would be new presentation beyond the carry-over.
