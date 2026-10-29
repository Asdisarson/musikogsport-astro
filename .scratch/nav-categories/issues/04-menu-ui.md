# 04 Mega-menu + phone drill-down

Type: task
Status: done
Blocked by: 03
See map.md.

## Built (2026-10-29)

`megaMenu.ts`: `isLinkHref` (shared), `MegaGroup.more`, `panel.all`; `NavItem.astro` renders "Sjá allt" under each
linked column and "Sjá allt: <title>" across the panel; `--cols` moved to `.mega` and the grid is
`repeat(var(--cols), minmax(0, 1fr))` so six columns fit one row. `menuPanels.ts`: a sub-panel's `href` is its
"Sjá allt" link (null for heading-only parents); `SideMenu.astro` shows the title as a heading and "Sjá allt" as the
first row. Opening stays CSS hover-intent / focus-within; Escape suppress unchanged.

## Verified

vitest megaMenu/menuPanels; production build at 1440: Konur panel 6 columns on one row, 5 "Sjá allt", footer link;
390: Konur sub-panel "Sjá allt / Fatnaður / Skór / Íþróttir / Félagslið / Vörumerki / Úrval", no overflow.
