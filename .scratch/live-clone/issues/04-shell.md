# 04 Shell

Type: task
Status: resolved
Blocked by: 03

## Question

- live palette + Jost
- campaign bar and top bar
- sticky header + mega-menu
- mobile menu and side cart
- footer
- strip the extras (dark mode, recently viewed, estimator, card gallery)

## Answer

**Live reference** (Playwright, 1440 and 390, computed styles; shots in `.playwright-mcp/shots/`, gitignored):
- No dark top bar. The **campaign bar** carries two messages (moved notice + opening hours) with a close
  button. The address/phone line is a separate grey **store notice fixed to the bottom** with "Loka".
- The **menu is not a mega-menu**: cascading 240px dropdowns with flyouts (30px panel padding, 18px #444
  items, a 2px underline on the hovered top item).
- The hamburger opens Goya's fullscreen menu: a 70px #f8f8f8 rail and uppercase 20.7px letter-spaced items
  with sliding sub-panels, then Instagram + e-mail. On mobile it is a top bar, "Leita í vörum…" search,
  19.8px uppercase items, "Back" sub-panels, and an Innskráning row.
- The search popup is a white panel from the top with a 36px underlined field. Footer: 4 columns (stacked
  logo · Staðsetning · Upplýsingar · the 5-item menu 158), then the company line. Back-to-top circle.

**Built:**
- ACF: `campaign_text_right`, `site_logo`, `footer_logo` (seeded; store notice text corrected).
- `siteChrome.ts`: menus by location + front-page chrome, 60 s cache, stale/fallback.
- Components: `CampaignBar`, `StoreNotice`, `SiteHeader`, recursive `NavItem`, `SideMenu`, `SearchOverlay`,
  `SiteFooter`, back-to-top.
- `menuPanels.ts` (vitest) for the sliding panels. Bag/user/instagram/arrow-up icons; the CartButton bag
  icon matches live.
- `Base.astro`: chrome load, pre-paint dismissal flags, overlay script (Escape, focus return, inert,
  scroll lock), live `<title>` pattern "X | Músik & Sport"; `ClientRouter` removed (live does full page loads).
- **global.css rewritten** for the live look: tokens, shell with measured values, plus neutral live-style
  baselines for every class the islands use (216 inventoried).

**Removed:** theme toggle/dark tokens, the Fjalla/Rubik fonts + `fonts.css`, the makeover logo; Jost is now
from `@fontsource/jost` 5.3.0.

**Verified:** side-by-side shots: header/dropdown/flyout, side menu + sub-panel, search overlay, mobile
header + menu, footer all match live closely. Gates: `astro check` 0/0/0, 42 unit tests, 23/23 routes.
Seeded media (2026/10) is served locally, so chrome images skip `mediaUrl()`.
