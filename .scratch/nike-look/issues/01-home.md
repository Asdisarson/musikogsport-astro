# 01 Home

Type: task
Status: done
Blocked by: 00

## Question

See map.md Destination and the matching nike.com section in reference/SPEC.md.

## Answer (2026-10-20, built, uncommitted: the orchestrator verifies and commits)

**What the page shows** is all WP "Forsíða" data (`mos/v1/front-page`); no PHP changes. `src/lib/homeLayout.ts`
(`planHome`, `homeSections`, 8 tests) decides it:
- **Hero image:** the first banner with an image. Locally that is banner 0, "Hlaupavörur í úrvali" (2048×1152 shoe
  shot). Its own title and href are not shown: the text is `hero.heading` "Ert þú tilbúin/n fyrir æfingu?" (the
  page's only h1), `hero.text` "Skoðaðu úrvalið", CTA `hero.buttons[0]` "Vefverslun" → /verslun/. Fallbacks:
  headline → banner title; CTA → "Skoða nýjungar" → /verslun/. `hero.buttons[1]` ("Vefverslun Börn") is dropped,
  per the spec.
- **No banner image:** the product slides with images on #F5F5F5 (contain, multiply, photo in the right half on
  desktop / the top 55% on phones), ink copy, a black pill, and two 48px #E5E5E5 arrows when there are 2+.
  Without a heading each slide shows its own linked product name. Shot through a temporary `?__product` switch,
  removed before the final build (`shots/area01/product-hero-*`).
- **Sections:** product row, story row, product row, story row, … then the rest. Locally: row "Nýjar vörur í
  vefverslun", stories 1–2, row "Vinsælt núna", stories 3–4, 5–6, and 7 (FIMLEIKAR) full width.

**Built:**
- Hero: full bleed under the header, `min(800px, 56vw)` (min 440) on desktop, `min(585px, 150vw)` ≤991.
  `cover`, top center. Copy bottom-left at the content edge, 60px up (40px on phones): display 76/0.9 (48 ≤991),
  18px subtitle (16 ≤991), 12px, 24px, a 44px white pill. Gradient: .55 black under the whole text stack, fading
  up (400→640px) and right (edge+760→edge+1120px); phones: vertical only.
- The Anton/Oswald `--u` canvas CSS, `.home-intro` and `.pill-btn` are deleted. No autoplay any more (manual
  arrows only, as on nike.com; WCAG 2.2.2).
- `--edge` = the gutter inside the 1800px frame, so at 1920 the hero copy, row titles and tiles start at x=108,
  in line with the header.
- Tile rows (`ProductRow` variant home): uppercase display title 32px (24 ≤991), two 48px round arrows top-right
  (#E5E5E5; ends #F5F5F5 + #9E9EA0 via `aria-disabled`, so a focused arrow keeps focus; both hidden when the row
  can't scroll). Tiles 440px at 1440 (`clamp(280px, 30.56vw, 440px)`), `min(300px, 77vw)` ≤991, 12px gap, from
  the edge and bleeding off the right (track padding, no 100vw). One arrow press = one tile + gap; `auto` scroll
  under reduced motion. The related ("Tengdar vörur") variant keeps its old markup, arrows and dots.
- Tiles (`ProductCard` variant tile): title 16/500, categories 16 #707072, price 16/500; sale = new price #111,
  struck original #707072, `formatSaleBadge` "-NN%" in `--sale-green` #107c10 (5.4:1; #128A09 is 4.50). No sale
  chip on the image, no hover zoom. No reserved second title line; the price rows still line up.
- Story tiles (`BannerRow`): pairs at 4:5 (max 840px tall), one left over → full width 500px (`center 25%`),
  phones stacked 4:5. Whole tile is the link, h2 display title 32px (28 ≤991) + a "Skoða" pill span, .55 lower
  gradient. 12px between story rows.
- Rhythm: 88px between sections (48px ≤991).
- CampaignBar: the utility link is now "Verslunin" (still /hafa-samband/).

**Fixed during verification:**
- Story tiles stopped filling their column above ~1452px (a 4:5 grid item with `max-height` shrank its width:
  672 of 846px at 1920). `.story` now has `width: 100%`; 1600 → 746×840, 1920 → 846×840.
- The hero CTA's ink focus ring was invisible on the dark gradient; `.hero--banner .hero__cta:focus-visible` is
  white now (`shots/area01/focus-cta-*.png`).
- Tile titles no longer reserve a second line (gap under one-line names); price rows still align.
- The product-hero photo overflowed its half (inset + width:100%); it is now an inset box.

**Gates (final build):**
- vitest 198/198 (190 + 8 homeLayout); astro check 0 errors (1 old hint in auth.ts); build OK
- routes 31 PASS; crawl OK (JSON-LD on /: Organization, WebSite)
- hscroll on / at 1920…320 (16 widths): 0 everywhere
- console-check: 0 errors on 7 pages at 1440 and 390
- `area01-probe.mjs` at 1920/1600/1440/1024/390/360: hero 800/800/800/573/585/540 tall; copy 60px (40px) up;
  tiles 440/440/440/313/300/277 with 12px gaps, 4th cut at 1440; arrows 48×48; keyboard Enter steps 452px at
  1440 and focus stays on the arrow at the end; 1 h1; section gaps 88 (48), story rows 12
- Contrast on the real pixels (text hidden, lightest 5% / lightest pixel vs white): hero title ≥7.3 / 5.2,
  subtitle ≥6.5 / 5.7 (needs 4.5), all 7 story titles ≥5.3 / 5.3 (need 3) at all six widths.

**Shots:** `harness/shots/area01/` — home-{1920,1440,390,360}-{fold,full}, pdp-* (related row unchanged),
crop-{row,story,hero}-{1440,390}, focus-cta-{1440,390}, product-hero-{1440,390}-{a,b}.
Probes: `harness/area01-probe.mjs`, `area01-crops.mjs`, `area01-product-hero.mjs` (needs the temporary switch).

**Versus the nike references:** hero height and copy position closed; headline size closed (Archivo 75% is wider
than Futura, so it takes 2 lines at 720px); tile size, gap, peek and arrows closed; section spacing closed; story
pairs closed (inside the gutter, like nike's halves in home-scroll2; home-scroll3's edge-to-edge halves not copied).

**Open questions / notes:**
- Banner 0's title "Hlaupavörur í úrvali" and its link (/voruflokkur/fatnadur/hlaup/) are not visible; hero CTA
  goes to /verslun/. Owner may want the hero CTA to follow the banner instead.
- `hero.buttons[1]` "Vefverslun Börn" is no longer on the page.
- The "SUND" banner is a 652×489 AVIF, upscaled in a 666×833 tile (soft).
- The product-hero fallback uses a black pill (white on #F5F5F5 would vanish).
