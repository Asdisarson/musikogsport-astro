# 03 mos-nav menu builder

Type: task
Status: done
Blocked by: 01
See map.md.

## Built (2026-10-29)

`wp-mu-plugins/mos-nav.php`: pure builder `mos_nav_tree($index)` over an in-memory catalog index (published products'
categories, brands, clubs, sports); `wp mos-nav preview` prints the tree with counts, `apply` writes
"Aðalvalmynd 2026" (custom links, `#` for headings) into `primary`, clears the `mos_menu_<id>` transients and keeps the
previous menu. Top level: Konur · Karlar · Börn · Skór · Íþróttir · Æfingavörur · Vörumerki · Útsala. Gender columns:
Fatnaður, Skór (leaf categories + `?kyn=`), Íþróttir (`?ithrott=`), Félagslið (`?team=`), Vörumerki
(`/brand/<b>/?kyn=`), Úrval (Vinsælt núna, Nýjast, Útsala). ≥ 5 products per link, ≤ 8 per column.

## Verified

`tests/mos_nav_rules_test.php` 17/17; local preview in 1.7 s; apply wrote 236 items (previous "Aðalvalmynd" kept).
