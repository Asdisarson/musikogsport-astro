# Audit: lib-money (src/lib: cart, checkout, payment redirect, auth/session/account, order amounts, droppoints, wishlist)

Reviewer scope: HEAD e93d8b5, read-only. `npx vitest run` on this area's tests plus apiLimits.test.ts: 6 files / 31 tests pass.
Probes: preview on 127.0.0.1:4333 (PID recorded, killed afterwards) and node snippets over `checkoutRedirect.ts`.
The local WordPress (localhost:10025) was DOWN for the whole audit (curl 000; `local-site.sh start` exited 7). So no live
cart / checkout / order probes were possible. What the preview showed with WordPress unreachable is recorded under Paths.
Nothing was ordered, Straumur was never called, no `.env` value was printed.

## Files taken

Taken (non-test file plus its test), the set area 2 left to area 3:
`account.ts`, `accountFormat.ts` (+test), `auth.ts`, `cartCity.ts` (+test), `cartProxy.ts`, `cartStore.ts`, `cartSuggest.ts`,
`cartView.ts`, `checkoutRedirect.ts` (+test), `droppointStore.ts`, `orderAmounts.ts` (+test), `shippingBar.ts` (+test),
`storeApi.ts`, `wishlist.ts`.

There is no `contact*` or `money*` module in `src/lib` (contact is only `pages/api/contact.ts`).

Read for the traces (owned elsewhere, judged only where they touch the money path): `http.ts`, `visitor.ts`, `rateLimit.ts`,
`validate.ts`, `cache.ts` (`createTtlMap`), `logger.ts`, `cachePolicy.ts`, `woo.ts` (`getOrder`, `wooGet`, `wooSend`),
`siteChrome.ts` (shipping bar sanitising); and the callers `pages/api/{checkout,order,contact,products}.ts`,
`pages/api/cart/*`, `pages/api/account/*`, `pages/api/posturinn/droppoints.ts`, `pages/gera-upp/order-received/[id].astro`,
`pages/min-sida/{lost-password,customer-logout}.astro`, `components/CheckoutForm.tsx` (submit path),
`components/OrderReceived.astro`, and the order-related parts of `wp-mu-plugins/headless-bridge.php`.
No LC-* finding is re-raised; LC-01 (safeNext) and the PA-* findings are referenced where related.

## Per-file table

| file | lines | verdict | findings |
|---|---|---|---|
| account.ts | 156 | findings; no tests (getOwnOrder owner check, link retry, address copy all untested) | LM-11 (PA-04 for the swallowed errors) |
| accountFormat.ts (+test) | 28 | clean (field whitelist, trim, 200 cap, country pinned to IS; tested) | |
| auth.ts | 189 | findings; no tests for 189 lines of memo/revoke/invalidate logic | LM-09, LM-11 |
| cartCity.ts (+test) | 9 | clean | |
| cartProxy.ts | 117 | findings; no tests | LM-04, LM-05, LM-11, LM-15 |
| cartStore.ts | 87 | findings (low); no tests | LM-02, LM-12 |
| cartSuggest.ts | 27 | clean (cached loader, memoed failures, never blocks /karfa/); no test | |
| cartView.ts | 22 | clean (display math only, never submitted); no test | |
| checkoutRedirect.ts (+test) | 24 | clean for its logic (probed 10 hostile URLs, see LM-13) | LM-13 |
| droppointStore.ts | 47 | clean as a client store; trust note | LM-14 |
| orderAmounts.ts (+test) | 52 | findings (low) | LM-07, LM-12 |
| shippingBar.ts (+test) | 33 | clean (display only; message HTML is sanitised upstream in siteChrome.ts:88-89) | |
| storeApi.ts | 100 | findings; no tests | LM-01, LM-02 |
| wishlist.ts | 5 | clean (one constant, shared by `/api/products` and WishlistView) | |

## Findings

Format: ID | severity | file:line | issue | evidence | suggested fix | money-path?

