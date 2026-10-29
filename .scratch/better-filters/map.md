# Map: musikogsport "much, much better filters"

Label: wayfinder:map · Tracker: local markdown (`.scratch/better-filters/`) · Branch `feat/better-filters` off `feat/nike-look` (3c6fd46)

## Destination

Filters on every listing (shop, category, brand, tag, search) work like nike.com's: instant in-place updates that keep
scroll, open groups and focus; removable active-filter chips and per-group clear; a phone sheet that stays open with
"Hreinsa" and "Sýna vörur (N)"; size as a button grid; price presets, Útsala, Á lager and Íþrótt; counts on every
option and no dead-end options; full keyboard and screen-reader support. Still plain GET links underneath (works
without JS, crawlable, verify_live_routes pins kept).

## Decisions (2026-10-26)

1. Size: option b — a derived, read-only size index in WordPress (new mu-plugin): a hidden taxonomy `mos_size` built from
   BOTH the local "Stærðir"-style product attributes (all misspellings) and global `pa_staerdir`, values normalised
   ("38 2/3" = "382/3", "38,5" = "38.5"), kept in sync on product/variation save, backfilled by a WP-CLI command. Product
   data is never modified. Local only; production needs the plugin uploaded + backfill run later (user).
2. Colour swatches: out (pa_litur on 1.7% of products).
3. Price: preset ranges, no slider (a 111,299,090 kr. variation outlier exists; owner data fix).
4. Gender: keep the `kyn` categories as the source; add counts.
5. Everything else from the storefront; money path untouched; local only; push only on the user's word.

## Tickets

- [01 Size index (WordPress mu-plugin)](issues/01-size-index.md)
- [02 Facets and counts](issues/02-facets.md): dead-end bug, counts everywhere, size grid, price, Útsala, Á lager, Íþrótt, tidy lists
- [03 In-place updates, chips, phone sheet, a11y](issues/03-instant.md)
- [04 Consolidated /ship](issues/04-ship.md): DONE — READY WITH NOTES at `80c8ca7` (2026-10-26)

## Evidence

Audit 2026-10-26: `/private/tmp/claude-501/filters-audit/` (probes, screenshots). Key numbers: 3088 products; 2118 local
size attrs vs 381 pa_staerdir; 353 spellings; 397 on sale; 171 out of stock; collection-data 35–543 ms.
