# 06 Product page

Type: task
Status: done (READY WITH NOTES)
Blocked by: 02, REST key (user action)

## Question

Changes:
- Swatches:
  - grid at 38px tall (44px on mobile)
  - selected swatch filled #181818 with white text
  - focus ring
  - no duplicate tooltip
  - colon fixed
- Price 24/500, the badge chip, and meta as a 2-column grid.
- Mobile: quantity and add-to-cart on one row; title 26px.
- Gallery: uniform contain tiles, and a lone last image spans the row.
- Description hairline, related-heading rule, related arrows on mobile.
- Add to cart: render-only "Veldu stærð" guidance. The aria-disabled variant goes on the review page as a question.

Closes: the remaining pdp ids.

## Status note 2026-10-18

Still blocked: product pages answer 503 on :4323 because WooCommerce has no REST API key. The user asked to carry on
through every area; this one was not styled blind. Next step after the key is restored in wp-admin and `.env`: build
it, then run a delta /ship over it.

## Status note 2026-10-19: built (uncommitted; orchestrator verifies and commits)

The REST key works locally (wc/v3 200), so PDPs render. Built, presentation only; cart and money path untouched:
- Swatches: equal-cell grid (auto-fill, min 64px), 38px tall (44px below 992px), field-border edge, the chosen one
  filled #181818 with white text, a 2px ink focus-visible ring, sold-out cells lighter with the red cross. The
  data-tip attribute and its tooltip CSS are gone (the cell text is the name). Label reads "Stærðir: 36".
- Price 24/500 (del 18/400). The PDP badge shares the card chip's declarations via :is(.badge--sale, .pdp-badge),
  text still from formatSaleBadge. Meta is a label/value 2-column grid (data-pdp-sku stays on the value).
- Phones: title 26px; quantity (128px, 44px stepper buttons) and add to cart on one row.
- Gallery: uniform 1:1 contain tiles on #f6f6f6; at >=992px a lone last image spans the row at 2:1.
- Hairline above the long description, rule under "Tengdar vörur", related arrows on phones (dead ends hidden).
- Add to cart: until every attribute is chosen the button is disabled in solid grey (#ddd, #585858 text) with a
  static hint, "Veldu stærð" ("Veldu valkost" for a non-size attribute), linked by aria-describedby. The pure
  helper choiceHint() in src/lib/variations.ts was written test first (4 tests). The busy state keeps the fade.

Gates: vitest 176/176 (172 + 4), astro check 0 errors, build OK, routes 31/31 PASS, crawl OK (0 failures),
PDP overflow 0 at 1440/390/360 (hoka, nike-fast-buxur-graenar, nike-gamma-force-low).
Shots: harness/shots/area06-before (feat/live-clone on :10026, GET-only pages), harness/shots/area06 (full set),
harness/shots/area06-probe (element crops). New probes: pdp-probe.mjs, pdp-overflow-find.mjs, find-pdps.py,
cmp-metrics.py.

Open questions for the review page:
- The aria-disabled-with-click variant (button stays focusable, a click explains the missing size) was NOT built.
- New copy "Veldu valkost" for non-size attributes: keep or veto?
- The disabled button is solid light grey rather than faded black; it departs from the shared opacity rule on
  purpose (the faded black read as enabled).
- The gallery's 1:1 tiles letterbox wide photos (the first image is taller than live's natural-ratio one).
