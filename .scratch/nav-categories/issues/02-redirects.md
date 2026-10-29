# 02 Storefront 301 map

Type: task
Status: done
Blocked by: 01
See map.md.

## Built (2026-10-29)

`MOVED_CATEGORIES` + `movedCategoryTarget(segments, search)` in `src/lib/paths.ts` (last slug decides; the request's
filters carry over, the target's own query wins). Used before the 404 in `voruflokkur/[...path].astro` (only when the
category doesn't resolve and the terms aren't degraded) and for single-segment `/verslun/<slug>/`. Sumar keeps its
slug, so the existing canonical-chain 301 covers its move. `facets.ts` roots unchanged (generic rules still hold).

## Verified

vitest `movedCategoryTarget` ×4; live: 11 old URLs 301 to the right targets, unknown category 404.
