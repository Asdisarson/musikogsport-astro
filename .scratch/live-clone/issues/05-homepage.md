# 05 Homepage + content pages from WordPress

Type: task
Status: resolved
Blocked by: 04

## Question

Build the live homepage from the ACF Forsíða fields:
- the hero product slider (Slider Revolution look: "NÝTT" outline letters, condensed product title,
  price, "FARA Á SÍÐU", arrows)
- the heading and buttons
- the two product rows (newest / popular)
- the banner rows (2 / 1 / 2 / 3)

Also the WordPress content pages in live's look: `/hafa-samband/`, `/skilmalar/`, `/opnunartimi/`,
`/staerdir/` and the `/oskalisti/` page frame. Added 2026-10-12: they are WP-driven like the homepage, and
ticket 04's stylesheet rewrite dropped their old makeover styles.

## Answer

**Homepage** (measured on live at 1440 and 390):
- `HeroSlider`: the 1440×900 Slider Revolution canvas, scaled with container-query units. Image 600² at
  170/150; title Anton 80 on a white box at 670/65; price Oswald 300 40 (sale on #f2f2f2); 3px-bordered
  "FARA Á SÍÐU" at 840/475; outlined "NÝTT" Oswald 160 / ls 60; black arrow block at 64/650. Fade,
  8 s autoplay paused on hover/focus. Mobile is stacked like live. Fonts: `@fontsource/anton` +
  `@fontsource/oswald`.
- Slides carry WooCommerce's `price_html` (added to the endpoint).
- Intro (40px h1, 50px #2a2a2a pill buttons) → `ProductRow` (32px heading, 3-up scroll-snap carousel,
  faint 48px arrows outside, no loop) → `BannerRow`s.
- Banner rows: 2 / 1 / 2 / 3, 600px (three-up 700px), title 10% in / 90px up, 28.8px with a soft shadow,
  zoom on hover.
- Live's raw `[yith_wcmc_subscription_form]` text is left out (a broken shortcode on live).
- Result: full-page 5,922px vs live 5,894px, same section order and proportions.

**Card** (shared with ticket 06): live's et-listing-style1:
- title cut to 3 words + "..." (`truncateWords`, tested)
- category links sorted by is-collation, Woo `price_html` (sale shown first)
- "- N % Off" badge via `salePercent(price_html)` (tested; works for variable products)
- wishlist heart and the 3-image gallery removed (decision 8)

**Content pages:**
- `mos/v1/page/<slug>` returns raw `post_content`. `wpbakery.ts` (tested, 9 cases) parses rows, fractional
  columns, spacers, `vc_icon`, `vc_gmaps` (base64 iframe → src), `ninja_form`, `yith_wcwl_wishlist`,
  wpautop debris and line breaks.
- `/[slug].astro` serves any published WP page (system pages excluded); `WpContent` renders it.
- The sanitizer now allows class + `text-align`-only style, h1/h6/hr.
- `ContactForm` clones Ninja Form "Contact Me" (Nafn, Netfang, Tegund ×4, Skilaboð, floating labels) →
  `/api/contact` (per-visitor-IP limit) → WP `mos/v1/contact`: a private `mos_contact` post plus `wp_mail`,
  limit keyed IP+email.
- The old native hafa-samband/skilmalar/staerdir were removed; oskalisti uses the page frame.

**Verified:** `astro check` 0/0/0, 57 unit tests, build green, routes 23/23
(`scripts/verify_live_routes.py`, regex updated for the new card + dev attributes), content pages 6/6
(`scripts/verify_content_pages.py`). Contact submit returned 200 (test post deleted) and invalid input
400. Side-by-side shots for home (desktop + mobile) and hafa-samband match live.
