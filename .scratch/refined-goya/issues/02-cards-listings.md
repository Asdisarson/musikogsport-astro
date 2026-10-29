# 02 Cards and listings: archive, /verslun/, search, brand, tag, wishlist

Type: task
Status: resolved (approved by the user 2026-10-18; review page: https://claude.ai/artifact/PAj89fHkHy7KKr4gbHk4vC)
Blocked by: 00

## Question

ProductCard changes:
- Full name, clamped to 2 lines with no new wrapper. The `fullTitle` prop is dropped.
- `cardCategories(cats, terms, 2)` in `src/lib/categoryTree.ts`, written test first.
- Images: contain, padding 6%, multiply.
- The sale chip.
- Prices pinned to the bottom so they line up across a row.
- 2 columns at ≤575px.

Archive changes:
- Endursetja only shows when `activeCount > 0`.
- Sticky desktop sidebar; filter type and hairlines.
- Mobile toolbar split into two halves, with 44px rows.
- No bottom gap, and a full-width Load More on mobile.

Keep the selectors that `verify_live_routes.py` and Load More depend on. Shoot `/oskalisti/` with seeded data.

Closes:
- archive: card-image-cropped, titles-cut-to-three-words, mobile-single-column-grid, cats-wrap-misaligns-prices,
  sidebar-not-sticky, gap-below-load-more, mobile-load-more-width, mobile-toolbar-sort-truncated,
  filter-sidebar-hierarchy, sale-badge-copy-shape
- search: titles-cut-to-three-words, image-cover-crops-shoes, mobile-single-column-grid, duplicate-category-names,
  price-baseline-misaligned, flat-caption-hierarchy, sale-badge-style-copy, sort-label-truncated-mobile,
  reset-shown-without-filters, sidebar-empty-column, mobile-filter-tap-targets
- home (checked in 03): card-title-three-word-cut, card-category-noise, sale-badge, card-image-backgrounds

## Answer

Built in `8b47ac3` and fixed after review in `6abe869`. `cardCategories` in `src/lib/categoryTree.ts` was written test
first (4 new tests).

**Gates:**
- vitest 159/159, `astro check` 0 errors, build green
- routes 27/31 and crawl 22, both equal to the baseline
- Load More clicked at 1440 and 390: 27 → 54 cards, no duplicates, columns kept

**Review** (3 reviewers): 21 ids closed and 3 partial. The partial ones:
- filter hierarchy: tightened afterwards
- the sort label at 360: still truncated, as it was before

Confirmed regressions, all fixed:
- the sticky sidebar hid its last group behind a nested scroller. It now has one scroller with scroll shadows, and
  Félag/Lið is reachable.
- focusing a hidden category link scrolled the line sideways. It now uses `overflow: clip`; scrollLeft stays 0 at 390.
- the title focus ring was clipped. The clamp moved onto the link.
- the action-row ring touched the category line. There is now space under the categories.

**Trade-offs shown to the user:**
- lifestyle photos sit framed in the tile
- grey studio backdrops show as a darker inset box
- a one-line title leaves a gap above its categories, which keeps prices aligned across the row

**User decision 2026-10-18:** keep the reserved second title line, so categories and prices stay aligned across each row.
