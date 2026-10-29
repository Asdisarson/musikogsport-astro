# 01 Shell and overlays

Type: task
Status: resolved (approved by the user 2026-10-16; review page: https://claude.ai/artifact/PAj89fHkHy7KKr4gbHk4vC)
Blocked by: 00

## Question

Changes:
- Campaign bar: `nowrapRanges` in `src/lib/text.ts`, written test first.
  - Ranges like "10-18" sit in nowrap spans.
  - The dismiss key still uses the raw text.
  - At ≤575px: stacked, 14/20, balanced. At ≥992px: live's centring.
- Store-notice contrast.
- Footer: strong at weight 500, spacing; on mobile a 20px inset and a 160px logo.
- Overlay colours and fields: side menu, search, side cart.
- The header cart glyph stays as it is (contested).

Closes:
- home: mobile-campaign-hours-break, footer-label-spacing
- archive: campaign-bar-hours-break, mobile-footer-inset
- account: campaign-bar-mobile-wrap
- search: campaign-bar-wrap-mobile, mobile-footer-logo-oversized
- contact: sitewide-campaign-wrap-mobile
- the campaign part of home/header-hero-micro-offsets

## Answer

Built in `71d4732` and fixed after review in `3e5b5fd`. `nowrapRanges` and `glueBreaks` in `src/lib/text.ts` were
written test first (6 new tests).

**Gates:**
- vitest 155/155, `astro check` 0 errors, build green
- routes 27/31 and crawl 22, both equal to the baseline

**Phone campaign bar:**
- 93 → 78 px at 390, and 120 → 78 px at 360
- the hours stay on one line, "Dalshraun 10 -" stays together, and the messages stack, centred, with a gap between them
- a 44px close button

**Review** (3 reviewers): 10 ids closed. Confirmed and fixed:
- the white focus ring on the orange (2.71:1) is now the shared ink ring
- the store-notice "Loka" is underlined

The to-top border change can't be seen in the shots, because the button only appears after scrolling.

**Open for the user:** the campaign bar's text colour. White on #f17e1b is 2.71:1; ink #282828 is 5.43:1. The orange
itself is fixed by decision 3.

**User decision 2026-10-16:** keep the campaign bar's white text as on live. 2.71:1 is an accepted exception, next to the sale price.
