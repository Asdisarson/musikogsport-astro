# 03 Home

Type: task
Status: resolved (approved by the user 2026-10-18 with "continue"; review page: https://claude.ai/artifact/PAj89fHkHy7KKr4gbHk4vC)
Blocked by: 02

## Question

Changes:
- Banners:
  - an `::after` overlay at about 15% plus a bottom scrim
  - `object-position:50% 0`
  - title max-width 45% at weight 500; at ≤991px, 65% and 22px
- Carousel arrows inside the row, shown on hover or focus, hidden when disabled.
- Row-heading spacing.
- Mobile hero title 29px with letter-spacing 0, and the NÝTT overlap.

Closes:
- home: banner-image-anchor, banner-overlay-missing, banner-title-width, banner-title-legibility,
  product-row-arrow-overflow, mobile-hero-title-cramped, row-heading-spacing
- home/mobile-banner-height stays as it is

## Answer

Built in `9341ead`.

**What changed:**
- banner overlay at about 15% plus a bottom scrim
- `object-position: 50% 0`
- banner titles max-width 45% (65% at ≤991px, 22px)
- carousel arrows: 44px white circles 12px inside the row. On hover devices they show on hover or focus-within; on touch
  they stay visible; disabled arrows are hidden.
- live's 50px row-heading gap, 30px phone row titles
- phone hero title 29px with letter-spacing 0

**Gates:**
- `astro check` 0 errors, build green, routes 27/31 (baseline)
- harness: horizontal overflow went from 4 shots to 0

**Arrow probe:**
- desktop: opacity 0 at rest, 1 on hover, right edge 1413 of 1440
- phone: visible
- disabled: hidden

Ultracode was off this session, so there was no multi-agent review; the check was screenshots, probes and a visual
review.

The NÝTT outline overlap from the audit was not changed. It is minor.
