# Audit: lib-catalog (src/lib: catalog, browsing, filters, images, shared infrastructure)

Reviewer scope: HEAD e93d8b5, read-only. `npx vitest run src/lib`: 39 files / 457 tests pass.
Probes: preview on 127.0.0.1:4332 (killed afterwards), plus node snippets over the pure modules. The local WordPress
(localhost:10025) was UP for the first probe and went DOWN mid-audit (Local's GraphQL API was unreachable, so the
start script did nothing). So browse/filter/product could not be probed against live data: every `/verslun/*` and
`/voruflokkur/*` probe returned the degraded 503 page. That degraded path was itself checked (see Paths).

## Files taken

Taken (every non-test file in `src/lib` plus its test, except the area-3 set below):
`allowedHosts.mjs`, `archive.ts`, `archiveNav.ts`, `brand.ts`, `cache.ts`, `cachePolicy.ts`, `catalogTerms.ts`,
`categoryTree.ts`, `decode.ts`, `dismiss.ts`, `facets.ts`, `format.ts`, `frontPage.ts`, `gridNav.ts`, `homeLayout.ts`,
`http.ts`, `img.ts`, `jsonld.ts`, `liveFilters.ts`, `logger.ts`, `megaMenu.ts`, `menuPanels.ts`, `paths.ts`,
`photoBg.ts`, `photoBgServer.ts`, `price.ts`, `productCard.ts`, `rateLimit.ts`, `responseHeaders.ts`, `safeUrl.ts`,
`sanitize.ts`, `securityHeaders.mjs`, `serial.ts`, `siteChrome.ts`, `storeCatalog.ts`, `storeMap.ts`, `text.ts`,
`types.ts`, `validate.ts`, `variations.ts`, `visitor.ts`, `woo.ts`, `wp.ts`, `wpbakery.ts`, and `apiLimits.test.ts`,
`mediaHost.test.ts` (cross-cutting tests).

Left to area 3 (cart / checkout / auth / account / order / contact / wishlist): `account*.ts`, `auth.ts`, `cart*.ts`,
`checkoutRedirect.ts`, `droppointStore.ts`, `orderAmounts.ts`, `shippingBar.ts`, `storeApi.ts` (read for context only,
no findings), `wishlist.ts`. `serial.ts` and `validate.ts` is mine (it is shared); its `passwordProblem`
was read and is clean. `woo.ts` is mine whole, including `getOrder`/`wooSend` (order lookup is area-3 flavoured, so I
only judged their library side).

## Per-file table

| file | lines | verdict | findings |
|---|---|---|---|
| allowedHosts.mjs (+test) | 34 | clean (exact hostnames only, regex-validated, tested for wildcard/port/scheme) | |
| archive.ts | 274 | findings; no unit test for `loadArchive` | LC-07, LC-08, LC-14 |
| archiveNav.ts (+test) | 112 | clean (pure, well tested) | |
| brand.ts | 35 | findings (info) | LC-17 |
| cache.ts (+test) | 74 | clean (SWR + failure memo + LRU map correct; `console.warn` only) | LC-06 |
| cachePolicy.ts (+test) | 39 | clean for its logic; sitemap interplay noted | LC-18 |
| catalogTerms.ts (+partial test) | 136 | findings | LC-03, LC-09, LC-10, LC-14 |
| categoryTree.ts (+test) | 121 | clean (cycle guards present; tie-break deterministic) | |
| decode.ts | 30 | findings (info); no test | LC-14, LC-21 |
| dismiss.ts | 7 | clean (djb2 key, no test needed) | |
| facets.ts (+test) | 167 | clean | |
| format.ts | 28 | clean; no test | LC-14 |
| frontPage.ts | 73 | findings; no test | LC-14, LC-15 |
| gridNav.ts (+test) | 32 | clean | |
| homeLayout.ts (+test) | 80 | findings (info) | LC-15 |
| http.ts (+test) | 77 | findings | LC-01, LC-20 |
| img.ts (+test, mediaHost.test) | 54 | clean | LC-23 |
| jsonld.ts | 81 | clean (`<` escaped); no test | LC-14 |
| liveFilters.ts (+test) | 275 | findings | LC-05, LC-07, LC-08 |
| logger.ts (+test) | 82 | clean (redaction pattern covers key/secret/token/password params) | LC-06 |
| megaMenu.ts, menuPanels.ts (+tests) | 51 / 38 | clean | |
| paths.ts (+test) | 94 | findings (info) | LC-12 |
| photoBg.ts (+test) | 482 | findings | LC-11 |
| photoBgServer.ts | 87 | clean (size cap, pixel cap, redirect refused, host allow-list via `isMediaFile`); no test | LC-14 |
| price.ts (+test) | 46 | clean (text only; entities decoded, tags stripped); `cardPriceText` untested | LC-14 |
| productCard.ts (+test) | 72 | clean | |
| rateLimit.ts (+test) | 52 | clean (see LC-19 for the per-process note) | LC-19 |
| responseHeaders.ts (+test) | 35 | clean | |
| safeUrl.ts (+test) | 43 | clean | |
| sanitize.ts | 34 | clean config (tags/attrs/schemes/styles locked down); NO test | LC-14 |
| securityHeaders.mjs (+test) | 77 | clean (report-only CSP is a decided item) | |
| serial.ts (+test) | 12 | clean | |
| siteChrome.ts | 112 | findings; no test | LC-14, LC-16 |
| storeCatalog.ts (+Cap test) | 261 | findings | LC-03 |
| storeMap.ts (+test) | 71 | clean | |
| text.ts (+test) | 38 | dead code (`truncateWords`) | LC-17 |
| types.ts | 278 | clean (orphan doc comment line 235) | LC-17 |
| validate.ts (+test) | 35 | clean | |
| variations.ts (+test) | 99 | clean (matches WooCommerce first-match-in-menu-order) | |
| visitor.ts | 11 | clean; no test | LC-14 |
| woo.ts (+test) | 306 | findings | LC-04, LC-13, LC-14 |
| wp.ts | 47 | findings; no test | LC-03, LC-14 |
| wpbakery.ts (+test) | 137 | findings | LC-02 |

