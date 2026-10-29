# Audit: pages-api (src/pages/**, middleware, server.mjs, astro.config.mjs, layouts, robots.txt, scripts/*.py)

Read-only. Probed a preview on 127.0.0.1:4331 (existing dist/, killed afterwards) against Local WP. No orders, no Straumur, no POSTs that reach WP side effects (contact/lost-password not sent with valid data).

## Per-file table

| file | lines | verdict | findings |
|---|---|---|---|
| src/middleware.ts | 36 | findings | PA-08 |
| server.mjs | 65 | clean | - |
| astro.config.mjs | 58 | clean | - |
| public/robots.txt | 20 | clean | - |
| src/layouts/Base.astro | 355 | clean (see PA-11 note) | PA-11 |
| src/pages/index.astro | 53 | findings | PA-10 |
| src/pages/[slug].astro | 44 | findings | PA-01 |
| src/pages/404.astro, 500.astro | 8, 16 | findings | PA-07 |
| src/pages/leita.astro | 8 | findings | PA-12 |
| src/pages/karfa.astro, oskalisti.astro | 28, 17 | clean | - |
| src/pages/um-okkur.astro, personuvernd.astro | 42, 83 | findings | PA-09 |
| src/pages/sitemap.xml.ts | 61 | findings | PA-09 |
| src/pages/utskra/[...rest].astro | 9 | clean | - |
| src/pages/vara/[slug].astro | 28 | clean | - |
| src/pages/page/[n].astro | 41 | findings | PA-10 |
| src/pages/verslun/index.astro, page/[n].astro | 20, 37 | clean | - |
| src/pages/verslun/[...path].astro | 304 | clean (decodeURIComponent safe: malformed % gets 400 from Astro first, probed) | - |
| src/pages/voruflokkur, brand, merkimidar [...path] | 58, 41, 41 | clean | - |
| src/pages/gera-upp/index.astro | 31 | findings | PA-04 |
| src/pages/gera-upp/order-received/[id].astro | 70 | findings | PA-06 |
| src/pages/min-sida/index, customer-logout, lost-password | 56, 16, 70 | clean | - |
| src/pages/min-sida/edit-account, edit-address/*, view-order/[id], orders/[...page] | 66, 36, 65, 104, 70 | findings | PA-04, PA-05 |
| src/pages/api/account/login, logout, lost-password, reset-password, details, address | 34, 14, 32, 58, 91, 27 | findings | PA-03 |
| src/pages/api/cart/* (7 files) | ~12-24 each | findings | PA-13 |
| src/pages/api/checkout.ts | 55 | findings (money path, read only) | PA-14 |
| src/pages/api/order.ts, products.ts, posturinn/droppoints.ts, healthz.ts | 32, 74, 41, 9 | findings | PA-15 |
| src/pages/api/contact.ts | 61 | findings | PA-15 |
| scripts/crawl_links.py, verify_content_pages.py, verify_live_routes.py | 122, 43, 129 | findings | PA-16 |

## Findings

ID | severity | file:line | issue | evidence | suggested fix | money-path?

- PA-01 | Medium | src/pages/[slug].astro:14 | WooCommerce default English system pages (cart, checkout, my-account, shop) are served as indexable 200 content pages; SYSTEM_PAGES lists only the Icelandic slugs. | Probe: `/cart/ /checkout/ /my-account/ /shop/` all 200 with `<title>Cart/Checkout/...`, no robots meta; local WP has them `publish`. Live may differ (unverified). | Add cart, checkout, my-account, shop to SYSTEM_PAGES (404) or redirect to karfa/gera-upp/min-sida/verslun. | n
- PA-03 | Low | src/pages/api/account/*.ts | No route-level tests for login, logout, lost/reset-password, details, address, contact, the checkout order-cookie/link flow. The refund/limit/timeout branches in details.ts and reset-password.ts are intricate. apiLimits.test.ts covers only cart/products/droppoints/order/checkout limiters. | grep of src/**/*.test.ts: no import of pages/api/account or contact. | Add vitest route tests mirroring apiLimits.test.ts mocks. | n
- PA-04 | Medium | src/lib/account.ts:50,134 (used by edit-account, edit-address, gera-upp, view-order) | getCustomer/getOwnOrder swallow every error into null, so a WooCommerce outage looks like "no address saved", blank edit-account fields, or "Pöntun fannst ekki" (404) instead of 503. orders list correctly 503s. | Code: `.catch(() => ({ data: null }))`. | Let the error propagate or return an unavailable marker; pages call markUnavailable. | n
- PA-05 | Low | src/pages/min-sida/orders/[...page].astro:18 | Page past the last page for a customer who has orders: WC REST answers 400 (rest_post_invalid_page_number), listOrders throws, page shows "þjónustan svaraði ekki" with 503. Probed only the zero-order case (page 99 returns 200 []). The 400 behaviour is WP-core pattern, not probed with a real customer. | wooGet throws on any !ok. | Clamp/redirect to last page or treat 400 as empty. | n
- PA-06 | Low | src/pages/gera-upp/order-received/[id].astro:36 | Any id or key, including a wrong key or a Woo outage, shows "Takk fyrir. Pöntunin þín hefur verið móttekin." Designed as neutral copy, but it asserts success for orders that do not exist. No rate limit on the page-side getOrder (only /api/order has the miss limiter); order keys are unguessable so risk is low. | Probe `/gera-upp/order-received/1/?key=zzz` returns that copy, 200. | Keep, but consider 'Við finnum ekki pöntunina' when a key was supplied and lookup failed. | y (read)
- PA-07 | Low | src/pages/500.astro | `/500/` is a public URL returning real HTTP 500; each hit logs `server error` warn and can inflate 5xx metrics/alerts. | Probe: `/500/` -> 500; `/404/` -> 404 correct. | Make /500/ answer 404 for direct requests (check ctx.request vs error rendering) or accept. | n
- PA-08 | Info | src/middleware.ts:26 | On a thrown error the middleware rethrows before finishResponse, so Astro's 500 page may lack middleware headers/Cache-Control; server.mjs prependListener still adds security headers in prod. Not forced in probe (unverified). | Code reading. | None needed in prod; note for `node dist/server/entry.mjs` preview. | n
- PA-09 | Low | sitemap.xml.ts:11, personuvernd.astro:53 | Sitemap omits /um-okkur/ and /personuvernd/ (footer links personuvernd). Privacy page names the cookie `Cart-Token`; actual cookies are wc_cart_token, mos_order, mos_auth, mos_li (plus localStorage). Prerendered pages also answer slash-less (/um-okkur 200, no 301); canonical is slashed so low impact. | Probe sitemap first 6 static locs; cookie names in cartProxy.ts/auth.ts. | Add both to STATIC_PATHS; correct the cookie text (legal wording is the owner's). | n
- PA-10 | Low | index.astro:3, page/[n].astro | `/?s=` (empty) and `/?s=%20` rewrite to search and return 404 "Þessi síða er ekki til" (WP shows the shop). | Probe both 404. | Redirect empty s to /verslun/. | n
- PA-11 | Info | src/lib/securityHeaders.mjs:64 | `csp:false` option exists for non-document responses but middleware sends CSP-Report-Only on JSON/XML too. Harmless. Also note for enforcement: form-action 'self' is applied to redirect chains of form posts; all current form posts redirect same-origin, checkout is fetch + navigation. | Probe API headers. | None now. | n
- PA-12 | Info | src/pages/leita.astro:7 | `if (target)` is always true (dead conditional), empty template. | Code. | Remove the guard. | n
- PA-13 | Low | src/pages/api/cart/*.ts, cartProxy.ts:64 | (a) GET /api/cart without cookie primes a Woo cart and sets wc_cart_token for every first-time visitor and is unlimited, so cookieless bots each cost a WP call (documented decision: reads unlimited). (b) Cart POSTs have no sameOrigin check; Astro's checkOrigin blocks cross-site form content types (probed 403) and the cookie is SameSite=Lax, so JSON CSRF is not practical. (c) customer.ts passes arbitrary address keys to Store API (Woo validates). (d) respondCart logs up to 300 chars of Store API error data (may echo customer input). | Probe GET /api/cart: 200 + Set-Cookie; form POST to /api/cart/coupon: 403. | Optional: skip priming on GET; allowlist address keys; log code only. | y (read)
- PA-14 | Info | src/pages/api/checkout.ts:52 | linkOrderToSignedIn runs fire-and-forget with retries up to ~2.5 min; server.mjs graceful shutdown waits only for open requests, so a deploy in that window leaves a guest order (documented in account.ts). Otherwise checkout flow reads correct: sameOrigin, 10/min limiter, order cookie httpOnly/Secure/Lax 2h, redirect target allowlist (checkoutRedirect.ts). | Code. | Accept or track in-flight links for shutdown. | y (read only)
- PA-15 | Low | api/contact.ts, droppoints.ts, order.ts, products.ts | (a) Routes use console.warn (9 sites) not lib/logger, so no JSON/redaction. (b) GET on POST-only routes 404, not 405. (c) contact: form-path validation and 429 both redirect to `?error=1` with no message distinction. (d) droppoints passes upstream body through as JSON unvalidated. (e) One probe logged droppoints `ms:1033527` despite a 10 s AbortSignal.timeout; likely host sleep, unverified, a retest returned in 0.1 s. | Preview log; code. | Swap to `log`; re-check timeout if reproducible. | n
- PA-16 | Low | scripts/*.py | crawl_links.py:58 hardcodes :4322 in the same-origin test while BASE defaults to :10026 (absolute same-origin links skipped); verify_content_pages.py hardcodes :4322, has no env override, never exits non-zero, and POSTs a real contact message (sends mail) each run; verify_live_routes.py hardcodes 27 products and category slugs, and its retry loop falls through to an uncaught exception. No coverage of POST/CSRF/404/500/robots. | Code. | Use STOREFRONT_URL everywhere, exit codes, drop or stub the contact POST. | n

## End-to-end path notes

- browse -> filter -> product: verslun/voruflokkur/brand/merkimidar resolve via loadCatalogTerms/loadArchive; outage gives 503 + Retry-After, missing gives 404 (probed 404s for /brand/, /voruflokkur/, page/0). Legacy /vara/, /verslun/<cat>, wrong product paths 301. Product query `status=publish` enforced.
- cart -> checkout -> Straumur -> order-received (read only): token cookie primed in ensureToken, rotated per response; checkout stashes mos_order cookie; order-received uses ?key or cookie, clears cart once (seen flag), polls /api/order (misses limited, found refunded). No defect found beyond PA-06/PA-14.
- sign-in/out/lost/reset/edit: sameOrigin on all, generic failure messages, per-IP and per-customer limiters with take-before/refund-after, safeNext on redirect (probed `//evil.com` redirect ignored by design), tokens revoked on logout. Gaps: PA-03, PA-04.
- contact/wishlist/search/sitemap: contact 400/303 validation probed; wishlist via /api/products (limited); search via `/?s=` rewrite (PA-10); sitemap 3152 locs (PA-09).
- redirects and 404/500: trailing-slash 301 (`//evil.com/x` normalised to `/evil.com/x/`, not an open redirect; probed with backslash too), /utskra/*, /leita OK; PA-01, PA-07.