| ID | sev | file:line | issue | evidence | suggested fix | money |
|---|---|---|---|---|---|---|
| LM-01 | Medium | lib/storeApi.ts:36-53 (surfaced by pages/api/checkout.ts:54 and CheckoutForm.tsx:298-302) | A checkout that outlives the 25 s backstop, or fails on transport after WooCommerce already created the order, comes back as `504/502 {"message":"Þjónustan svaraði ekki, reyndu aftur."}`. The shopper is told to retry. The order may exist (and for bacs the server-side cart may already be emptied), but `mos_order` is only written on `result.ok` (checkout.ts:47-48), so there is no cookie, no thank-you page and no receipt. The client's own no-answer message is careful ("check your email before you retry", CheckoutForm.tsx:292) but this server-generated one is not. A retry after a bacs order that did complete hits an empty cart. The Pósturinn quote and the Straumur session creation both happen inside this call, so slow upstreams make it reachable. | Code: storeFetch catch returns `status: timedOut ? 504 : 502` with the retry text for every path including `/checkout`. Probe (WordPress down): `POST /api/checkout` -> `502 {"message":"Þjónustan svaraði ekki, reyndu aftur."}`. The time-out-after-success case is reasoned from WooCommerce continuing PHP after the client aborts: unverified. | For `/checkout` only, return a distinct message that matches the client's ("Athugaðu tölvupóstinn þinn áður en þú reynir aftur"), and log the attempt with the visitor key and cart line count (no PII). Optionally keep a `pending-checkout` cookie so a retry can ask `/api/order` first. | y |
| LM-02 | Low | lib/cartStore.ts:38 vs lib/storeApi.ts:36 | Client abort (15 s) is shorter than the server backstop (25 s), and the comment on storeApi says Pósturinn rate calls can take 4 s warm and longer cold. A slow `setCustomer` (shipping quote) or `addToCart` is cut by the browser while WordPress keeps working; the response and its `Set-Cookie` (rotated Cart-Token) are lost, the shopper sees "Þjónustan svaraði ekki" for a call that succeeded, and the next queued call (`serial`) starts while the previous write is still running on the server, which is the race `createSerial` exists to prevent. The checkout call is exempt (45 s). | Code only; WordPress was down so no slow call could be reproduced. | Raise the client timeout for `/api/cart/customer` and `/api/cart/select-shipping` to about 30 s (above 25 s), or lower the server one for cart reads. Keep both ends documented in one place. | y (shipping quote) |
| LM-03 | Low | pages/api/checkout.ts:27-46 (type in lib/types.ts:206-220) | `/api/checkout` forwards the whole client JSON body to the Store API; only email and `payment_method` are checked. No allow-list of top-level keys. Price, total and shipping cost cannot be dictated this way: the Store API recomputes everything from the server-side cart session, and the only client-chosen money inputs are cart line ids/quantity and a rate id, which WooCommerce validates against its own package rates (verified by reading `storeApi.ts` and every cart route). But unknown keys reach WooCommerce too: `create_account` (if the setting is on, creates an account and sends a set-password mail to any email the visitor types, no verification), arbitrary `extensions.<namespace>` data for other plugins, an unbounded `customer_note` and `payment_data`, and the Pósturinn locker id (`postis_dpo_postbox`) with no server-side check that it belongs to the postcode. | Code. Whether `create_account` is enabled in Woo settings is unverified (WordPress down). | Build the forwarded body from named fields only (`billing_address`, `shipping_address`, `payment_method`, `payment_data`, `customer_note` capped at e.g. 1000 chars, `extensions.mos`, the two `postis_*` strings), drop the rest. | y |
| LM-04 | Low | pages/api/account/logout.ts:7-13, lib/cartProxy.ts:11,39 | Sign-out clears `mos_auth`/`mos_li` and denylists the JWT, but leaves `wc_cart_token` (48 h) and `mos_order` (2 h, holds the order key). On a shared device the next visitor still has the previous shopper's cart, and `GET /api/cart` returns the Store API cart including `billing_address`/`shipping_address` (name, address, phone, email once entered) to client JS. WooCommerce itself drops the session on logout. The receipt route needs the order id too, so the order cookie alone is a weaker exposure. | Code: `clearAuth` only touches the two auth cookies; `clearToken` is called only from order-received. | In logout.ts also call `clearToken` and delete `mos_order`. | n (PII on shared device) |
| LM-05 | Low | lib/cartProxy.ts:64-73 | `ensureToken` logs a failed prime but returns `null` and the caller goes on to send the mutation, or the checkout, without a Cart-Token. WooCommerce then starts a throwaway session and answers with a confusing error (empty cart for checkout), or silently adds the item to a new cart whose token may be lost if the response also fails. | Probe (WordPress down): log shows `[store-api] cart prime failed: 502` then `[store-api] POST /checkout failed` for the same request, i.e. two upstream calls to a dead backend. Code: nothing returns early on `!primed.ok`. | Return a 503 `{message}` from the route when the prime fails (let `ensureToken` return `StoreResult`-like failure), skip the second upstream call. | y |
| LM-06 | Info | pages/api/cart/{coupon,customer,select-shipping,remove-coupon}.ts, lib/cartProxy.ts:88-99 | Only add/update/remove are limited (120/min). Coupon apply, address and rate calls are unlimited by documented decision (comment at cartProxy.ts:91-92, ticket 02 sign-off). Worth knowing: an unlimited `/api/cart/coupon` lets a script guess coupon codes (each call is one WordPress hit and WooCommerce has no throttle). Same family as PA-13a; the cart POST routes also lack `sameOrigin` (PA-13b), safe today only through SameSite=Lax plus Astro's origin check (probed 403 by PA). | Code. | When the owner signs off: a 30/min limiter on coupon and customer. Add `sameOrigin` to all cart POSTs. | y |
| LM-07 | Low | lib/orderAmounts.ts:37-52, components/OrderReceived.astro:16-30, lib/account.ts:136 | The receipt lists lines, one discount row and shipping, then prints `order.total` from WooCommerce. `fee_lines` and refunds are not requested (`_fields` omits them) or shown, so an order with a fee (for example a payment surcharge) or a partial refund shows rows that do not add up to the total. Sums use floats on strings: exact for ISK (0 decimals), would print e.g. `0.30000000000000004` for a 2-decimal currency; `formatISK` and `currency` are hard-coded ISK anyway. Whether this shop uses fees is unverified (WordPress down). | Code: no `fee_lines` anywhere in `src/` (grep). | If fees exist, add `fee_lines` to the `_fields` of both order reads and one row. Otherwise note "no fees by design" in orderAmounts.ts. | y (display) |
| LM-08 | Low | pages/gera-upp/order-received/[id].astro:30,43-66, lib/woo.ts:192,228 | For a card order the thank-you page can only say "paid" (`processing`/`completed`) or "pending". A `failed`/`cancelled` card order (e.g. the webhook reports a decline after the success return) shows "Staðfesting greiðslu í vinnslu…" and "Takk fyrir. Pöntunin þín hefur verið móttekin." and the poll stops after 8 tries (24 s) with no outcome. The same neutral copy is shown for a missing order (PA-06). | Code: `showPoll` stays true for any not-paid status; the loop ends silently at `tries < 8`. | Return `status` in the poll response and render a failure line for `failed`/`cancelled`/`refunded`; after the last try say that the shop will confirm by email. | y (read) |
| LM-09 | Low | lib/auth.ts:55-56,103-124 | Any token-shaped cookie value (three base64url segments, trivially forged) costs one WordPress `users/me` call on every page that calls `currentUser` (checkout, `/min-sida/*`) until its answer is memoised (15 s), and `memo` is an LRU of 2000: spraying distinct tokens evicts real sessions, which then each pay one extra call. `inflight` has no bound but entries live only for the call. No exploit beyond load; WordPress answers 401 quickly. | Code. | Check the JWT's `exp` claim (base64 decode, no verification needed) before asking WordPress, and refuse expired or malformed claims locally; rate-limit by visitor for unauthenticated-looking checks if it ever shows up in logs. | n |
| LM-10 | Info | lib/rateLimit.ts, pages/api/account/{login,lost-password,reset-password,details}.ts | Limiters are per visitor IP (and per customer id for the password check). Observations, none a defect: (a) a shared address can be locked out of sign-in for 15 minutes by 10 wrong attempts from anyone behind it; (b) refund-on-success and refund-on-outage are correct (a refund only decrements the live window, `take` is before the slow call, a refused take uses no slot); (c) no per-account throttle on login, so a distributed guess is bounded only by WordPress; the mu-plugin has a store-wide per-IP net for lost/reset (mos-account-api.php:50-65), but since WordPress only sees the storefront's address that net is effectively global, so a handful of abusive requests can exhaust it for every shopper. | Code. | Accept; if abuse appears, key lost-password additionally by the login string. | n |
| LM-11 | Low | lib/auth.ts, lib/account.ts, lib/cartProxy.ts, lib/storeApi.ts, lib/cartStore.ts, lib/droppointStore.ts, lib/cartView.ts | The riskiest logic in this area has no unit test: auth.ts (memo, in-flight join, revoke, invalidate, outage memo, remember flag), account.ts (`getOwnOrder` owner check, `linkOrderToSignedIn` retries, address copy rule), cartProxy.ts (`readOrderCookie` parse, `writeToken` guard, `respondCart`), storeApi.ts (transport failure mapping, token rotation). `apiLimits.test.ts` covers only the limiters in the cart/products/droppoints/order/checkout routes. The tested modules are the pure ones. | grep of `*.test.ts`: only `apiLimits.test.ts` imports anything from this set, and it mocks `storeApi`/`woo`. | Add node-level tests with a fake `fetch`: owner mismatch returns null; revoke makes `currentUser` return null at once; logout while WordPress is down; `readOrderCookie` with malformed JSON/wrong types; storeApi timeout -> 504 and `cartToken: null`. | y |
| LM-12 | Info | lib/validate.ts:18 (via cartProxy), lib/cartStore.ts:43-49, lib/orderAmounts.ts:30 | Small things. (a) `clampQty(0)`, a string or a fraction all become 1, so `POST /api/cart/update {quantity:0}` sets quantity 1 instead of removing; the islands use the remove route, so only a stale or hand-made client sees it. (b) `cartStore.send` accepts an OK response with an unparseable body and does `cart.set(null)`, which makes CheckoutForm show "Sæki pöntun…" (the empty-cart redirect is skipped while the cart is null). (c) `OrderAmounts.subtotal` is read only by its test (dead outside it). | Code. | (a) document or map 0 to remove; (b) treat a non-object body as an error; (c) drop the field or use it in OrderReceived. | n |
| LM-13 | Info | lib/checkoutRedirect.ts:6-23 | The redirect check is sound. Probe results with origin `https://musikogsport.is`: `https://straumur.is.evil.com/`, `https://evilstraumur.is/`, `https://x.straumur.is@evil.com/` -> null; `//evil.com/gera-upp/order-received/5/` and `https://evil.com/gera-upp/order-received/5/?key=a` -> path only, same-origin; `https://straumur.is:8443/p`, `https://user@straumur.is/` -> followed (allowed host with port/userinfo); uppercase host is normalised. The trust boundary is WordPress's `redirect_url`: the whole `*.straumur.is` space is accepted, so a subdomain takeover at Straumur or a compromised WP would be followed. Accepted by design (comment at lines 3-5). | Probe `/tmp/lm-probe.mjs` via `node --experimental-strip-types`. | Optional: reject a non-default port and userinfo (`u.port === ''`, `!u.username`). | y |
| LM-14 | Info | lib/droppointStore.ts:14-38, pages/api/posturinn/droppoints.ts | The chosen locker (`mos-droppoint`) lives in localStorage and is never cleared after an order; it is postcode-scoped so a stale one is ignored for another postcode. The id sent as `postis_dpo_postbox` is client-chosen and not checked server-side against the postcode list (that would be the Pósturinn plugin's behaviour: unverified, WordPress down). Impact is the shopper's own delivery point only; shipping price comes from the postcode, not the locker. | Code. | Clear the key when an order is placed (resetCart path). | n |
| LM-15 | Info | lib/cartProxy.ts:16, lib/auth.ts:174 | Cookies are `Secure` whenever `import.meta.env.PROD` is true, i.e. also for `node dist/server/entry.mjs` over plain http on 127.0.0.1. Chromium accepts that, Safari (and curl-driven smoke tests that replay cookies) do not, so a local preview can look like "cart never persists". Production is unaffected (TLS). | Comment at cartProxy.ts:16 mentions dev only. | Note it in DEPLOY.md's smoke section, or key Secure on the request protocol. | n |

Counts: Critical 0, High 0, Medium 1 (LM-01), Low 8 (LM-02, 03, 04, 05, 07, 08, 09, 11), Info 6 (LM-06, 10, 12, 13, 14, 15).

## Answers to the brief's checklist

- Does the client ever dictate a price, total or shipping? No. Cart routes send ids, quantities, variation attributes, a rate id and
  an address; `cartView`, `shippingBar` and `orderAmounts` are display-only; the checkout body carries no amount fields and the Store
  API recomputes from its own cart session. The only soft spot is the unfiltered passthrough (LM-03).
- Cart token: httpOnly, `Secure` in prod, `SameSite=Lax`, host-only, 48 h, rewritten from every response that carries a token
  (`writeToken` skips a null one, so a failed call keeps the old cookie). The value is never validated before it is sent upstream; a
  hostile value only affects its own holder. Not cleared on logout (LM-04).
- Nonce / CSRF: no Store API nonce is used (the Cart-Token carries the session). Same-origin: checkout and every account route call
  `sameOrigin`; cart POSTs and contact do not (LM-06, PA-13b); Astro's `checkOrigin` plus Lax cookies cover form posts.
- Order key: `getOrder` compares `order_key` in constant time and answers null for a miss or a wrong key; `/api/order` takes a limiter
  slot before asking and refunds it only on a hit. `getOwnOrder` compares `customer_id` to the session's customer. The order cookie
  holds the key httpOnly for 2 h and is the only key source after a card return (the bridge strips it, by design).
- Session cookie: `mos_auth` httpOnly, Lax, `Secure` in prod, session-scoped unless "Muna eftir mér" (7 d). `mos_li` is the
  non-secret flag. WordPress revokes the JWT on logout and after a password change/reset.
- Rate-limit refunds: reviewed on login, edit-account, reset, contact, order. All take before the slow call and refund only on a
  right password or an outage. See LM-10 for the non-defects.
- Double submit / lost order: the submit button is disabled while `placing`; calls run through `withCartLock`; WooCommerce reuses the
  session's pending order on a retry. The lost-order risk is LM-01 (timeout after success tells the shopper to retry and leaves no
  cookie) and LM-02.
