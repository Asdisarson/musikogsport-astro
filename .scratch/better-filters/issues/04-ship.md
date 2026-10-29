# 04 Consolidated /ship

Type: task
Status: done — READY WITH NOTES (2026-10-26)
Blocked by: 01–03

See map.md.

## Review fixes (2026-10-26, committed `295d7cf`)

Code-review findings F-1…F-18 on `037b2b4`, all fixed except where noted.

- **Size plugin (`wp-mu-plugins/mos-size-index.php`, installed copy byte-identical).**
  - F-1: `mos_size_guarded()` + `mos_size_filter_data_available()` / `mos_size_query_filters_available()` around
    every Woo-internal call on the request path (filter-data hook, size counts, extra counts); a failure is logged
    and the response goes out unchanged. CLI reindex/purge only warn if the cache can't be cleared.
  - F-2: `rest_post_dispatch` flushes only for product writes (`mos_size_is_product_write`: wc/v1–3 products,
    a product, variations, batch); otherwise the flush runs at shutdown priority `PHP_INT_MAX` (after WC's session
    save) behind `fastcgi_finish_request()`. Dirty set processed 200 at a time (`mos_size_process_in_chunks`).
  - F-3b: `mos_extra_counts=1` + `mos_price_ranges=min:max,…` + `mos_sale_count=1` on collection-data return the
    price-preset and Útsala counts in the same request, each via Woo's stock-status counts on a cloned request
    (same code path as the old per-call counts). The global reset moved to its own late hook (priority 1000);
    the size counts switch the size clause off only while counting sizes.
  - F-14: decimals with two digits get a `d` suffix (`12,15` → `12-15d`); no existing term changed (reindex:
    0 products changed, 241 terms identical before/after). F-15: non-scalar `mos_size` parts skipped.
- **Storefront.**
  - F-3a coalesced in-flight collection-data requests; F-3c LRU `createTtlMap`; F-16 bad JSON logged by path.
  - F-3b `archive.ts` uses the plugin field. Without the size plugin (mos/v1/sizes 404, production today) it asks
    for no field and runs the old per-call counts in parallel, as at HEAD; with an older plugin that doesn't answer
    the field, the per-call counts follow the main request (sequential, one extra round trip).
  - F-3d robots: `Disallow: /*?*<key>=` for staerd, verd, utsala, lager, ithrott, brand, team. **Not** kyn or
    product-category: the primary menu links to `?kyn=` and `?kyn=…&product-category=…` listings (17 items).
  - F-4 `initialScroll` (fresh load into one of our entries restores its saved scroll; pagehide saves it; the
    popstate reload fallback saves the target first); entry ids seeded from `history.state` + clock.
  - F-5/F-6/F-7 `toggleFilterHref` rewrites list keys from their parsed values; any well-formed size is passed on
    when the index exists (an unknown one gets a chip, 0 results); `staerd` capped at 60.
  - F-8 `loadSizeTerms` → ok / absent (404) / down; `sizeIndexDecision` → 503 when `staerd` is set and the list
    is down. F-9 popstate sets `pendingUrl`. F-10 `historyAction` replaces when the landed URL equals the entry the
    address bar is on (`location`, not `shownUrl`, so a click during a cut-short Back still pushes). F-11
    `withTimeout` 15 s (AbortSignal.any or a timer) on in-place and Load More fetches. F-12 pagehide closes the
    sheet quietly. F-13 club rule skips sport names and top-level product roots; `HIDDEN_SHOP_CATEGORY_SLUGS`
    = `sale` (NETTILBOD) hidden from Vöruflokkar and the /verslun/ rail; Sumar stays. F-17 `presetBounds` scales
    to the Store API `currency_minor_unit` (learned from product responses, default 0). F-18 title caps at 4 + "+N".
- **Store API calls per cold render** (logging proxy, HEAD vs fix): skor 7 → 2; skor ?brand=nike&kyn=konur 9 → 4;
  skor ?staerd=42&brand=nike&kyn=konur&utsala=1 8 → 4; fatnadur with kyn, brand, product-category, staerd, verd
  9 → 5. Warm (counts hit) 1 → 1. Plugin absent (404): 7/9/8/9 in parallel, as HEAD; field stripped (older
  plugin): 7/9/8/9 with the price/sale counts after the main request. /verslun/ cold was masked by the warm-up.
