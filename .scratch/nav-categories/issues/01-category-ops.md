# 01 Category ops in mos-clean

Type: task
Status: done
Blocked by: —
See map.md.

## Built (2026-10-29)

`mos_clean_category_ops()` rule table + `mos_clean_run_category_ops()` (runs inside `wp mos-clean preview|apply`,
after the term hygiene): merge (boltar-2 → boltar-aefingarvorur, felag-lid → liðafatnaður), to_attr (stjarnan, fh,
fimleikafelagid-bjork → `pa_felag-lid` stjarnan/fh/bjork, fallback Liðafatnaður), to_brand (didriksons), sports
(every `ithrott` child → its `pa_ithrott` term via `mos_clean_sport_cats()`, then the root), reparent (sumar under
aefingarvorur), rename (vetur → Regn- og vetrarfatnaður), delete_empty (unisex, uncategorized; oflokkad kept as the
default category). Pure helpers `mos_clean_needs_fallback`, `mos_clean_sport_for_category` (tested).
Journal: deleted entries carry the parent slug, `reparented` list; restore re-creates newest first under the parent.
A variation attribute already carrying the target term just loses the category; one that doesn't is skipped.
Empty checks count existing products only (an orphaned term relationship, object 8486, kept boltar-2 alive).

## Verified

Local apply: 410 products journaled; second apply: nothing left but "keep oflokkad: the default category"; tree 63 → 40
categories; rules test 39/39.
