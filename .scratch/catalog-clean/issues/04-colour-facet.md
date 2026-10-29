# 04 Colour facet + swatches

Type: task
Status: done
Blocked by: 02 (data)
See map.md.

## Built (2026-10-29)

- `litur=<slug,…>` URL key → `pa_litur` attribute clause (OR within) in `liveFilters.ts`; terms loaded like Íþrótt
  (optional, fallback attribute id 2) in `catalogTerms.ts`; counted in the main collection-data request
  (`COUNT_TAXONOMIES.colour`, no extra request); robots.txt disallows `?litur=` like the other facets.
- `archive.ts`: Litur group after Vörumerki, commonest colour first, `swatch` per option from `facets.colourSwatch()`
  (recovered from c76f3cd, re-keyed to today's slugs; two-colour slugs split diagonally; unknown → no dot).
- `FilterOption.astro` + `global.css`: 14px dot with a 3:1 ring so white keeps an edge; 8px gap so "Svartur (315)" fits.
- Plugin: the two-colour terms typed in capitals renamed (Blár/hvítur …, Dusty Pink → Ljósbleikur).

## Verified

vitest (archive, facets, liveFilters cases), preview against the cleaned local DB: shop Litur = Svartur 315, Blár 260,
Bleikur 217 …; clicking Svartur on Skór swaps in place to `?litur=svartur`, 40 products (all black by name), chip
"Svartur", title "Skór – Svartur".
