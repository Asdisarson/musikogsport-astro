# Map: musikogsport "update the categories and the nav" (+ "improve it also")

Label: wayfinder:map · Tracker: local markdown (`.scratch/nav-categories/`) · Branch `feat/nav-categories` off `main` (5ad2e94)

## Destination

A category tree without strays, a main menu built from the catalog (still an ordinary wp-admin menu) whose links all
lead to products, and a better mega-menu / phone menu. Old category URLs keep working (301).

## Decisions (2026-10-29, grill-me)

1. Q1 b: nav fixes + reversible category tidy-up (journaled like `mos-clean`).
2. Q2 c: new menu content (same columns for Konur/Karlar/Börn, by count, thin links dropped) and better presentation
   (mega-menu "Sjá allt" links, phone drill-down "Sjá allt").
3. Q3 a: fold the `ithrott` category tree into the `pa_ithrott` filter; old URLs 301 to `?ithrott=`.
4. Q4 a: `wp mos-nav preview|apply` writes "Aðalvalmynd 2026" into `primary`, keeps the old menu for rollback.
Own calls: 301 map in the storefront (`paths.ts`); club categories → club filter; Didriksons category → brand;
Boltar/Félag-lið merged; Sumar under Æfingavörur; "Didriksons" (`vetur`) renamed Regn- og vetrarfatnaður; the
default category (Óflokkað) is never deleted; hover/focus opening stays CSS.

## Tickets

- [01 Category ops in mos-clean](issues/01-category-ops.md): DONE (applied locally)
- [02 Storefront 301 map](issues/02-redirects.md): DONE
- [03 mos-nav menu builder](issues/03-menu-builder.md): DONE (applied locally)
- [04 Mega-menu + phone drill-down](issues/04-menu-ui.md): DONE
- [05 /ship + runbook](issues/05-ship.md): DONE (READY WITH NOTES)

Map COMPLETE 2026-10-29. Next (owner, on live after deploying the storefront): DEPLOY.md steps 3b and 3c.

## Evidence

Before (2026-10-29): 63 categories (5 empty), Íþrótt tree 84 products vs sport filter ~1,100; club links were text
searches; Vörumerki linked to `/`. After: 40 categories (Óflokkað, the default, the only empty one); menu 236 items,
211 distinct links, every one 200 with products.
