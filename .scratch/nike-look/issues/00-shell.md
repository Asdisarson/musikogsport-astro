# 00 Tokens, type, shell

Type: task
Status: done
Blocked by: 00 Foundation

## Question

See map.md Destination and the matching nike.com section in reference/SPEC.md.

## Answer (2026-10-20, built, uncommitted: the orchestrator verifies and commits)

**Packages:** `@fontsource/inter@5.3.0` (latin 400/500/600) and `@fontsource-variable/archivo@5.3.0`, whose
`wdth.css` has the width axis (62–125%). The display face is used at `font-stretch: 75%` (the Condensed instance).
Both packages are in package.json and the lock. They were installed into the shared main-checkout node_modules with
`--no-save`, and the worktree `node_modules` is still the symlink. The Jost, Anton and Oswald imports are gone; their
packages stay in package.json because the main checkout's branch still uses them (left for /ship).

**Tokens:**
- `--ink`/`--text` #111, `--meta`/`--muted` #707072, `--line` #CACACB, `--surface` #F5F5F5, `--disabled-text` #9E9EA0.
- `--accent` #D33918, for labels only. `--campaign` and `--notice-bg` were removed.
- Type: `--fz-body` 16px, `--lh` 1.75, `--lh-tight` 24px.
- Controls: `--control-h`/`--control-h-lg` 60px, `--field-h` 48px, `--radius-pill` 30px, `--radius-size` 4px.
- Layout: `--gutter` 48px (24px at ≤991), `--header-h` 60px, `--utility-h` 36px.
- Display: `--font-display` + `--display-stretch`, and a `.display` utility.
- Headings 500, strong 600 (no synthesized bold). `theme-color` was already #ffffff.

**Shell:**
- The utility bar (CampaignBar.astro) shows the WP campaign messages on the left and Verslun | Opnunartími | Hjálp |
  Innskráning on the right. On phones it shows the first message only, on one line with an ellipsis.
- The main bar is sticky, 60px, with no border. It has a 105×32 logo, the centred WP menu, then a search pill,
  wishlist (`data-wish-count`) and bag (count badge #111, not accent).
- Mega-menu (lib/megaMenu.ts + test):
  - grouped columns when depth-1 items have children; one list flowed into columns of at most 7 rows when all are leaves
  - depth ≥3 renders as nested lists
  - the page is dimmed by the panel's clipped shadow
  - Escape closes the panel and returns focus to the top link
  - .4s cubic-bezier(.6,0,.1,1)
- Drawer: from the right at ~80% width (Nike measured ~82%) over a dimmed page. Rows are 24px/32 with chevrons;
  sub-panels are 20px. It ends with Innskráning (black pill) and Óskalisti (outline pill).
- Search: a white sheet that drops over the header, with a #F5F5F5 48px pill field and a focus-within ring.
- Store notice: a white strip, 14px #707072 text, 1px top line, 44px "Loka". The footer bar keeps room for it.
- Footer: four columns.
  - Verslun = WP primary top level; Hjálp = WP footer menu; Um okkur; Hafðu samband = `chrome.footer`.
  - Bottom bar: Ísland · WP company line · Skilmálar, Persónuvernd.
  - Under 992px the columns are `<details>` accordions.
- Checkout header: 60px tall, 32px logo.

**Deviations, with the reasons:**
1. Header breakpoints were measured (harness `nav-fit.mjs`). The 10-item WP menu is about 875px wide at 16px.
   - ≥1400: the full bar.
   - 1200–1399: search becomes an icon, and items sit 16px apart.
   - 992–1199: the menu moves to the drawer (hamburger).
   - ≤991: the phone bar.
2. Text inputs keep the 3:1 `--field-border` (#949494), as WCAG 1.4.11 requires; #CACACB is 1.6:1. Outline pills use #CACACB.
3. Icon buttons are 44×44, not 36, for the hard 44px tap-target rule.
4. The utility bar has no close button: a 36px bar can't hold a 44px target. A stale "campaign dismissed" flag no
   longer hides anything.
5. The search sheet covers the header row, as Nike's does, instead of sitting under it.
6. The checkout header is inset 15px/20px to line up with `.checkout-wrap`, which area 04 re-pads.
7. Hero (area 01): the Anton/Oswald rules point at the display face. The title is at 62% width so it doesn't run into its price.
8. `.vc-row` drops its column gap at ≤991. This fixes a pre-existing 320px overflow, which the wider gutter made worse.
9. The footer logo was dropped, to keep the Nike text-only footer.

**Fixed during verification:**
- A mega panel that is fading out (400ms) no longer catches the pointer: it has `pointer-events: none` until it
  is open. Before the fix, a fast sweep from Fatnaður to Konur reopened Fatnaður.
- The store notice keeps "555-2887" on one line (`nowrapRanges`).

**Gates, all on the final build:**
- vitest 190/190 (185 + 5 new megaMenu); astro check 0 errors (1 pre-existing hint in auth.ts); build OK
- routes 31 PASS; crawl OK
- hscroll 0 on 8 pages × 15 widths (320–1920)
- console-check: 0 errors on 7 pages (/, archive, contact, wishlist, account, cart, checkout with an item) at 1440 and 390
- mega-probe 1440: the fast sweep opens Konur; Tab goes into the panel, Escape closes it and focus returns, the next Tab opens Börn

**Shots:**
- `harness/shots/area00/` (1440/390/360, plus mega-*, footer-*, top-*, drawer-sub-*)
- `harness/shots/area00-mid/` (1280/1024)

**Open questions:**
- The utility "Verslun" goes to /hafa-samband/, while the main-menu "Verslun" goes to /verslun/: two links with the
  same name and different targets.
- Unused Jost/Anton/Oswald packages should be removed at /ship.
- The new fonts are in the shared main-checkout node_modules but not in its package.json, so an `npm install` or
  `npm prune` there removes them and breaks this worktree's build. Re-run
  `npm install --no-save --ignore-scripts @fontsource/inter@5.3.0 @fontsource-variable/archivo@5.3.0` from the main
  checkout if that happens.
- On a touch tablet at ≥1200px, a top item navigates on tap. There is no tap-to-open for the panels.
