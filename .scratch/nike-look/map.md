# Map: musikogsport "Nike look" re-skin

Label: wayfinder:map · Tracker: local markdown (`.scratch/nike-look/`) · Branch `feat/nike-look` off `feat/refined-goya` (5432526)

## Destination

The storefront looks like nike.com (October 2026) with Músík og Sport's logo, inventory, Icelandic copy and WordPress
data: white page, #111 text, F5F5F5/CACACB/707072 greys, Inter text + Archivo Condensed uppercase display, 60px pill
buttons, 36px utility bar + 60px sticky nav with a mega-menu and pill search, full-bleed hero with bottom-left text,
grey-tile carousels, a product wall with a left filter rail ("Fela síur") and 3-col/2-col borderless cards, a PDP
with a thumbnail column + 4:5 image + right rail (2-col size grid, stacked pill CTAs, <details> accordions), a bag
with a summary panel, a light multi-column footer with phone accordions.

## Decisions (grill 2026-10-20)

1. All four Refined Goya "fixed" items are released: Jost, live palette hues, square black buttons, orange campaign bar.
   Orange survives only as the "Nýtt"/sale label accent.
2. Not copied (trade dress): Swoosh/logo, "Just Do It", Nike photography and copy, Helvetica Now / Futura ND.
3. Fonts: Inter (text 16/24) + Archivo Condensed (display, uppercase) via @fontsource. Fallback Helvetica Neue/Arial.
4. Hero: WP banner image full-bleed + WP hero.heading/buttons; fallback first product slide on #F5F5F5.
5. Product photos: #F5F5F5 tile, contain, multiply; 1:1 cards, 4:5 PDP. Pass Store API srcset/sizes through.
6. Mega-menu from the WP menu tree (text columns); mobile right drawer reuses buildPanels. Menu stays WP data.
7. Skipped: app banner, member blurbs, sticky mobile add-to-cart, Klarna/PayPal rows.
8. Keep: contrast tokens (AA), tests, route-pinned selectors (`product-card__title`, `filter-option__*`,
   `checkout-header`, `pdp`, role=status, sort <option>, JSON-LD), 27 per page, Icelandic copy, money path untouched.
9. Delivery: one area per `wip:` commit, harness shots 1440/390/360 vs `reference/` nike shots, no review pages
   (user looks at the running site), one consolidated /ship at the end, push only when the user says.
10. REST key: key 8 (user-created in wp-admin 10-20) in `.env`; key 7 stays deleted.

## Tickets

- [00 Tokens, type, shell](issues/00-shell.md): tokens, fonts, buttons, utility bar, sticky nav, mega-menu, drawer, search, footer
- [01 Home](issues/01-home.md): hero, tile carousels, story tiles
- [02 Wall and cards](issues/02-wall.md): rail, Fela síur, sort, grid, card anatomy, labels, hover swatches
- [03 PDP](issues/03-pdp.md): thumbnail column, 4:5 image, right rail, size grid, CTAs, accordions (needs REST key)
- [04 Bag, checkout, account](issues/04-bag-account.md): summary panel, pills, greys; token-level only
- [05 Consolidated /ship](issues/05-ship.md)

## Reference

- `reference/*.png`: nike.com shots (gitignored). Spec brief: `reference/SPEC.md`.
- Harness: reuse `.scratch/refined-goya/harness/shots.mjs` (copy to `.scratch/nike-look/harness/`).

## Status 2026-10-23

All tickets done; /ship READY (see issues/05-ship.md). Not pushed.
