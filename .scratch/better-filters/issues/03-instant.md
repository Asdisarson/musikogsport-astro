# 03 In-place updates, chips, phone sheet, a11y

Type: task
Status: done (uncommitted, awaiting orchestrator verify + commit)
Blocked by: 02

See map.md.

## Built (2026-10-26)

- **In-place updates** (ArchiveView script + pure `src/lib/archiveNav.ts`). This is progressive enhancement over the same
  GET links. Filter options, chips, the per-group "Hreinsa", "Hreinsa allt", the sheet's "Hreinsa", "Endursetja" and
  the sort select are intercepted through one delegated listener on `[data-archive]`. Category links stay full
  navigations.
  - **Fetch and swap.** Each click fetches the URL and swaps the `[data-swap]` regions: title (h1 + count), sort form,
    phone pills, chips, rail body, sheet actions, `role=status`, grid and Load More. `document.title` updates too.
  - **Composing clicks.** Each click is applied to the *pending* URL (`applyOp`), so quick clicks compose. A click when
    idle fetches at once. A click during a fetch aborts it (`AbortController`) and fetches the composed URL after 120 ms
    with no further clicks.
  - **Fallbacks.** A failure, non-200 or non-archive answer falls back to `location.href = url` (`reload()` on
    popstate). Cmd/ctrl/shift/alt and middle clicks are left to the browser.
  - **History.** `pushState` per swap. `popstate` fetches and swaps without reloading, restoring that entry's saved
    scroll. A hash-only entry (the `#main` skip link) is ignored. `history.scrollRestoration = 'manual'` is set only
    once enhanced, and set back to `auto` on `pagehide`.
  - **What is kept.** Open `<details>` groups (by group key), "Sýna allar stærðir" and the sub-category trees are kept.
    The rail scroll is anchored on the control in use: it stays at the same pixel, and the foot is padded when fewer
    options below would clamp the scroll. The page scroll is kept. If the grid ends above the viewport, its top is
    brought back, but never while the sheet is open.
  - **Focus.** Focus returns to the same control by `data-fkey`. The fallbacks are: the group heading after a group
    clear; the next chip, then the chips heading, then the title, after a removed chip; the sheet's close button
    inside the sheet.
  - **Busy state.** `aria-busy` is set on the main region and the grid fades to 0.45 after 100 ms.
  - **Announcements.** A polite live region that is in the HTML from the first paint says "Sýni N vörur" or "Engar
    vörur fundust" (`countWord`). It is cleared and then written on the next frame. While the sheet is open, a second
    region inside the sheet is used, because `aria-modal` hides the first. The `role=status` line is swapped as a node,
    so it is not announced twice.
  - **Wishlist.** Swaps and Load More dispatch `mos:wishlist`, so new cards show their wishlist state. Load More was
    missing this before.
- **Active-filter chips** are server-rendered, in title order (`facets.activeFilterList`, now also the source of the
  title labels). Each is a 38px pill (44px hit area), r30, 1px #cacacb, 14px, with an × icon and the accessible name
  `aria-label="Fjarlægja Nike"` (sizes: "Fjarlægja stærð 42"). They are plain `rel=nofollow` links. "Hreinsa allt"
  follows them. The row is hidden when nothing is active.
- **Per-group "Hreinsa".** `liveFilters.clearFilterHref` builds the URL. The link sits beside `<summary>`, positioned
  in its row, not nested in it, so it never toggles the group. In the 192px rail the group's "(N)" is visually hidden
  but still read by screen readers while "Hreinsa" shows. Otherwise "Vöruflokkar (1)" wraps. The sheet keeps the count.
- **Phone sheet.**
  - It stays open while filtering.
  - Top bar: "Sía" and a close (×) button.
  - Sticky bottom bar: "Hreinsa" (an outline pill, a plain link; disabled with no filters) and "Sýna vörur (N)"
    (black; N is the live total; it closes the sheet).
  - `role=dialog` and `aria-modal` apply only while open; on desktop it stays a complementary landmark.
  - Tab and Shift+Tab are trapped. Escape closes. Focus returns to the opener pill, found again by key after swaps.
  - Body scroll is locked. The sheet closes on resize to desktop.
- **Keyboard.** Space toggles the `role=checkbox` links without scrolling the page.
- **No JS on phones.** Without JS the pills are hidden and the rail sits in the page above the products (before, the
  phone filters were unreachable without JS).
- **Follow-ups from 02.** `/verslun/` rail links now skip the pseudo-categories (`railCategoryLinks(..., hidden)`).
  The counts cache TTL is 30 s (was 60 s).

## Gates

- vitest: 29 files, 316 tests (296 + 20).
- `astro check`: 0 errors, 0 warnings, 1 hint (pre-existing).
- Build: OK.
- `verify_live_routes`: 31 PASS. `crawl_links`: OK.
- Playwright probe `/private/tmp/claude-501/filters-audit/bf03-probe.mjs`: 167 PASS, 0 FAIL. The sort probe
  `bf03-sort.mjs` passes. Click to swapped DOM: median about 370 ms over 11 clicks (280–480 ms), almost all of it the
  server render on a counts-cache miss.
- Screenshots are in `/private/tmp/claude-501/bf03/`.
- Extra probe `bf03-extra.mjs`: ALL PASS.
  - Back and forward restore each entry's own scroll (0 / 400 / 900 / 200, exact).
  - Filter in place, open a product, go back: the filtered list returns at the same scroll (700 → 700; the page was not
    in the bfcache, so the `pagehide` → `auto` switch works).
  - Deep in a long list (scroll 13714), a filter that shrinks the grid brings the grid top back (1014, cards in view).
  - Rapid clicks make exactly 2 archive fetches: the first at once, then the composed URL.
  - Search and brand archives also update in place.
- Timing split.
  - Warm server: fetch + body about 241 ms, DOMParser about 3 ms, swap + layout about 7 ms. The client adds about
    10 ms.
  - Cold combinations: about 420 ms in place, against 403 ms DOMContentLoaded for a full navigation.
  - The gain is kept scroll, focus, open groups and no reload, not raw speed. Speed depends on the server's counts
    calls; see 02's Open note on `mos_price_counts`.

## Deviations (decided here)

- Desktop rail: while a group shows "Hreinsa", its "(N)" is visually hidden but still read by screen readers. The
  phone sheet keeps it.
- "Endursetja" stays in the desktop rail beside the chips' "Hreinsa allt". It is hidden on phones, where the sheet
  has its own "Hreinsa".
- The scroll rule ("unless the grid top is below the fold … don't jump") is read as: keep the page scroll, but if the
  swapped grid ends above the viewport, bring its top into view. Nothing moves while the sheet is open. When the sheet
  closes after a change, the results' top is brought into view if it is above the viewport.

## Open

- NETTILBOD and Sumar are still listed on `/verslun/`, both as rail links and in Vöruflokkar. 02's pseudo rule only
  covers brand and club names; Didriksons, Félag/lið and Stjarnan are now gone. Hiding merchandising buckets would
  need a new rule (for example a slug list). This is the owner's call.
- With a very short grid (2–3 cards) the archive container ends inside the viewport, so the sticky rail moves up with
  it (about 47 px in the probe). This comes from the layout, not from the swap.
- `<link rel=next/prev>` and the canonical in `<head>` are not swapped. They matter only to crawlers, which take the
  no-JS path.