## Findings

Format: ID | severity | file:line | issue | evidence | suggested fix | money-path?

| ID | sev | file:line | issue | evidence | suggested fix | money |
|---|---|---|---|---|---|---|
| LC-01 | Low | lib/http.ts:76 (used by pages/api/account/login.ts:19,32) | `safeNext` accepts any non-whitespace, non-backslash character after a single `/`, so values the `Response` constructor refuses as a `Location` header pass it: non-Latin-1 (`/€`) and NUL. After a successful sign-in the cookie is already set (`setAuth`, login.ts:31) and then `redirect(next, 303)` throws, so the shopper sees a 500 although they are logged in. Self-inflicted only (the field is a hidden form value), hence Low. | Probe: `new Response(null,{status:303,headers:{Location:'/€'}})` throws "Cannot convert argument to a ByteString"; `'/\u0000x'` throws "invalid header value". `safeNext('/\u0000x','F')` returns the value unchanged. Other C0 controls (`\u0001`) are accepted too. | Tighten to printable ASCII `^\/(?![/\\])[\x21-\x7e]*$` (or round-trip through `new URL(v,'https://x').pathname+search`, which percent-encodes). Add the cases to http.test.ts. | n (auth redirect) |
| LC-02 | Low (latent) | lib/wpbakery.ts:105-114 | `[vc_row_inner]`/`[vc_column_inner]` are handled like top-level rows, and closing `[/vc_row_inner]` sets `row = null`. Everything after an inner row in the same outer column (text after it) and every following outer `[vc_column]` is dropped: `[vc_column]` needs `row`, which is null, so `col` becomes null and its blocks are lost. Static reading; I did not execute it. None of the four content pages on the local site (hafa-samband, skilmalar, opnunartimi, staerdir) contains `vc_row_inner` (0 hits), so nothing is lost today. | Trace: `[vc_row][vc_column 1/2]A[vc_row_inner][vc_column_inner]B[/vc_column_inner][/vc_row_inner]C[/vc_column][vc_column 1/2]D[/vc_column][/vc_row]` gives rows R1, R2(B); C and D are never emitted. No test covers inner rows (wpbakery.test.ts). | Track depth: restore `row`/`col` to the outer ones when an inner element closes, or nest inner rows as a block. Add a test. | n |
| LC-03 | Low | lib/storeCatalog.ts:90-112, 184-219; lib/wp.ts:24-46; lib/catalogTerms.ts:44 | No failure memo / circuit breaker on `storeProducts`, on a failed `collectionCounts` (failures are not cached; only the cold budget of 240/min caps it), or on `getWpPage` (no in-flight de-dupe either: concurrent cold requests for one slug each fetch). While WordPress is slow (not down) every request pays 5-6 s per call and keeps a PHP worker busy, which the cold budget was meant to prevent. `createCachedLoader` already has the right behaviour for the terms, front page, chrome. | Probe, WP down: each `/verslun/` request logged 3 plain-text `[store-catalog] collection-data transport failure` lines, i.e. 3-4 upstream attempts per page view with no memo (fast here because the connection was refused; a hang would cost 6 s each). | Remember a failed counts URL for ~15 s (store `null` in the TTL map with a short TTL); de-dupe `getWpPage` per slug and memo failures like `failMemoMs`. | n |
| LC-04 | Low | lib/woo.ts:256-283 | `runSweep` is a third hand-rolled stale-while-revalidate (see duplicates). Its failure path serves the stale sitemap but never records the failure time: with `c.at` stale, every later request re-runs the 7 s sweep (sequential requests; only concurrent ones share it). A crawler during a Woo outage repeats it. | Code: `.catch(e => { if (c.val !== null) return c.val; throw e; })` with no `failedAt`, and the guard at 266 re-enters on every call. | Replace with `createCachedLoader({ load, ttlMs: SITEMAP_TTL, failMemoMs: 60_000 })` (also removes the duplicate). | n |
| LC-05 | Low | lib/liveFilters.ts:148-164 | `parseLiveFilters` caps only `staerd` (60). `s` (search) and the comma lists have no length cap; `s` is sent straight to WooCommerce search (`storeCatalog.ts:62`) and into the page title. Bounded only by Node's ~16 KB header limit. Term lists are harmless (unknown slugs are dropped in `resolve`). | Probe: a 5000-char `s` and 5000 `brand` values parse unchanged (`search.length 5000`, `brand.length 5000`; `staerd` truncated to 60). | Cap `s` (e.g. 100 chars) and each list (e.g. 50) in `parseLiveFilters`. | n |
| LC-06 | Low | lib/cache.ts:34, catalogTerms.ts:76, storeCatalog.ts:80,84,244, wp.ts:43, photoBg.ts:426 (+ about 15 more in pages/ and lib/) | logger.ts promises one redacted JSON line per event, but the catalog libs still use bare `console.warn`. Output is plain text mixed into the JSON stream (a log viewer filtering on `level` misses them) and skips `redactSecrets`. The messages carry no secret today (only paths/slugs, no query), so this is consistency, not a leak. | Probe log showed `[store-catalog] collection-data transport failure: fetch failed` lines interleaved with `{"time":...,"level":"warn",...}` lines. 15 occurrences of `err instanceof Error ? err.message : ...` (grep). | Route them through `log.warn(msg, {err})`; export logger's `errText`. | n |
| LC-07 | Info | lib/liveFilters.ts:202, lib/archive.ts:110 | An explicit `product-category=` (or `brand=`) in the URL replaces the archive's own scope (`pc.ids.length ? pc.ids : baseCategoryId`, `filter.brandIds ?? scopeBrand`), so `/voruflokkur/skor/?product-category=fatnadur` lists clothing under the Skór URL/title. The rail only offers children of the scope, so only hand-built URLs do it. Not probed (WP down). | Static reading. | If scope must hold: intersect via `andCategoryIds`, or drop `product-category` values outside the scope subtree. Otherwise document as intended (it mirrors live). | n |
| LC-08 | Info | lib/liveFilters.ts:167-178, lib/archive.ts:88 | A filter slug that matches no term (typo, or a term created in the last 10 minutes, before the terms cache refreshes) is dropped silently: the page shows unfiltered products with no chip and a 200. With `sizeIndexDecision` `absent`, `staerd` is likewise ignored. By design (comments say so); the 10-minute terms staleness is the avoidable part. | Static reading. | Optional: treat a fully unknown slug as 404/noindex, or force a terms refresh on a miss (rate-limited). | n |
| LC-09 | Low | lib/catalogTerms.ts:65-67, 13 | The Félag/Lið terms are required (a failure fails the whole sweep) and fall back to hard-coded attribute id 5 when the attribute isn't in the list; the Íþrótt terms are optional. On a site where `pa_felag-lid` is missing or renumbered (a fresh DO deploy against a different WP), `getAll('/products/attributes/5/terms')` 404s, the whole sweep fails and EVERY category/brand/tree becomes `degraded` (503 for any filter URL, empty menus' counts), permanently. | Code: `attributeIdFor(..., fallback)` returns the fallback when the list was read but lacks the taxonomy; `teamTerms` does not catch. | Treat team like sport (optional, failure leaves the group out), or log a distinct error. | n |
| LC-10 | Info | lib/catalogTerms.ts:48,92 | `getAll` stops at 20 pages (2000 terms) without saying so; tags (`/products/tags`) are swept every 10 min though only the tag archive uses them (+1 to 20 requests per sweep). | Code. | Warn when the cap is hit; load tags lazily. | n |
| LC-11 | Low | lib/photoBg.ts:447-451 | When the re-sample of an EXPIRED entry fails (media host blip), the error handler overwrites the previous good reading with `null` for 10 min (`entries.set(job.key, null, errorTtlMs)`), so tiles whose padded colour was known flip back to the default tile (a visible grey box in the tile) until the next successful sample. A stale value is exactly what `lookup` could keep serving. | Static reading of `pump` + `lookup` (hit.fresh false -> resample -> error -> null). | On error keep the stale value: `entries.set(key, previous ?? null, errorTtlMs)`. | n |
| LC-12 | Info | lib/paths.ts:61-68 | `slashRedirect('//evil')` returns `//evil/` (protocol-relative) at the library level; only the front controller makes it safe. Probe of the running server (4332): `GET //evil.com/x` -> `301 location: /evil.com/x/`; `///evil.com/x` -> `/evil.com/x/`; `/%2F%2Fevil.com/x` stays encoded. Not exploitable today; the guard lives in Astro, not in this function. | Probe results above; node: `slashRedirect('//x')` -> `//x/`. | Add `if (pathname.startsWith('//')) return null` plus a test. | n |
| LC-13 | Low | lib/woo.ts:217-219 with pages/api/order.ts:26-32 | `getOrder` turns an outage (network/5xx) into `null` exactly like "wrong key", so `/api/order` answers 404 and does NOT refund the miss slot. The thank-you poll (up to 8 tries, 3 s apart) therefore burns up to 8 of the visitor's 20 misses/15 min during a WordPress blip; two such views lock the shopper out of their own receipt poll with 429. The receipt page itself degrades to neutral copy (fine). | Code: `catch { return null; }`; api/order.ts `if (order) misses.refund(...)`. | Return a tri-state (`found`/`not-found`/`unavailable`); refund + 503 on unavailable. | y (order-received status) |
| LC-14 | Medium | missing tests (see list) | Security- and logic-heavy modules have no unit tests of their own: `sanitize.ts` (XSS sanitiser for set:html: product descriptions, price_html, WP content), `getOrder` real implementation (the order_key IDOR gate: apiLimits.test only mocks it), `loadArchive` (190 lines assembling every facet group), `decode.ts`, `format.ts` (`formatISK`), `price.cardPriceText`, `brand.splitBrand`, `jsonld.ts`, `visitor.ts`, `siteChrome.ts`, `frontPage.ts`, `wp.ts`, `catalogTerms` sweep/`getAll` paging, `getProductsByIds` batching, `listAllProductSlugs`, `photoBgServer`. | `grep -lw <name> *.test.ts` gives no test for: loadArchive, splitBrand, decodeEntities, formatISK, scaleMinor, sanitizeHtml, productLd, breadcrumbList, visitorKey, getWpPage, loadSiteChrome, loadFrontPage, messageKey, stripShortcodes, cardPriceText, listAllProductSlugs. | Add: sanitize (script/onerror/javascript:/style/srcset/data: stripped; text-align kept; rel added), getOrder (wrong key, right key, outage), loadArchive with a mocked store (scope, degraded, toggles), formatISK/decode. | y for getOrder |
| LC-15 | Low | lib/homeLayout.ts:53-54, lib/frontPage.ts:64 | `fetchFrontPage` casts the JSON to `FrontPage` with no shape check; `planHome` calls `hero?.heading.trim()`/`hero?.text.trim()` so a missing `heading`/`text` (older mu-plugin, ACF field removed) throws TypeError and the home page 500s. `siteChrome` also dereferences `front.campaign.text`, `front.footer.*`. The mu-plugin presumably always sends them (not verified, WP down). | Static reading. | Default missing fields in `fetchFrontPage` (a small normaliser) so one absent field can't 500 every page (the chrome is on all pages). | n |
| LC-16 | Low | lib/siteChrome.ts:79 | The chrome is all-or-nothing: if the front-page call fails (`loadFrontPage()` null) `fetchChrome` throws even when both menus loaded, and on a cold start the whole site renders `FALLBACK` with EMPTY primary and footer menus. | Code: `if (!front) throw new Error('front-page unavailable')`. | Build the chrome with menus + FALLBACK campaign/footer when only front-page is missing. | n |
| LC-17 | Info | lib/text.ts:35, lib/types.ts:235, lib/brand.ts:12,16 | Dead/untidy: `truncateWords` has no production caller (tests only; the comment says kept on purpose); orphan doc comment `/** Store API error body shape. */` above `ProductSummary`; `Mizuno` listed twice in BRANDS; generic words (`Select`, `Head`, `Zone`, `Craft`, `On`) as brand prefixes can mislabel a product named e.g. "Select ..." (no evidence of an actual miss). | Greps. | Remove the dead bits; keep brand list data-driven (the product has a `brands` term; splitBrand is only the fallback). | n |
| LC-18 | Info (unverified) | pages/sitemap.xml.ts:57 vs lib/cachePolicy.ts:3-9 | cachePolicy's own header says App Platform's CDN caches a response whose Cache-Control allows it and holds it until the next deployment. The sitemap route keeps an explicit `public, max-age=21600` (and `public, max-age=300` when degraded), which cachePolicy passes through ("keeps an explicit public policy"). If the CDN really holds until deploy, a degraded static-only sitemap could freeze. I did not verify the CDN behaviour. Also `listAllProductSlugs` uses REST v3 (no catalog_visibility filter), so catalog-hidden published products are listed. | Reading both files. | Decide with the owner: either `no-cache` for the sitemap too or confirm purge-on-deploy semantics; filter hidden products. | n |
| LC-19 | Info | lib/rateLimit.ts, storeCatalog.ts countsCache/coldBudget, cache loaders | All limiters and caches are per process; with more than one instance (App Platform scaling) every limit multiplies by the instance count (checkout 10/min, cold-count budget 240/min). DEPLOY.md is single-instance. Noted, not a defect now. | Code. | Keep `instance_count: 1` in the spec, or document. | n |
| LC-20 | Info | lib/http.ts:22-25 | `sameOrigin` passes a request with no `Origin` header (documented: "browser-sent Origin must be our own"). Modern browsers send Origin on cross-site POSTs, so this is defence in depth, but `Sec-Fetch-Site: cross-site` is not consulted as a fallback. | Code. | Optionally also reject `Sec-Fetch-Site: cross-site`. | n |
| LC-21 | Info | lib/decode.ts:26 | `decodeEntities('&#0;')` yields a NUL character (also other C0 controls); decoded text is used for names/labels, not headers, so harmless today. | node probe: `["&lt;","\u0000","😀"," x","&AMP;"]` (note `&amp;lt;` -> `&lt;`, correct single-pass). | Map code points < 0x20 (except tab/newline) to the original match. | n |
| LC-22 | Info | lib/cache.ts:42-50 | A stale value is served indefinitely when refreshes keep failing (no max-stale age): after a multi-day WordPress outage categories/brands/prices-chrome are days old. Intentional ("stale beats empty"). | Code/test "keeps the stale value through a failed refresh". | Optional hard limit (e.g. 24 h) after which `degraded` is reported. | n |
| LC-23 | Info | lib/img.ts:13-20, securityHeaders.mjs:24, server.mjs, photoBg.ts:297 | The media origin is derived in four places with different validation (`normaliseMediaBase` falls back to production for junk; `mediaOrigin` returns null; server.mjs uses the raw runtime env with a default; `photoBg.MEDIA_HOST`). Build-time (img.ts, inlined) vs run-time (server.mjs) values can disagree if the runtime env differs from the build's. `isMediaFile` only accepts https, so photoBg is silently off for an http media base (local WordPress): fine, but worth knowing. | Code. | One helper in `securityHeaders.mjs` (already shared) used by all. | n |

