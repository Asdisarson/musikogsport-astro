# 01 Plugin + term hygiene

Type: task
Status: done
Blocked by: —
See map.md.

## Built (2026-10-29)

`wp-mu-plugins/mos-catalog-clean.php` (installed copy byte-identical). WP-CLI `wp mos-clean preview|apply|restore`,
journal in `uploads/mos-clean/journal-<time>.json` (product snapshots of categories, brand, club, sport, colour and
`_product_attributes`; created/renamed/deleted terms), written after every batch.

Hygiene table: 9 merges, 7 renames, 6 moves (sports and garment words out of Félag/Lið, ISLAND out of Litur), 21 empty
colour terms deleted. Skipped by design (variation attributes): 55250, 172693, 168683, 200673, 195977.

## Gotcha found

Editing a product's existing `WC_Product_Attribute` in place makes `set_attributes()` see no change, so `save()`
skips the attributes. The first apply left merges undone (new attributes were fine). Fix: clone before editing.

## Verified

- `php tests/mos_clean_rules_test.php` 33/33; `php -l` clean.
- restore of both journals → exact baseline (coverage, 45 colour terms, original names); re-apply → same numbers.
