# 00 Foundation: tokens, shared controls, copy

Type: task
Status: resolved (approved by the user 2026-10-16, no copy vetoes; review page: https://claude.ai/artifact/PAj89fHkHy7KKr4gbHk4vC)
Blocked by: —

## Question

New tokens: `--meta` #767676, `--field-border` #949494, `--field-border-surface` #8a8a8a, `--sale-strong` #c8372d,
`--control-h` 48px / `--control-h-lg` 57px. Changed: `--muted` → #767676, `--good` → about #2f7d49.

Changes:
- Small text that used `--faint` moves to `--meta`.
- Every field gets a 1px field border, with focus shown as an ink border plus a 1px ink shadow.
- Labels use `--text` instead of opacity.
- Checkboxes and radios become 20px.
- Shared button metrics and states, with `.pill-btn` made square.
- Leftover English becomes Icelandic, with a veto table on the review page.
- New `formatSaleBadge` in `src/lib/price.ts`, written test first.

Closes:
- archive: faint-text-contrast, filter-checkbox-contrast, english-ui-labels
- search: low-contrast-greys, mixed-language-labels
- checkout: mixed-english-copy, low-contrast-borders-meta, small-checkboxes-radios
- account: field-label-contrast, input-checkbox-border-contrast, checkbox-undersized
- contact: form-low-contrast
- cart: meta-low-contrast
- home: intro-pill-buttons
- pdp: english-badge-share-copy
- the copy part of cart/checkout duplicate-samtals

## Answer

Built in `278b5e5` and fixed after review in `c1a5a09`.

**Gates:**
- vitest 149/149, with the new `formatSaleBadge` test written first
- `astro check` 0 errors, build green
- routes 27/31 and crawl 22, both equal to the baseline (missing key)

**Harness** (69 page shots): contrast failures went from 3,345 to 462.

**Review workflow** (4 reviewers, 2 skeptics per claimed regression):
- 15 ids closed
- 1 partial, fixed afterwards: the 13px shipping radios are now 20px
- 1 not visible until the key is back (pdp copy)

Regressions that were confirmed and fixed:
- the focus ring leaked onto borderless controls: the search overlay, the side-menu search, the sort select and the quantity box
- checkbox and grey-panel field focus was two-tone
- the side cart's subtotal still said "Samtals"
- English or stray quotes in the tag crumb and the search and brand tab titles

Open for area 01: white text on the campaign bar's orange is 2.71:1, while ink on the same orange would be 5.43:1. Ask
before changing it, because the palette is fixed.
