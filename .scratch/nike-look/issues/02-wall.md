# 02 Wall and cards

Type: task
Status: done
Blocked by: 00

## Question

See map.md Destination and the matching nike.com section in reference/SPEC.md.

## Answer (2026-10-20, built, uncommitted: the orchestrator verifies and commits)

**Store API facts (checked against `/wc/store/v1/products` locally):**
- No `date_created`, no `is_new`, and `extensions` is empty. So "Nýtt" can't show on the wall.
- `cardLabel()` (new `src/lib/productCard.ts`) supports a publish date. No caller passes one, so the REST v3 surfaces
  (home, related, wishlist) can't disagree with the wall.
- Labels in effect:
  - "Útsala" (accent) when the card shows a "-N%".
  - "Uppselt" (muted) when the product is sold out.
  - Nothing otherwise.
- Colours exist as a local attribute "Litur" (taxonomy null, `has_variations: true`) on about 5% of products.
  - `mapStoreProduct` now maps attributes into `WooProduct.attributes`.
  - `colourCount()` counts the options of a colour variation attribute, and only when there are 2 or more.
  - `colourLabel()` handles Icelandic plurals: "2 litir", "21 litur", "11 litir".

**Built:**
1. **Header row** (inside `[data-archive]`):
   - Breadcrumbs (14px), then the h1 "Skór (581)" at 24/500 (20 at ≤991). The count is a plain span; the
     `role="status"` count line is unchanged.
   - At right: "Fela síur / Sýna síur" with a new `sliders` icon (`data-rail-toggle`, `aria-expanded`), then the
     borderless 16px sort `<select>` (`field-sizing: content`, small chevron).
   - Phones:
     - a scrolling chip row of the sub-category links (16/500, 48px tall)
     - a pills row, all 44px / r24: "Sía (N)" with the sliders icon and an ink edge, then one pill per facet group
       with its active count. Every pill is a `[data-filters-open]`, and the first one in the DOM is the visible "Sía".
2. **Rail:**
   - 192px of content inside a 252px column, so the 60px gap sits in the column. Sticky at 60px, with internal thin
     scrolling (the /verslun/ rail scrolls 1888 in 840).
   - Plain 16/500 category links (`railCategoryLinks()` in categoryTree.ts: children of the category, or the
     top-level categories on /verslun/; structural roots and empty categories hidden), then a 1px #CACACB rule, then
     `<details>` groups (16/500 heading with "(N)" active, a rotating chevron, 1px rules).
   - Checkboxes are 20px, with a 1px #111 edge, r4, and a black fill with a white tick when checked. Counts are #707072.
   - "Fela síur":
     - The column folds 252→0 via the `grid-template-columns` transition, .4s cubic-bezier(.6,0,.1,1). The rail fades,
       then goes `visibility: hidden` (out of the tab order).
     - The choice is kept in `localStorage` `mos-filters-hidden`. Base.astro's pre-paint script sets
       `html[data-filters-hidden]`, so there is no flash or fold on load.
     - Reduced motion: no transition. All of this is scoped to ≥992px.
   - Phone sheet:
     - white and full-screen, sticky bar "Sía" plus a black "Sýna vörur" 44px pill
     - a group pill opens the sheet with that group open and focused
     - Escape or the pill closes it, and focus returns to the pill that opened it
3. **Grid:**
   - 8px-padded cells with 0 column gap, so there are 16px between images.
   - 1440: 3 × 364px cells, images 348px at x=308/672/1036. This matches nike exactly.
   - 1920: 3 × 484.
   - Rail hidden: 4 × 336 at 1440, 4 × 426 at 1920, 3 columns at 992–1399.
   - With the rail open at 992–1199: 2 columns.
   - ≤991: 2 columns edge to edge, 192px at 390 with a 6px gap. Captions are inset 12px.
   - Row gap 48 (24 on phones).
   - "Sýna fleiri" is a centred 180×60 black pill. Load More markup and the 27-per-page size are unchanged.
4. **Card** (ProductCard, shared with the `tile` variant):
   - 1:1 #F5F5F5 image, contain and multiply, with no border, radius, shadow or zoom.
   - Then 16/24 lines:
     - label (grid only)
     - title 16/500, 2-line clamp, `product-card__title > a` kept
     - subtitle #707072, the first category from `cardCategories` (tiles keep 2)
     - price 16/500: the sale price, then the struck original in #707072, then the green "-N%". There is no chip on
       the image any more.
     - "N litir" (grid only)
   - Hover/focus: the existing action ("Veldu kosti" / "Setja í körfu") fades in under the price as an underlined
     link. Its line is reserved so rows don't jump. While hidden it has `pointer-events: none`, so a blind tap on a
     touch tablet can't add to the cart. It shows on `:focus-within`, and is hidden ≤767 as before. Behaviour is
     unchanged.
   - The title link's `::after` covers the whole card (category links and the action sit above it), so a one-line
     title still gives a full-card tap target.
   - Tiles keep "Uppselt" on the image and show no label or colours line, so area 01 looks the same.
   - Tiles reserve no action line: their action takes the price's place while shown (the price fades out). The
     tile is 440 + 112 caption at 1440, the same as area 01.
   - The rail's max-height leaves the 45px store notice clear, so the last rail row stays visible
     (`extra-rail-end-1440.png`).
