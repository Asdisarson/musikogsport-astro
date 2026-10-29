# nike.com design spec (measured 2026-10-20, US site, 1440 + 390)

Shots in this folder (gitignored): home-d/home-scroll*-d/footer-d, home-m/home-scroll*-m/footer-m, megamenu-d, menu-m,
wall-d/wall-scrolled-d/wall-hover-d/wall-m, pdp-d/pdp-scrolled*-d/pdp-m/pdp-scrolled*-m, cart-d/cart-m (empty).
Raw computed styles: out.json.

## Global
- bg #FFFFFF, text #111111. Greys: #F5F5F5 (utility bar, search field, size fill, tiles, disabled), #CACACB (1px borders),
  #9E9EA0 (disabled text), #707072 (secondary text). Accent #D33918 ("Just In" label); green for "% off".
- Text: Helvetica Now Text 400/500 (→ Inter). Display: Nike Futura ND condensed uppercase (→ Archivo Condensed / Anton).
- Base 16px; line-height 28px body, 24px card/PDP lines; letter-spacing 0.
- Hero h1 76px/0.9 weight 500 uppercase (48px mobile). Wall h1 24px/31 (20 mobile). PDP title 20/24 500.
- Buttons: pills radius 30px, 60px tall, 16px/500; primary #111 fill white text; secondary white + 1px #CACACB.
  Hero CTA white pill ~36px tall, 16px/24px padding. Round arrows 36–48px, #E5E5E5. Search pill #F5F5F5 36px, r24.
  Size buttons: 48px tall, radius 4px, 1px border (the one non-pill control).
- Gutter 48px @1440, 24px @390. Spacing base 4/8: 12, 16, 24, 48, 80–96.

## Header
- Utility bar 36px #F5F5F5: left small brand glyphs; right 12px/500 links with pipe separators. Scrolls away.
- Main bar 60px white, no border, sticky at y=0. Logo left at x=48.
- Nav centred (~x455), 16px/500, ~24px apart. Hover: 2px black underline.
- Right: #F5F5F5 pill search with magnifier, then heart, then bag; icons 24px 1.5px outline.
- Mega-menu: hover, full-width white panel ~290px tall; 4 columns, 226px pitch starting x=280; heading 16/500 #111,
  links 14/400 #707072, 26px rows; page dimmed; grid-template-columns transition .4s cubic-bezier(.6,0,.1,1).
- Mobile: 60px bar, logo left; search/account/bag/hamburger 24px icons in 36px hit areas. Right drawer ~70% wide,
  dimmed page, ~32px text rows with chevrons, then CTAs (black pill + outline pill).

## Home
- Hero full-bleed image edge to edge under the header (~800px tall @1440, ~585 @390). Text bottom-left at x=48,
  ~60px above the bottom; gradient overlay lower-left only. Stack: uppercase condensed 76px headline (48 mobile),
  16–18px white one-line subtitle, white pill CTA with 24px above.
- Below: square product tiles on #F5F5F5, no chrome, 440×440 @1440 (3.25 visible), 12px gap, aligned to the gutter;
  two round 48px arrows top-right. Mobile tiles ~300px, horizontal scroll, next tile peeking.
- Sections alternate full-bleed blocks and tile carousels / half-width story tiles; 80–96px between sections;
  uppercase condensed titles 24–48px.

## Wall
- Header row: h1 with count "… (762)" 24/500; right "Hide Filters" (sliders icon) and "Sort By ⌄" 16px.
- Left rail 192px wide at x=48 (~260 column): toggle, divider, plain 16px category links, then collapsible groups;
  scrolls internally, sticky; "Hide Filters" collapses it and the grid widens.
- Grid: 3 cols @1440, card 364 incl. 8px side padding (348 image, 16 gutter), x 300→1392, rows ~551–586.
  @390: 2 cols edge to edge (195px cards, 6px gap); chip row of category links, then filter pills 40px tall r24 1px.
- Card: 1:1 image (grey baked in), no border/radius/shadow; then label ("Just In" #D33918 16/500), title 16/500 #111,
  subtitle 16 #707072, price 16/500; sale = new price + struck original + "19% off" green; "N Colours" line.
- Hover: row of 48×48 colour swatches under the image; main image swaps per swatch; opacity .28s.

## PDP
- @1440: ~1016px block centred from x≈216: 60×60 thumbnail column (r4, active border) | main image 532×665 (4:5) on
  #F5F5F5 with round prev/next bottom-right | right rail 376px at x=856 (not sticky).
- Rail: title 20/500, subtitle #707072, price 16/500; fit toggle (outline pair); colourway thumb; "Select Size" +
  size-guide link right; 2-col size grid 48px tall, 8px gap, 1px #CACACB, r4, unavailable struck on #F5F5F5;
  Add to Bag 376×60 black pill; Favourite outline pill, 12px between.
- Accordions: native <details>/<summary>, 1px top border rows with chevron (description, shipping, reviews).
- Mobile: swipe carousel, full-width title block, 2-col size grid, 342×60 black pill + outline pill in flow.

## Bag
- Two columns ~1084 centred: "Bag" 24/500 left; "Summary" 24/500 right ~335px at x=919: promo (collapsible),
  subtotal, shipping, tax, divider, Total 500, free-shipping progress line + thin bar; 60px black pill checkout
  (grey disabled), outline secondary, 12px #707072 small print. Mobile stacks, summary under items.

## Footer
- White, ~611px tall, 48px padding, 4 text columns (14px, #111 / #707072). Bottom bar 12px #707072: location,
  © line, legal links. Mobile: groups collapse to <summary> accordions.

## Motion
- .28s opacity swaps; .4s cubic-bezier(.6,0,.1,1) for mega-menu/top bar; no parallax, no card scale.

## Do not copy
Swoosh/Nike logo/favicon, Jumpman, Converse mark, "Just Do It", Nike names/campaign copy, the AI search icon,
Nike photography, Helvetica Now / Futura ND, podium-cds token names, "Bag"/"Favorite"/"Add to Bag" wording.
