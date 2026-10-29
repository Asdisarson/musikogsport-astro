# 06 Archive templates + product card

Type: task
Status: resolved
Blocked by: 04

## Question

- shared `ArchiveLayout` (shop, category, brand, tag, search)
- sidebar filters and sort
- 27 per page + load more
- single-image product card

## Answer

One `ArchiveView` serves shop, category, brand, tag and search. It follows live's Goya `shop-container`
plus the "Product Filters for WooCommerce" sidebar, measured on live at 1440 and 390 (visitor GETs only).

**Desktop:**
- 30px container padding, a 320px sidebar, a 30px gap and a 3-up grid with 30px gaps.
- Toolbar (45px tall, 20px above the grid): breadcrumbs on the left and a borderless 158px sort on the
  right, truncated like live's.
- WooCommerce's result count is hidden on live, so it stays only as a `role="status"` line for screen
  readers.

**Sidebar:**
- "Endursetja" button: 320×38, 14px/500, `#e5e5e5` border.
- Groups are `<details>`: 14px/600 uppercase `#111` headings with a thin +/−.
  - Aldur/Kyn and Félag/Lið start collapsed.
  - Counts show only for Vörumerki and Félag/Lið.
- Options are links that toggle the filter in the URL, so filtering works without JS. They render as a
  16px `#e5e5e5` box (dark with a tick when checked) and an 18px label, using `role="checkbox"` and
  `aria-checked`.
- Vöruflokkar is a tree (`FacetOption.children`). It starts at the archive's own children, and a "+"
  expands sub-categories, indented 18px. A branch opens when something inside it is active.

**Load More:**
- 180×57 button with a 2px `#282828` outline, 18px text, placed 63px below the grid.
- JS fetches the next `/page/N/`, appends its cards, updates the status line, and then advances or drops the
  button. The plain link is the no-JS fallback.

**Mobile (≤991px):**
- Title 35.2px, left-aligned breadcrumbs.
- A 65px bar (rgba(0,0,0,.1) borders) with the Filters trigger (vertical sliders icon, divider) and the
  sort.
- One column of cards at ≤575px.
- The filter panel is full-screen: a 70px `#f8f8f8` bar with "Filters" and a dark 66×37 "Done", then the
  same groups at 35px side padding. Focus moves to Done; Escape closes it.

**Per-template text (from live):**

| Template | Title | Breadcrumbs | Document title |
|---|---|---|---|
| shop `/verslun/` (+ `/page/N/`) | none: a 31px empty header (the h1 is visually hidden) | | |
| search | `Leitarniðurstöður: “q”` | Heim / Verslun / Leitarniðurstöður fyrir “q” | `Þú leitaðir af "q"` |
| brand | | Heim / Nike | `Nike Archives` (Yoast default) |
| tag | | Heim / Verslun / Vörur merktar “Nike” | |

**Card** (from ticket 05) tuned against live:
- Title box 19px under the image, 22px line + 5px.
- Categories at a 28.5px line height, price line 25px.
- First card 450px tall, as on live.

**Shell fixes found here:**
- The header hairline is now an inset shadow, so the header is 90/60px like live's (it was 91, which pushed
  every page 1px down).
- Nav "current" follows WordPress's rule: an exact URL match, or a plain archive link while that archive is
  filtered, sorted or paged. The new `isCurrentMenuHref` is unit-tested.

**Verified:**
- Positions are pixel-equal to live: 1440 title 158, toolbar 227, Endursetja 235, grid 292; 390 title 183,
  breadcrumbs 246, bar 282, grid 367.
- Load More on `?brand=nike`: 27 → 54 unique cards, button moved to `/page/3/?brand=nike`. Sort keeps the
  filters.
- `astro check` 0/0/0, vitest 60/60, build green, routes 23/23. The verify script now reads the hidden
  status line and `aria-checked`.
- Content pages 6/6; the contact test post was deleted. The line-break check now accepts `<br />`.
- Shots: `.playwright-mcp/shots/local-cat-{1440,390,filters-390,nike-price-1440}.png`.
