# Ship review: `feat/do-ready` (HEAD 02274a7 + the fixes below, uncommitted)

Scope: `git diff feat/better-filters...HEAD` (7 commits, 161 files). Method: read the money path end to end
(`checkoutFlow`, `checkoutPayload`, `checkoutRecovery`, `api/checkout`, `api/checkout/status`, `storeApi`, `cartStore`,
`cartProxy`, `woo` order lookups, `orderReceipt`, the receipt page, `CheckoutForm`, `droppointStore`,
`mos-checkout-fields.php`, `headless-bridge.php`), cross-checked against the installed Pósturinn and Straumur plugins
and the local WordPress, plus a cross-commit pass (env names, timeouts, DEPLOY.md vs code, dead code, weak tests), and a
second, independent `/code-review high` pass whose findings I verified one by one.

## Verdict: READY WITH NOTES

No High findings. Three Medium findings, all fixed here (code ones with a failing test first). Everything else is Low/Info
and left as findings. The money path holds up: no way found to create a duplicate order, lose one, mis-confirm an unverified
one, drop a field WooCommerce or Pósturinn reads, or leak PII. Commit the two fixes before pushing.

## Findings

| ID | Sev | Where | Issue | Evidence | Fix |
|---|---|---|---|---|---|
| SR-01 | Medium, **FIXED** | `src/lib/storeApi.ts:31-44,64` | `storeFetch` read the response body (`res.text()`) outside the try/catch that maps transport failures. A time-out firing after the headers arrived, or a connection reset mid-body (PHP killed at `max_execution_time`), rejected out of `checkout()` and `/api/checkout` answered a bare 500. The browser's `isLostAnswer` is false for a 500, so it showed "Ekki tókst að ganga frá pöntun." with no status poll, even though the order may have been placed (bank transfer: the retry then dies on an empty cart). This is exactly the LM-01 case the batch set out to close. Same hole for every cart call (a throw instead of the localized 502/504). | Test `SR-01` in `storeApi.test.ts` failed with `TimeoutError: The operation timed out.` before the fix (a `ReadableStream` that throws on read). | `fetch` and `res.text()` now share the try; the catch returns the existing `transportFailure` result. Test passes (timeout -> 504/`timeout`, reset -> 502/`network`). |
| SR-02 | Medium, **FIXED** (docs) | `DEPLOY.md:139,152,378`, `.do/app.yaml:90` | The deploy docs and the spec told the owner to create a **Read** WooCommerce REST key. The storefront writes through it: `lib/account.ts` PUTs `/orders/<id>` (attach the order to a signed-in shopper, `attachOrderToCustomer`) and `/customers/<id>` (address and account forms, `updateCustomer`). With a Read key those return 401 in production while products, receipts and the checkout all keep working, so it would go unnoticed until a signed-in shopper's Pantanir stayed empty or an address edit failed. Local dev works because its key is Read/Write. | `grep wooSend src`: `account.ts:87,129,131`. WooCommerce Read keys allow GET only. | Docs and spec now say Read/Write and why; ticket 02 line updated. New `src/lib/deployDocs.test.ts` (3 tests): the code still writes through the key; the docs never say Read-only; every `- key:` in `.do/app.yaml` is documented in DEPLOY.md. The Read/Write test failed before the doc edit. |
| SR-03 | Low, fixed | `DEPLOY.md` rate-limit table | `POST /api/checkout/status` (30/min, added in 02274a7) was missing from the table. | `status.ts:16` | Row added. |
| SR-04 | Low | `src/components/CheckoutForm.tsx:250-262,319` | `placeOrder` has no re-entry guard (also true on `feat/better-filters`); each call mints a new attempt id. The reachable window is the pending re-quote branch: it awaits `setCustomer` before `setPlacing(true)`, so a second press during that await can place the order while the first press is still showing "Sendingarkostnaður var uppfærður". (React flushes discrete-event updates synchronously and a disabled submit button blocks implicit Enter, so a plain double click is not a window.) WooCommerce reuses the session's order (card) or stops at an empty cart (bank transfer), so no duplicate order; at worst a confusing second message. | Reading `onSubmit` -> `placeOrder`; `disabled={placing}` only takes effect after a render. | A `useRef` flag set synchronously at the top of `placeOrder`, cleared on every non-navigating exit. |
| SR-05 | Low | `src/lib/checkoutFlow.ts:156-160` | A 2xx whose body is unreadable or has no `order_id` (a proxy page, a cut body) takes the plain-failure path ("Ekki tókst að ganga frá pöntun.") with no recovery poll. Our own `/api/checkout` JSON is tiny, so this needs a middlebox. | `submitCheckout`: `!res.ok || !d.order_id` | Treat `res.ok` with no usable `order_id` as a lost answer (poll), like a 502/503/504 without a code. |
| SR-06 | Low | `src/lib/checkoutRecovery.ts:60-64`, `src/pages/api/checkout/status.ts:11-13` | The status route is documented as read-only on WooCommerce, but `settleAttempt` runs `linkOrderToSignedIn` (PUT order + PUT customer addresses) for a signed-in caller. Only someone holding the 128-bit attempt id can trigger it, so exploitation needs a leak; the placing browser is the normal caller and the link is idempotent. | `settleAttempt` | Say so in the comment, or skip the link on the status route and let `/api/checkout` own it. |
| SR-07 | Low | `src/lib/checkoutPayload.ts:15,52` | The locker id is dropped silently when it is not `[A-Za-z0-9]{1,32}`. Ids come from Pósturinn's `deliveryServiceId` (`DPO9552`/`DNO...`), so this is fine today; if one ever carried `-` or `_`, WooCommerce would still accept the order (the phone check passes via the session rate) but without a locker. | `mos-posturinn-droppoints.php:63-67`, `blocks-support.php:245,372` | Answer 400 for a present-but-invalid locker instead of dropping it. |
| SR-08 | Low | `src/lib/checkoutPayload.ts:12,37` | Every address field, e-mail included, is cut at 200 characters. A valid address of 201-254 characters would be altered silently and the confirmation mail would go elsewhere. Practically never. | `text()` | Allow 254 for the e-mail, or refuse over-long values. |
| SR-09 | Info | `droppointStore.ts` `postboxReady` | By design (CO-03) a postbox rate cannot be ordered while Pósturinn's list is loading or failed; the shopper can pick another rate. | | |
| SR-10 | Info | `checkoutFlow.ts` `isLostAnswer` | A WordPress maintenance 503 (HTML, no `code`) reads as a lost answer, so the shopper is told to check the e-mail before ordering again although nothing was placed. Conservative, and the button stays usable. | | |
| SR-11 | Info | `src/lib/logger.ts` `clean` | Redaction covers strings and Errors only; a nested object in `fields` is written as is. No caller passes one today. | | |
| SR-12 | Info (refuted) | `src/lib/woo.ts:299` | The review pass called `include_meta` dead. It is a WooCommerce core REST parameter: against the local WordPress, `?include_meta=_billing_ssn` narrows `meta_data` to that key (also keeps other order meta out of the response). Keep it. | read-only GET of 30 orders with and without it | none |
| SR-13 | Info (decided) | `mos-headless-api.php:341` | The contact per-IP hourly cap sees only the storefront's address, so it is effectively store-wide at 30/h (documented in the file and DEPLOY.md); counters are get/set transients, not atomic, so a concurrent burst can overshoot a little. | | accepted |
| SR-14 | Info (decided) | `src/lib/http.ts` `visitorIp` | `do-connecting-ip` trust is unverified until DEPLOY.md step 5 is run; the fallback is one shared bucket (safe, strict). | | accepted |
| SR-15 | Info | new modules | No dead runtime code. Exports with no non-test importer are types or are used in-file/by tests (`isPersonalPath`, `classifyAttemptOrder`, `parseCheckoutState`, `createLogger`, `mediaOrigin`, `contentSecurityPolicy`, `CHECKOUT_NOTE_MAX`). No test without an assertion. | script over the new files | none |
| SR-16 | Info (refuted) | `src/lib/checkoutRecovery.ts:41`, `AWAITING_PAYMENT_MESSAGE` | The review pass noted that a declined card also leaves a Straumur order `failed`, so "greiðslan hófst ekki" could mislead. Recovery runs only for the attempt whose answer was lost, and the attempt id is on the order only once the hook ran in that attempt, before any hosted page was shown to the shopper; a `failed` order carrying that id means `process_payment` failed in this attempt. The copy holds ("saved, nothing was paid, Panta again reuses it"). | | accepted |
| SR-17 | Medium, **FIXED** | `src/pages/api/checkout.ts:5,48-52`, `src/lib/checkoutRecovery.ts:82-93` | Recovery ran only on a transport failure or a 502/503/504 without a `code`. WooCommerce answers an exception thrown after the order exists as a coded error: `WC_Gateway_BACS::process_payment` runs `update_status('on-hold')` (status hooks: e-mails, other plugins') BEFORE `empty_cart()`; an exception there is caught in `CheckoutTrait::process_payment` and returned as 400 `woocommerce_rest_checkout_process_payment_error` (any other `\Exception`: 500 `woocommerce_rest_unknown_server_error`, `AbstractRoute::get_response`). The shopper then sees an error with a full cart, and Panta again makes a SECOND order, because only draft/pending/failed orders are reused, not on-hold ones. Likelihood is low (a hook must throw), the cost is a duplicate paid-for-by-bank-transfer order; it predates 02274a7 but its trigger left it open, and an existing test asserted the old behaviour. | WooCommerce 11.2.1 source: `AbstractRoute.php:99-105`, `CheckoutTrait.php:120-135`, `gateways/bacs/class-wc-gateway-bacs.php:408-416`. New tests `SR-17` x3 in `checkoutRecovery.test.ts` (2 failed before). | After any non-ok, non-lost answer `/api/checkout` does the same read-only attempt lookup (`placedDespiteError`); only a PLACED order (on-hold/processing/completed) overrides the answer (200 `placed`, receipt cookie, account link, as after a lost answer). No order, a pending/failed one, an outage: WooCommerce's own answer is returned unchanged. The order is still never sent twice. Cost: one read (<= 5 s, normally ~100 ms) on a failed checkout. The old test case "WooCommerce's own error does not [look up]" was split accordingly (intentional change). |

## Money-path checks that came out clean

- Duplicate order: a lost answer, and (SR-17) a WooCommerce error, only ever trigger a read-only lookup; no code path re-POSTs the checkout. WooCommerce
  reuses the session order (card) or the cart is empty (bank transfer), per the WooCommerce 11 source notes in
  `checkoutRecovery.ts`. A new attempt id on a reused order overwrites the meta; the old id then finds nothing (correct).
- Lost order: SR-01 was the only route to a silent loss; fixed (SR-17 closes the coded-error variant). Server recovery (25 s + 5 s lookup) fits inside the
  browser's 45 s; the poll runs 6 x 4 s outside the cart queue.
- Mis-confirmation: only `on-hold`/`processing`/`completed` become "placed"; `pending`/`failed` with a non-hosted
  gateway, drafts and unknown stay "unconfirmed"; the receipt confirms only a key-verified order (404/503 otherwise).
  Straumur webhooks are REST, so the new `wp_die` redirect (headless-bridge 2c) cannot touch them; it is scoped to
  `woocommerce_api_straumur` and falls back to the default handler once headers are sent.
- Fields: the allow-list keeps all ten address keys for billing and shipping (phone on both), `customer_note`,
  `payment_method` (omitted only for a free order; WooCommerce answers `..._missing_payment_method`, shown in Icelandic),
  `extensions.mos` (kennitala, skiptimidi, attempt), and the top-level `postis_dpo_postbox`/`postis_dpo_phonenumber` that
  `blocks-support.php` reads. The shipping rate lives in the Cart-Token session (select-shipping), not in the body. No
  installed plugin registers other checkout extension data. Kennitala clearing (MU-03) reads the raw body so an absent
  key never clears.
- PII: `/api/checkout/status` returns state and `order_id` only; the order key goes into the httpOnly cookie; logs carry
  the attempt cut to 8 characters; `findAttemptOrder` asks WooCommerce for the one meta key.
- Cart: empty-cart short-circuit has no side effect; logout clears the token and receipt cookies with matching attributes;
  stepper counts from the last queued quantity.

## Cross-commit consistency

- Env names agree across `.do/app.yaml`, `astro.config.mjs` and DEPLOY.md (test added). `WP_INTERNAL_URL`,
  `MOS_CLIENT_IP_HEADER`, `MOS_TRUSTED_PROXY_HOPS`, `MOS_MEDIA_BASE_URL` are inlined at build (confirmed in `dist`);
  `MOS_HSTS`, `MOS_LOG_LEVEL`, the WooCommerce secrets and `MOS_SHUTDOWN_TIMEOUT_MS` are read at run time.
- Timeouts: one source (`lib/timeouts.ts`) for the money path; the remaining literals (`wooSend` 10 s, droppoints proxy 10 s
  vs the browser's 12 s, the status poll's 10 s) are consistent with it. No duplicated helpers across batches found.
- `node server.mjs` booted on a spare port: health 200, security headers on static files, graceful SIGTERM, then stopped.
- DEPLOY.md otherwise matches the code (rate limits, cache table, shutdown, headers) apart from SR-02 and SR-03.
- Installed mu-plugins are byte-identical to the repo copies (`cmp`, 8 files), `php -l` clean. No PHP changed here.

## Gates (after all fixes)

| Gate | Result |
|---|---|
| `npx vitest run --exclude '.claude/**'` | 63 files, 647 tests pass (baseline 640: +1 SR-01, +3 `deployDocs.test.ts`, +3 SR-17 replacing 1) |
| `npx astro check` | 0 errors, 0 warnings, 1 hint (the old one) |
| `npm run build` | complete |
| preview `:4323` `verify_live_routes.py` | 32 PASS, 0 FAIL |
| `crawl_links.py` | OK (preview process killed by its own PID) |

## Files changed in this review (uncommitted)

- `src/lib/storeApi.ts` 31-44, 64 (body read inside the transport try); `src/lib/storeApi.test.ts` 30-50 (SR-01 test)
- `src/lib/checkoutRecovery.ts` 82-93 (`placedDespiteError`); `src/pages/api/checkout.ts` 5, 48-52; `src/lib/checkoutRecovery.test.ts` 163, 168-216 (SR-17 tests, old case split)
- `src/lib/deployDocs.test.ts` 1-27 (new)
- `DEPLOY.md` 139, 152-155, 309, 378-379; `.do/app.yaml` 90-91; `.scratch/do-ready/issues/02-hardening.md` 60
- No PHP changed; installed mu-plugins still byte-identical (`cmp`).
