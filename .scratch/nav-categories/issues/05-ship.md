# 05 /ship + runbook

Type: task
Status: done
Blocked by: 01, 02, 03, 04
See map.md.

## /ship (2026-10-29) — READY WITH NOTES

- /code-review high: 7 findings. Fixed: a merged/moved category with subcategories is kept (deleting it would lift
  them to the top level, unrestorable); `mos-nav apply` builds a fresh menu and swaps it in only when complete; a
  failed brand assignment puts the category back; ranking deduplicated (`mos_nav_top`). Dismissed: `hlaup` /
  `fimleikar` 301s (live categories, not Íþrótt children); TS/PHP map mirroring (cross-runtime, "keep in step");
  count performance (1.7 s).
- Spec axis: Didriksons brand now creatable (`mos_clean_created_terms`); stale comments updated. Kept on purpose: no
  "Öll vörumerki" link (no brand index page exists); phone row says "Sjá allt" under the panel title.
- /polish: `mos_nav_write` previous-menu logic folded.
- /x-ray (5 lenses, 0 critical). /cleanup: clubs before the felag-lid merge; preview and apply decide deletes the
  same way (subcategories already emptied don't count; "keep … still has products" logged); reparent journaled after
  it succeeds; summaries count what changed ("N of M"), products left without a category reported, Didriksons falls
  back to Regn- og vetrarfatnaður; restore counts reparents separately; menu writer checks delete/rename and the
  half-built-menu cleanup, refuses an empty menu, guards a null DB result, clears the old menu's transient.
- /security-review: x-ray security lens on this change set — no findings (redirect targets are constants, menu hrefs
  pass the existing guards, SQL prepared, CLI-only writes); cleanup added no input/output surface.
- /verify: PASS — restore of both category journals brought the original 63-category tree back exactly; one apply
  with the final code did the whole tidy-up (40 categories, Óflokkað the only empty one as the default); second
  preview: nothing pending; `mos-nav apply` 236 items; production build: 211 menu links 200 with products, 11 old
  URLs 301, unknown 404, `verify_live_routes.py` 32/32; screenshots 1440 (6 columns, one row) and 390 (drill-down).

## Notes left open

- `/verslun/<a>/<b>/` URLs of removed categories 404 (only single-segment legacy `/verslun/<cat>/` redirects).
- `MOVED_CATEGORIES` mirrors the PHP ops by hand.
