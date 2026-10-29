# 06 Consolidated /ship + owner runbook

Type: task
Status: done
Blocked by: 01, 02, 03, 04, 05
See map.md.

## /ship (2026-10-29) — READY WITH NOTES

- /code-review: findings fixed before polish (refill of cleared values → `_mos_clean_filled`; preview/apply term
  resolution unified; brand-key collisions ambiguous; search keeps checked rows; restore docs; save-hook cost).
  Spec axis: no missing requirements.
- /polish: done.
- /x-ray (5 lenses): 0 critical. /cleanup fixed:
  - save hook only for catalog editors (`edit_products` or WP-CLI) — checkout stock saves no longer fill;
  - journal: random file suffix, `.htaccess` + `index.php` deny (nginx needs a server rule; DEPLOY.md says so);
  - every term write checked (`mos_clean_warn`); a delete is journaled only after it succeeded; journal saved after
    every term op; per-product catch in the hygiene phase; cache invalidation never throws;
  - restore: file/keys validated, per-product catch, failure tally, `finally` resets the running flag;
  - brand pre-pass skips fields filled before; preview counts the colour terms merges would empty;
  - `run` / term ops split (`open_journal`, `create_brands`, `fill`, `report`, `mos_clean_rename_term`,
    `mos_clean_move_products`, `mos_clean_delete_unused_colours`);
  - `colourSwatch` uses `Object.hasOwn`, no cast; fold helpers cross-reference each other.
- /security-review: no findings ≥ 8 confidence.
- /verify: PASS — restore → apply cycle on the local DB gives the same coverage (brand 93.1, gender 93.2, sport 37.0,
  colour 39.4 %); preview after apply sets 0; restore rejects a missing / non-journal file; Store API colour test
  PASS; dev server: Litur with 19 swatches, `?litur=svartur` 3088 → 315, unknown `?litur=constructor` ignored,
  Skór hides Félag/Lið and keeps Litur; `verify_live_routes.py` 32/32.

## Notes left open

- `loadArchive` is still ~200 lines (pre-existing); the colour post-processing stays inline.
- Local's nginx serves the journal folder (`.htaccess` ignored) — local dev only; DEPLOY.md covers live.
- A product nothing can be inferred for re-runs the check on every editor save (cheap; editors only).