5. **Pagination:** `Pagination.astro` is imported nowhere (the wall uses "Sýna fleiri"). Only its CSS was restyled:
   16px text, the current page underlined 2px in black, 44px targets.
6. **Wishlist:**
   - Same anatomy, 3 columns or 2 at ≤991.
   - Label "Útsala" / "Uppselt" / "Ekki í boði", the full name (no brand split any more), subtitle, price (struck
     original for simple products), and the green "-N%".
   - The heart is a 44px round outline button.
   - `/api/products` now returns `subtitle`, `wasText` and `percent`, computed server-side. The localStorage logic
     is unchanged.
7. **Search:** the same wall. The h1 is "Leitarniðurstöður: „hoka“ (43)". There are no rail links on brand, tag and
   search, because plain category links would leave the scope; the Vöruflokkar filter stays.
8. **Home carry-over:** `.story-row--single .story__img` is now `object-position: center 8%`.
   - "top" cut at the nose and 25% at the chest, because the photo is a 1120×1480 portrait in a 1704×500 slot.
   - At 8% the face is in frame at 1920 and 1440 (`shots/area02/probe-story-single-*.png`).

**Gates (final build):**
- vitest 215/215 (198 + 12 productCard + 5 railCategoryLinks)
- astro check 0 errors (1 old hint in auth.ts)
- build OK
- routes 31 PASS; crawl OK
- `hscroll-wall.sh`: 0 on 9 pages × 17 widths (1920…320). The probe gives 0 with the rail hidden too.
- console errors 0 on 8 wall pages at 1440 and 390
- `area02-probe.mjs`:
  - geometry as listed above; rail top 60 when scrolled; the hide → reload → show cycle and aria-expanded are correct
  - Tab order: toggle → sort → rail links → summaries. Enter toggles a group. With the rail hidden, Tab skips it.
  - The sort change submits: `?orderby=price`.
  - Hover: action opacity 0→1, it takes the click, the image isn't transformed, and a click on the image opens the
    product.
  - Focus on a title shows its action.
- `area02-extra.mjs`:
  - a simple product's "Setja í körfu" and the wishlist heart (44×44) sit above the card overlay
  - the rail ends at the notice's top (855)
  - phone header: the h1 and sort share a line at 390/320; a long search title puts the sort on its own line
- `load-more.mjs`: 27 → 54 at 1440 and 390, 3 and 2 columns, status "Sýni 28–54 af 581 niðurstöðum", 0 duplicates.
- Contrast:

  | colour | on #fff | on #F5F5F5 |
  |---|---|---|
  | --accent #D33918 | 4.81 | 4.41 |
  | #707072 | 4.94 | 4.53 |
  | --sale-green | 5.37 | 4.92 |

  Labels only ever sit on white.

**Shots:**
- `harness/shots/area02/` {archive, archive-filtered, shop, sale, brand, tag, search, wishlist, ov-filters, home, pdp}
  at 1440/390/360
- `area02-wide/` archive and search at 1920 and 1200
- probe-wall-{1920,1440,1200,1024}-{open,hidden}, probe-hover-1440, probe-sheet-brand-390, probe-story-single-{1920,1440}
- `area01/crop-*-area02` (home tiles unchanged)

**Deviations:**
- Filter pills are 44px, not 40 (the tap-target rule).
- Breadcrumbs are kept above the h1, which nike doesn't have.
- The header row isn't sticky.
- The sort shows the chosen option ("Raða eftir nýjast"), not a fixed "Raða eftir".
- There are no hover colour swatches: the Store API has no per-colour images.
- The card action link is 24px tall on hover devices. It meets WCAG 2.5.8 (24px) and is hidden on phones.

**Open questions:**
- Should brand, tag and search pages get rail category links (they would leave the scope)?
- The Vöruflokkar filter repeats the rail links on category pages and on the shop.
- "Nýtt" needs a publish date in the Store API (an mu-plugin field, so PHP), if wanted.
- The harness `smallTargets` count still flags one-line title links (168×24). Their real target is the whole card.
