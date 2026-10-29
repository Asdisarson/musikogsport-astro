# Map: musikogsport live clone

Label: wayfinder:map · Tracker: local markdown (`.scratch/live-clone/`)

## Destination

The local headless site (Local site `astro-ms`: WP + Woo on :10025, Astro storefront on :10026) looks and
navigates exactly like live musikogsport.is (Goya), running on the May-3 data. WordPress acts as a true
headless backend: homepage and menus are edited in wp-admin, and WP's own front-end redirects to Astro.
Customers log in at `/min-sida/`.

## Notes

- **Execution is carried into this map** (override of wayfinder's plan-only default, approved 2026-10-06).
  Tickets are build milestones of type `task`. Work one or more per session; runtime-verify each before
  resolving. Reviews are batched: one consolidated /ship at the end (ticket 10), with `wip:` checkpoint
  commits per milestone.
- Plan: `~/.claude/plans/velvety-meandering-flamingo.md` (decision log and the facts it relies on).
- Live site = **read-only visual reference** (visitor GETs only). One visitor cart is allowed in ticket 08,
  never submitted. Never touch production.
- Straumur key is LIVE → never place a Straumur order; mock it.
- Skills: /grill-me already done; superpowers:test-driven-development where logic is testable; /ship at
  ticket 10.
- Site moved 2026-10-02: the old `musikogsport` Local site is in `~/.Trash`. Repo bundle backup is
  `~/Backups/musikogsport-app-astro-2026-10-06.bundle`.

## Decisions so far

- [01 Boot and verify](issues/01-boot-and-verify.md): astro-ms runs the old DB, plugins, uploads and storefront; ports
  unchanged. 6/7 permalink mismatches come from Yoast primary category → ticket 02 adds a filter on
  `wc_product_post_type_link_product_cat`.

- [02 WP headless backend](issues/02-wp-headless-backend.md): astro-ms now runs the **real May-3 dump**
  (prod secrets neutralised, URLs local). mu-plugins: menu-by-location, ACF Forsíða + `/front-page`,
  primary-category permalinks (priority 20), headless mode, password reset. Seeded live's homepage content
  and a 158-item "Aðalvalmynd" menu identical to live's. Bridge `/gera-upp/` change deferred to 08.

- [03 Routing and data layer](issues/03-routing-data.md): live URLs everywhere (`/voruflokkur/`,
  `/verslun/<cat>/<slug>/`, `/page/N/`, `/?s=`), legacy 301s, slash middleware. Store API `mos_and_cat`
  extension for `?kyn=`. vitest-tested path/filter/tree helpers. One `loadArchive` with live's 4 filter
  groups and sort options. 23/23 runtime route checks.

- [04 Shell](issues/04-shell.md): live has cascading dropdowns, not a mega-menu. Campaign bar (2 messages),
  bottom store notice, Goya fullscreen/mobile side menu with sliding panels, search popup, 4-column footer;
  all WP-driven via `siteChrome`. global.css rewritten for the live look (Jost, measured values); dark mode
  and makeover fonts removed. Content pages moved into ticket 05.

- [05 Homepage + content pages](issues/05-homepage.md): the Slider Revolution hero is reproduced as a scaled
  1440×900 canvas (Anton/Oswald), 3-up carousels, 2/1/2/3 banner rows; all ACF-driven. Live card shared with
  ticket 06. Any WP page renders at `/<slug>/` via a tested WPBakery parser; the Ninja contact form is
  cloned onto a WP endpoint.

- [06 Archives](issues/06-archives.md): one `ArchiveView` for shop, category, brand, tag and search,
  pixel-matched to live at 1440/390. Filter sidebar with a collapsible category tree, URL-driven checkbox
  links, Load More with a `/page/N/` fallback, and a full-screen mobile filter panel. Live's titles and
  breadcrumbs per template (shop has no visible title). Header is 90px like live; nav "current" follows WP.

- [07 Product page](issues/07-pdp.md): live's Goya layout within 0–3px. Gallery grid with lightbox (a
  slider with dots on mobile) and a sticky summary. WooCommerce main-term breadcrumbs, the "% Off" pill, a
  Stærðartafla popup, squared swatches with sold-out cross-outs, a stock pill and SKU swap, and live's
  accordion and meta. Boxed description; 5 related products. The waitlist and the wishlist button are gone
  (live has neither).

- [08 Cart / checkout](issues/08-cart-checkout.md): live's side cart, `/karfa/` (WP-driven free-shipping bar,
  Woo shipping calculator) and distraction-free `/gera-upp/` (Woo float fields, Kennitala and skiptimiði
  saved as live's meta). The thank-you page is at `/gera-upp/order-received/<id>/`. The bridge and headless
  priorities are fixed so failure notices survive. Bacs smoke test passed, then the test orders were deleted
  and stock restored.

- [09 Account](issues/09-account.md): `/min-sida/` with JWT sign-in held in the httpOnly `mos_auth` cookie
  (no register form), live's login box and header popup, and WooCommerce's account pages (orders,
  view-order with an IDOR 404, addresses, account details, lost and reset password). Per-visitor limits,
  origin and redirect guards. A signed-in checkout puts the order on the customer.

- [10 Integration + /ship](issues/10-integration-ship.md): crawl and routes green. Five review runs, then
  polish, x-ray (0 Critical) and cleanup (6 category commits). The security review left no finding at ≥ 8;
  an edit-account password-guessing path was fixed anyway (`2ed06a1`). READY WITH NOTES: 13 known
  limitations and the deploy prerequisites are in the ticket. `/verify` is user-invoked and still to run.

- [11 Handoff](issues/11-handoff.md): the trailers were stripped from unpushed commits (trees identical,
  backup branches kept). The main checkout is on `feat/live-clone`, so Local's :10026 serves the clone.
  `feat/storefront-makeover` and `feat/live-clone` are pushed to origin; nothing went to `main` (local `main`
  was moved to the trailer-free twin of its tip). **The map is
  complete.** What's left is the user's: `/verify`, a pull request and merge, and the go-live (out of scope).

## Not yet specified
- Live's search popup may show live results as you type (not checked; the clone submits to /?s=).

## Out of scope

- Production go-live / cutover (separate future effort).
- Refreshing local data from live (decision 2: keep the May dump).