- PII in logs: `logger.ts` redacts `key=`/`token=`/`password=`; lib and route `console.warn` lines carry customer and order ids, status
  codes and error messages only. The one exception is `respondCart` logging up to 300 characters of a Store API error body, which can
  echo customer input (PA-13d).

## End-to-end path notes (money path, lib side, read-only)

1. Cart. Islands call `cartStore` (serial queue, 15 s abort) -> `/api/cart*` -> `ensureToken` (reads `wc_cart_token`; primes with
   `GET /cart` if missing) -> `storeApi.storeFetch` (25 s backstop; transport failure becomes 502/504 JSON with a null token) ->
   `respondCart` (rotates the cookie, `Cache-Control: no-store`, logs non-OK). Add/update/remove share a 120/min visitor limiter;
   quantity clamps to 1-99. Probe with WordPress down: `GET/POST /api/cart` -> 502 with `private, no-store` and the security headers.
2. Checkout. `CheckoutForm` validates, then `POST /api/checkout` inside `withCartLock` (45 s). The route checks `sameOrigin`, takes a
   slot of the 10/min limiter, requires email and payment method, ensures a token, asks WordPress who the shopper is
   (`verifiedUser`, memoised), calls the Store API as a guest, and on success writes `mos_order` ({id, key, seen:false}) and fires
   `linkOrderToSignedIn` after the response. Address copy and retry rules in `account.ts` are consistent with WooCommerce.
