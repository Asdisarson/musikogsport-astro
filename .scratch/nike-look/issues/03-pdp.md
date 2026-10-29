# 03 PDP

Type: task
Status: done
Blocked by: 02, REST key

## Question

See map.md Destination and the matching nike.com section in reference/SPEC.md.

## Answer (2026-10-20, built, uncommitted: the orchestrator verifies and commits)

**REST facts (local WC REST v3, `harness/rest-image-fields.py`):** product `images[]` carry `src`, `srcset`, `sizes`,
`thumbnail` (450×450 crop), `alt`, `name`, `id`, dates. `srcset` is `false` when WP made no sub-sizes. REST v3
variations carry `image.src`. `brands[]` is set (HOKA → "Hoka"). Category names are entity-encoded.

**Built:**
1. **Layout ≥992:** `.pdp` is a grid of `minmax(0,608px) minmax(300px,376px)`, 32px apart, centred, max-width
   1016 + 2 gutters. Breadcrumbs (14px #707072) span the top row.
   - Measured at 1440: crumbs x=212; thumbs 212 (60×60); image 288, 532×665 (0.800); rail 852, 376.
     1920 → 452/528/1092. 1200 → 92/168/732. Under 1200 the image shrinks: 1024 → 444×555, 992 → 412×515.
   - Gallery (PdpGallery): the thumbnail column (r4, 1px #CACACB, #111 on hover and on the current one; 8px gap) is
     sticky under the header and scrolls on its own when it is too tall (13-image products). Every image is stacked as
     a 4:5 #F5F5F5 tile (contain, multiply), 12px apart. A thumb click scrolls its image to header+24 (smooth;
     `auto` under reduced motion). The thumb of the image most in view gets `aria-current`, and only the thumb column
     scrolls to keep it visible, never the page. The lightbox is unchanged (`data-lightbox`, `#pdp-main` first).
   - Rail (new PdpRail.astro): `position: sticky; top: var(--rail-top)`. A ResizeObserver plus resize sets
     `--rail-top = min(header+24, innerHeight − storeNotice − 24 − railHeight)`, so a rail taller than the window
     scrolls until its foot shows, then sticks. It sits inside `.pdp`, so it never reaches the related row or footer.
   - Focus is never hidden (WCAG 2.4.11):
     - The problem: a stuck rail with a negative top hid the size-chart link and the first size rows from keyboard
       users. `area03-focus.mjs` found 48 hidden stops before the fix.
     - On `focusin`, PdpRail shifts a stuck rail's top just enough to show the control, or scrolls the page when the
       rail isn't stuck.
     - A wheel or touch scroll, or focus leaving the rail, restores the resting top.
     - `html:has(.pdp)` gets `scroll-padding-top: header+8` and `scroll-padding-bottom: 52px` (the notice), so the
       browser's own focus scrolling clears them. The gallery items' `scroll-margin-top` is now 16px, and a thumb
       still lands its image at header+24.
     - Result: 0 hidden on Tab and Shift+Tab through the rail at 1440×900 and 1440×800. First size focused while
       stuck: top goes −209 → −96 (button at y=68), and one wheel scroll restores −209.
2. **Rail contents:**
   - title 20/500 Inter; subtitle 16 #707072 (`productSubtitle`: first `cardCategories` + brand term, else
     `splitBrand`) "Hlaupa & æfingarskór · Hoka"; price 16/500, sale = price, struck original #707072, "-50%" green.
   - Colour attributes with their own photo per colour (`optionImages`) show as 70px picture radios, first in the
     list (display only; `attrNames` keeps Woo's order). Trek helmet 264477: picking Volt swaps `#pdp-main`.
   - Size attributes (`isSizeAttribute`): label "Veldu stærð" 16/500, with "Stærðartafla" plus a ruler glyph (new
     `ruler` in Icon.astro) at right, passed into the island as the named slot `size-guide`. The popup opens through
     document-level delegation in SizeGuide.astro, which survives hydration. Other attributes keep "Name: value".
   - 2-column grid of 48px boxes, 8px gap, 1px #CACACB, r4, 16px. Chosen: ink edge 1.5px (1px + .5px inset) and 500.
     Sold out: struck #9E9EA0 on #F5F5F5. Arrow keys move focus (Left/Right ±1, Up/Down ±1 row); Enter or Space
     picks; Tab still works. `choiceHint` is unchanged.
   - "Hreinsa" (44px, underlined, only once something is chosen), stock line, then the qty: a 48px r4 box
     (`--field-border`, 44px ± buttons) on its own line. Then "Setja í körfu", a 376×60 black pill (disabled #F5F5F5
     + #9E9EA0), the hint under it, and 12px down "Óskalisti ♡", a 60px outline pill.
   - Wishlist: a `[data-wish]` button wired to Base.astro's existing delegated toggle (same `mos-wishlist` key,
     `aria-pressed`, header `[data-wish-count]`). No new script.
3. **Below:**
   - the short description as plain text (Nike's paragraph)
   - `<details>` rows (1px #CACACB rules, 20/500, 72px, a chevron turning .28s):
     - "Lýsing" (`id="lysing"`, `.pdp-desc__inner`, the sanitised long description; media capped, tables scroll)
     - "Frekari upplýsingar" (the attribute table plus the meta grid with `data-pdp-sku`)
     - "Sending og skil" (summarised from /skilmalar/, with a link)
   - "Deila" (44px)
   - No "Stærðartafla" accordion: SizeGuide renders no server-side content, only a lazily filled popup.
4. **≤991:** breadcrumbs, then a full-bleed 4:5 scroll-snap carousel with an `aria-hidden` "1 / 8" counter (the
   8px dot buttons failed 44px), then the rail in flow, then accordions.
5. **Related:** RelatedProducts is now `ProductRow variant="home"` titled "Þér gæti líkað" inside `.pdp-related`,
   which defines `--edge`. It sits outside `.pdp` and bleeds right.
6. **Images:**
   - `mediaSrcset()` rewrites every candidate. ProductImage takes `srcset`/`sizes`.
   - Main images get `sizes="(min-width: 1200px) 532px, (min-width: 992px) 45vw, 100vw"`.
   - `#pdp-main` gets no srcset: the island swaps it through `.src`, which a srcset would override.
   - Thumbs use the REST `thumbnail` with the srcset at `sizes="60px"`.
   - The onerror drops a failed srcset before falling back to the placeholder.
   - Production serves the sub-sizes: 24/24 images loaded (720w and 576×720 picked at 1440; 1000w at 390@2x).
7. `pdp` root, JSON-LD and the Icelandic copy are kept. The old `.pdp-summary`, chip badge and boxed description
   section are gone.

**Tests:** 234 (215 + 19): isSizeAttribute (2), optionImages (6), isColourAttribute (2), productSubtitle (5),
mediaSrcset (4).

**Gates (final build, 2026-10-23, re-run after the session restarted; the Local site was down and was restarted
with local-site.sh):**
- vitest 234/234; astro check 0 errors (1 old hint); build OK
- `area03-focus.mjs`: hidden focus total 0
- routes 31 PASS; crawl OK (PDP JSON-LD Product + BreadcrumbList)
- console-check: 0 errors on 7 pages × 2 widths, plus 0 on the PDPs in the probe
- `area03-probe.mjs`:
  - geometry above
  - rail sticky with every accordion open at 1440×900 and ×800: its foot is at 831/731 = window − notice − 24,
    and it stops at `.pdp`'s bottom
  - thumb #5 → its image top 84 and current = 5; back at the top, column scrollTop 0 and current 0
  - lightbox opens "1 / 12"
  - keyboard: 36 →R 37 1/3 →D 40 →L 38 2/3, Enter picks, ATC enabled, hint gone, SKU follows
  - accordion opens on Enter
  - size chart popup opens and loads
  - wishlist: count 0→1, aria-pressed true, survives a reload, 1→0
  - one LOCAL add to cart (257261×1), then the cart was emptied (0)
  - sideways overflow with every `<details>` open: 0 on 6 products × 16 widths (320…1920)

**Shots:**
- `harness/shots/area03/` pdp, pdp-chosen, pdp-sale, pdp-gallery, pdp-simple, pdp-colour at 1440/390/360
- `area03-wide/` pdp and pdp-gallery at 1920/1200
- `area03-probe/` fold per width, gallery-1440x{900,800}-scrolled, hoka-1440-chosen, colour-{1440,390}-chosen,
  plus the other products

**Versus nike (pdp-d / pdp-scrolled*-d / pdp-m):**
- closed: block width and x positions (212/288/852 vs 216/292/856), the columns, the 2-col size grid, the stacked
  60px pills, the accordion rows, and the mobile full-bleed carousel and size grid
- partial:
  - Nike's mobile puts the title above the carousel. The brief's order (carousel first) was kept.
  - Nike's single image has prev/next arrows; ours stacks every image instead, per the brief.

**Deviations:**
- The rail's sticky top is dynamic (`--rail-top`), not a fixed `calc(header + 24px)`.
  - With every accordion closed, the HOKA rail is 984px tall, so at 1440×900 it rests at top −153.
  - Once you scroll into the gallery, the title, price and first size row move out of view; the CTAs stay.
  - That is the price of a reachable foot. The orchestrator could choose instead to make only the buy block sticky.
- "Lýsing" holds only the long description. The short description shows as plain text under the CTAs, so a product
  with only a short description has no Lýsing row.
- Sold-out sizes use native `disabled`, not `aria-disabled`. This keeps the harness selector, and the island logic
  stays untouched (`aria-disabled` would let a click choose them). They're out of the tab order and announced via
  the "— uppselt" label.
- The rail is sticky (the brief), unlike Nike.
- Qty border is `--field-border` (3:1 field rule).
- `sizes` adds a 992–1199 clause.
- Products without a size attribute no longer show the size-chart link (before: every PDP).
- The meta grid moved into "Frekari upplýsingar".
- The product photos often carry their own light-grey ground, so a slightly darker band can show inside the
  #F5F5F5 tile (multiply). The cards have the same.

**Open questions:**
- Titles render as WordPress has them. All-caps names ("NIKE GAMMA FORCE LOW", "ADIDAS VL COURT …") are not
  sentence-cased; doing that safely needs a rule for model codes.
- /skilmalar/ names two shops (Reykjavíkurvegur 60 for exchanges, Dalshraun 10 for pick-up). The PDP copy names
  neither. The terms also mention Valitor.
- "Sending og skil" is static; it won't follow edits to the terms page.
- The dead `variant="related"` branch of ProductRow and its CSS are kept for /ship to remove.
- Colour photos come from full-size variation images (no thumbnail in REST variations).