## Duplicate-function review (by reading `src/lib`; no tooling beyond grep)

| # | duplicate | where | recommendation |
|---|---|---|---|
| D1 | Stale-while-revalidate cache with in-flight de-dupe, written 3 times | `cache.createCachedLoader`, `woo.runSweep/SweepCache`, partly `photoBg.createPhotoBgCache` + `wp.getWpPage` (manual TtlMap + stale) | Use `createCachedLoader` for sitemap sweeps (also fixes LC-04) and for per-slug WP pages. |
| D2 | "fetch JSON with `AbortSignal.timeout` and `res.ok` check" | `catalogTerms.fetchJson` (6 s), `storeCatalog.catalogFetch` (6 s), `frontPage` (5 s), `siteChrome.getJson` (5 s), `wp.getWpPage` (5 s), `woo.wooGet` (5 s), `photoBgServer` (4 s) | One `upstream.ts` helper (timeout, status check, logging, redaction). |
| D3 | Icelandic plural rule `n % 10 === 1 && n % 100 !== 11` | `facets.countWord`, `productCard.colourLabel` | `isSingular(n)` helper. |
| D4 | `err instanceof Error ? err.message : String(err)` | 15 occurrences in lib and pages; `logger.errText` is the private original | Export and reuse `errText` (see LC-06). |
| D5 | Media origin derivation | see LC-23 | one function. |
| D6 | Category-tree walks and Kyn lookup | `categoryTree.childrenOf/categoryChain`, `facets.pseudoCategoryIds` (own walk), `archive.tree`, `railCategoryLinks`; Kyn parent found in `liveFilters.toStoreFilter` (filter by parent) and `archive.ts` (childrenOf) | Acceptable (different purposes); low priority: use `childrenOf` in `toStoreFilter`. |
| D7 | `console`-style warn-once/once-a-minute throttles | `woo.authParams` (lastMissingLog), `storeCatalog` (lastCapWarn), `photoBg` (lastWarn) | small `warnEvery(ms)` helper. |
| D8 | Positive-int / id guards | `validate.isPosInt` is used widely, but `pages/api/account/reset-password.ts:23` and `storeCatalog.ts:103` hand-roll `Number.isInteger(..) && > 0` | use `isPosInt`. |