3. Payment redirect. `payment_result.redirect_url` -> `paymentRedirectTarget` (same origin, https `*.straumur.is`, or an
   order-received path reduced to path+query) else the failed-checkout URL. Straumur failure/cancel returns are rewritten by the
   bridge to `/gera-upp/?straumurStatus=failed` without an order key.
4. Order received. `/gera-upp/order-received/<id>/` takes the key from the query or, if `mos_order` matches the id, from the cookie;
   `getOrder` returns non-PII amounts; the first view of an order placed in this browser clears `wc_cart_token` and marks the
   cookie `seen`. The poll `GET /api/order` runs at most 8 times (LM-08).
5. Sign-in / out. Login: `sameOrigin`, limiter slot taken first, JWT from `jwt-auth/v1/token`, stored httpOnly. `currentUser` asks
   WordPress `users/me` with a 15 s memo; WordPress outage keeps the session (the visitor just looks signed out); a definite refusal
   clears the cookie. Logout revokes in WordPress and here for 60 s, clears the two auth cookies only (LM-04).
6. Lost / reset password. Lost: always the same answer (`?sent=1`), WordPress failures only logged. Reset: key and id come from the
   emailed link, `passwordProblem` runs first, a failed WordPress call refunds the slot and a possible half-applied reset invalidates
   the memoised tokens. `Cache-Control: no-store` on the page; the reset key sits in the page URL like WooCommerce's own.
7. Account edits. Customer id always from the verified session; addresses go through `addressFromForm` (whitelist, country IS);
   a password change needs the current password (limited to 5 wrong per customer per 15 min), then re-signs the browser in with the
   new password and handles a timed-out save by trying the new credentials. Order view: `getOwnOrder` -> null unless `customer_id`
   matches; errors are swallowed into null (PA-04).
8. Not done: anything needing a live WordPress (real cart tokens, shipping rate timing, Woo's behaviour on a stale Cart-Token,
   the `create_account` setting, fee lines). Those items are marked unverified above.
