# Map: musikogsport "Refined Goya" appearance pass

Label: wayfinder:map · Tracker: local markdown (`.scratch/refined-goya/`)

## Destination

The storefront keeps live musikogsport.is's brand (logo, palette hues, Jost) but looks visibly more polished on
every page at 1440 and 390: full product names, uncropped product photos, a 2-column mobile grid, legible greys
and form edges, a clear totals hierarchy, Icelandic copy throughout, and none of the defects the 2026-10-16 audit
found. Every area is approved by the user from before/after screenshots.

## Notes

- **Execution is carried into this map**, as in `.scratch/live-clone/`. Each ticket is one area of type `task`.
  Each area ends with gates, a harness run on the production preview (:4323), a critique and verify pass, a
  private before/after review page, a `wip:` commit (never a Co-Authored-By trailer) and the user's approval.
  One consolidated /ship comes at the end (ticket 08). Push only when the user says.
- Plan: `~/.claude/plans/velvety-meandering-flamingo.md`.
- Evidence in `~/.claude/jobs/3b134443/tmp/`:
  - `appearance-audit.json`: 136 findings verified by two verifiers each
  - `appearance-synthesis.md`
  - `shots/now/`
  - `rg-baseline-routes.txt` and `rg-baseline-crawl.txt`
- **Baseline at `37af690`:**
  - vitest 148/148; `astro check` 0/0 with 1 hint; build green
  - routes 27/31
  - crawl: 22 failures
  - Every failure is a product page answering 503 because WooCommerce has no REST API key (a user action).
    Later areas are judged only on new failures.
- Harness: `harness/` (Playwright 1.64.1, its own `package.json`, not part of the app). Shots go to
  `harness/shots/` (gitignored).
- Live site: read-only visual reference, visitor GETs only. Never Straumur, never production.

## Decisions (from /grill-me, 2026-10-16)

1. **Direction: Refined Goya.** Keep live's brand and polish everything around it.
2. **Scope:** all pages, 1440 + 390, mostly through shared CSS and components. **Deferred:** sticky mobile bars,
   collapsible checkout summary, inline validation and busy states, results-scoped facets, result-count bar,
   filter chips, payment marks. No new behaviour on the money path.
3. **Fixed:** logo, palette hues, Jost. Buttons stay square and black, with full states. Campaign bar: clean
   wrap on mobile, no JavaScript. Menu items stay as WordPress data.
4. **Review:** one area at a time, from before/after pages.
5. **Card images:** the whole product (contain, padding, multiply).
6. **Mobile listings:** 2 per row.
7. **Contrast:** darker same-hue shades where WCAG AA fails.
   - On white: `#767676` meta text, `#949494` field borders.
   - On grey panels: `#686868` meta text, `#8a8a8a` field borders.
   - Sale chip: white on `#c8372d`.
   - Sale price stays `#ef5c5c` (accepted exception).
8. **Copy:** leftover English becomes Icelandic, with a veto table at the area 0 review.
9. **Delivery:** branch `feat/refined-goya` in a worktree, dev server :4322, production preview :4323.
10. **Was blocked:** areas 06 and 07 needed the WooCommerce REST key (unblocked 2026-10-19).

## Tickets

- [00 Foundation](issues/00-foundation.md): tokens, shared controls, copy
- [01 Shell and overlays](issues/01-shell.md)
- [02 Cards and listings](issues/02-cards-listings.md)
- [03 Home](issues/03-home.md)
- [04 Cart and checkout](issues/04-cart-checkout.md)
- [05 Content, contact, errors, login](issues/05-content-login.md)
- [06 Product page](issues/06-pdp.md) (blocked: REST key)
- [07 Account, thank-you, view-order](issues/07-account.md) (blocked: REST key)
- [08 Consolidated /ship and hand-off](issues/08-ship.md)

## Decisions so far

- [00 Foundation](issues/00-foundation.md): approved 2026-10-16 with no vetoes. Contrast tokens, 1px field
  borders with an ink focus ring, 20px checkboxes and radios, unified buttons, Icelandic copy (Millisamtala, Sía, -55%
  …). Contrast failures went from 3,345 to 462.
- [01 Shell](issues/01-shell.md): approved 2026-10-16. The phone campaign bar keeps ranges and addresses
  whole, stacks and is 78px (was 93/120). Store notice 7.7:1, phone footer on the 20px gutter. **The campaign text stays
  white (2.71:1), an accepted exception, by the user's choice.**
- [02 Cards and listings](issues/02-cards-listings.md): approved 2026-10-18. Full names clamped to 2 lines, two
  deduped categories, whole-product images, aligned prices, a sale chip, 2-up phone grids, a sticky single-scroller
  sidebar. The reserved second title line stays (user's choice).

## Out of scope

- Behaviour changes on the money path (decision 2's deferred list).
- WordPress content edits (e.g. a shorter campaign message). These are raised as owner edits on the review pages.
- Production go-live.
- [03 Home](issues/03-home.md): approved 2026-10-18 ("continue"). Banner overlay and scrim, top-anchored crops,
  in-row carousel arrows.
- [04 Cart and checkout](issues/04-cart-checkout.md): approved 2026-10-18 ("continue"); `db9915c`. Grey totals panel, ink-ruled
  22/600 total, paired checkout fields at 28px, selected payment ring. The bacs smoke passed and was cleaned up.
- [05 Content, contact, errors, login](issues/05-content-login.md): built in `84075eb`. Contact icons mapped by TDD,
  centred contact form, centred login on phones, balanced 404. The user asked to continue through all areas.
- 06 and 07: still blocked on the REST key (503); not styled blind.
- [06 Product page](issues/06-pdp.md) and [07 Account](issues/07-account.md): built 2026-10-19 once the REST key
  worked locally (`97207b6`, `595908b`, `5177ea7`); review fixes in `3f4b682`.
- [08 Ship](issues/08-ship.md): **READY WITH NOTES** 2026-10-19. Routes 31/31, crawl OK, 185 tests. Push, squash and
  the main-checkout switch are the user's calls.