No semantic duplicates found for money formatting (`formatISK` is the only one; `liveFilters` labels are static text), URL
safety (`safeHref`/`safeIframeSrc`/`safeNext` serve different jobs), or HTML sanitising (single `sanitizeHtml`; every
`set:html` of WP/Woo content goes through it, checked in PriceTag, WpContent, verslun/[...path].astro; JSON-LD uses `ld()`).

## End-to-end path notes (browse -> filter -> product, lib side)

1. Request enters `middleware.ts`: `slashRedirect` (paths.ts) for slash-less page GETs, then `finishResponse`
   (responseHeaders -> cachePolicy + securityHeaders). Probed: 503 pages carry `Cache-Control: no-store`; `/leita/?s=nike`
   301s (legacy route).
2. Archive pages call `loadArchive(params, page, scope)`: terms + size index come from `createCachedLoader` caches (10 min,
   15/60 s failure memo). `parseLiveFilters` -> `toStoreFilter` -> `StoreQuery` -> `storeProducts` (grid, never cached) and
   `collectionCounts` (30 s URL-keyed cache, in-flight de-dupe, 240 cold/min budget). Degraded terms with a slug filter, or
   `staerd` with a down size list, answer `unavailable` -> 503 rather than unfiltered products (verified in code and by the
   observed degraded pages). Group assembly (`facets`, `categoryTree`) is pure and well covered; `loadArchive` itself is not.
