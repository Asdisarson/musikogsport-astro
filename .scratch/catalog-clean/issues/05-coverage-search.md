# 05 Coverage hiding + list search

Type: task
Status: done
Blocked by: 04
See map.md.

## Built (2026-10-29)

- `facets.coversEnough()`: Íþrótt, Félag/Lið and Litur are left out when their options together cover < 10%
  (`MIN_GROUP_COVERAGE`) of the products in view. Coverage = sum of option counts capped at the total — deliberately
  not the largest single option (the plan's first idea), which would hide Félag/Lið on the whole shop (no club > 3%,
  clubs together 13%). Kept when unsure (no counts / no total) and whenever an option is active.
- Search box above list groups with > 12 options (`LIST_SEARCH_MIN`): hidden in the markup, shown by the script (no
  dead box without JS); accent/Icelandic-insensitive, every word must match (`archiveNav.matchesSearch`); "Ekkert passar
  við leitina." when nothing matches; the typed text survives the in-place swaps.

## Verified

vitest (coversEnough ×5, matchesSearch ×3); preview: Skór (581) hides Félag/Lið, keeps Íþrótt (284) and Litur (196);
"kef" in Félag/Lið leaves Keflavík; phone sheet 390px, no overflow.

Known: product 55250 keeps "Keflavik" and 172693 "Argentína treyja" (variation attributes, skipped by the cleanup) —
the owner can fix them by hand in wp-admin.