- **Counts consistency:** `tests/store_api_extra_counts_test.py` (5 contexts, API level) all equal; rendered rail
  counts on 5 combinations equal to the HEAD build (only difference: NETTILBOD no longer listed on /verslun/).
- **Gates:** vitest 29 files / 353 tests (316 + 37); astro check 0 errors 0 warnings 1 hint; build OK;
  `mos_size_normalise_test.php` 121 pass; `mos_size_helpers_test.php` 39 pass; `mos_size_guard_wp_test.php`
  (wp eval-file) ALL PASS; `store_api_size_test.py` 19 pass; `store_api_and_cat_test.py` pass;
  `store_api_extra_counts_test.py` 19 pass; verify_live_routes 31 PASS; crawl_links OK; bf03-probe 167 PASS
  (as in 03); bf03-sort and bf03-extra (12) ALL PASS; `filters-audit/bf04-probe.mjs` 18 PASS (F-4, F-4 reload,
  F-9, F-9 + F-10 re-tick during Back, F-10, F-11, F-12, console clean), of which F-4 reload, F-9, F-10, F-12
  fail on the HEAD build; F-8 fault injection: size list down → `?staerd=` 503, plain 200; plugin absent →
  `staerd` ignored. Rendered rail counts equal to HEAD on 5 combinations with the plugin present and absent.
- **Not as specified:** F-3d leaves `kyn` and `product-category` crawlable (menu entry points; the orchestrator's
  call: add `Disallow: /*?*kyn=` and `Disallow: /*?*product-category=` to block them too). F-13 hides NETTILBOD
  from Vöruflokkar on brand, tag and search archives as well, not only on /verslun/.
- **Untested here:** F-2 under php-fpm (`fastcgi_finish_request` doesn't exist in CLI; no orders allowed). F-17's
  minor unit is learned from product responses, so the first render after a start assumes 0 (right for ISK).
- **Open:** in Chromium a Back across a product page into an earlier filter entry is a same-document popstate,
  so the F-4 fresh-load path shows only on reload / reload fallback there (WebKit not installed to check Safari).

## Ship verdict — READY WITH NOTES (2026-10-26)

Commits: `0d5545c` (01), `3df4654` (02), `037b2b4` (03), `295d7cf` (review fixes F-1…F-18), `80c8ca7` (polish). Not pushed.

Stages: /code-review (18 findings, all fixed) → /polish + /x-ray + /cleanup (`80c8ca7`, behaviour-preserving)
→ /security-review (0 High/Medium; 3 Low accepted) → /verify.

Final gates at `80c8ca7`: vitest 353/353 (29 files); astro check 0 errors (1 old hint); build OK; PHP normaliser 121,
helpers 39; Store API size 19, extra counts 19; installed mu-plugin byte-identical; verify_live_routes 31 PASS 0 FAIL;
crawl_links OK; Playwright bf03-probe / bf03-extra / bf03-sort / bf04-probe ALL PASS.

Notes (accepted, not blocking):
- Security Low: `mos_extra_counts` fans out to ≤9 count queries per unauthenticated request (ranges capped at 8);
  rate-limit / WAF `collection-data` in production. `mos/v1/sizes` is public read-only by design. Raw SQL in the
  plugin takes only intval'd ids and internal taxonomy names.
- X-ray left: `optimistic()` in ArchiveView hard-codes the single-valued keys mirrored in `liveFilters.ts`
  `SINGLE_KEYS`; `closeSheetQuietly` repeats part of `setFilters`; `mos_size_counts_field` final `array_map` only
  fixes key order.
- Out-of-repo probe `bf02-probe.mjs` has a stale `[data-filters-close]` locator (4 matches since the sheet redesign).
- Robots: `kyn` and `product-category` stay crawlable (17 menu links); other filter keys disallowed.
- Safari/WebKit not tested (not installed); F-2 shutdown flush not tested under php-fpm.

Production steps (owner, when this merges):
1. Upload `wp-mu-plugins/mos-size-index.php` to `wp-content/mu-plugins/`.
2. Run `wp mos-size reindex` once (later saves keep it in sync).
3. Check `woocommerce_price_num_decimals` is 0 for ISK.
4. Deploy the storefront. Without the plugin the storefront falls back to the old counts and ignores `staerd`.