3. Filter clicks: `archiveNav.applyOp` composes on the pending URL using the same `toggleFilterHref` helpers the
   no-JS links use (single-valued keys replaced, lists rewritten from parsed values, always page 1). Verified by node probe:
   `brand=a&page=3&s=x` + toggle brand b -> `?brand=a%2Cb&s=x`; `verd=0-5000` + `5000-10000` -> replaced.
4. Product cards: `storeMap.mapStoreProduct` (prices scaled by `currency_minor_unit`, variable parents show "frá"),
   `price.cardPriceText/salePercent`, `img.productImage/mediaUrl/mediaSrcset`, `photoBgServer` (never blocks a render),
   `categoryTree.cardCategories`. The PDP uses `woo.getProductBySlug/getVariations/getProductsByIds` (REST v3 with the key
   pair; logged errors are redacted and the key is read lazily), `variations.*` for swatches, `sanitize.sanitizeHtml` for
   description/short description/price_html, `jsonld.ld` for structured data. The full `WooProduct` (REST, un-trimmed) is
   fetched for the PDP; which fields reach the client islands is a pages/components question (not probed: WP down).
5. Outage behaviour observed on 4332 with WordPress unreachable: every catalog URL answers 503, `no-store`, with the
   "Tímabundin bilun" page; a log line per failed upstream call (LC-03/LC-06). The server stayed up.
6. Not probed because WordPress went down: page beyond `totalPages` (what Store API returns for `page=99999`), the real
   facet counts, size index. Unverified: whether Store API `products?page=<too big>` returns 400 or `[]`; `archive.ts`
   would treat a 400 as `result === null` -> 503.
