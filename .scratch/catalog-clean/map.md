# Map: musikogsport "make the filters work better" (catalog data + Colour facet)

Label: wayfinder:map · Tracker: local markdown (`.scratch/catalog-clean/`) · Branch `feat/catalog-clean` off `feat/do-ready` (868de97)

## Destination

The shop filters find most products: brand, gender, sport and colour filled on the catalog wherever a rule can tell,
term typos and duplicates gone, a Colour filter with swatches, near-empty filter groups hidden, and a search box in
long option lists. The data fix is a repeatable WP-CLI command the owner runs on live (preview → apply, restorable).

## Decisions (2026-10-29, grill-me)

1. Scope: data cleanup as a WP-CLI command (local first, owner runs it on live) + filter UI changes.
2. Full cleanup: I decide ambiguous cases; every run is preview-first and journaled for `restore`.
3. Infer sport, gender, colour (and brand) from categories, `pa_kyn`/`pa_aldur`/`pa_vorumerki` and name words; set
   only on exactly one match; conflicts reported.
4. UI: Colour facet with swatches; hide Sport/Club/Colour when they cover < 10% of the current results; search box in
   long lists. **Supersedes better-filters decision 2 ("Colour swatches: out").**
5. Storage: WooCommerce's own fields (`pa_ithrott`, `pa_litur` hidden + non-variation, Kyn categories, `product_brand`).
6. Save hook fills empty fields on new/edited products; never overwrites.
Own calls: Björk stays a club (Fimleikafélagið Björk); multi-colour terms (BLÁR/HVÍTUR …) left as they are; adult
Unisex = Karlar + Konur; products using a term for variations are skipped (3 products, listed by `preview`).

## Tickets

- [01 Plugin + term hygiene](issues/01-plugin-hygiene.md): DONE
- [02 Backfill + inference](issues/02-inference.md): DONE (applied locally)
- [03 Save hook](issues/03-save-hook.md): DONE
- [04 Colour facet + swatches](issues/04-colour-facet.md): DONE
- [05 Coverage hiding + list search](issues/05-coverage-search.md): DONE
- [06 Consolidated /ship + owner runbook](issues/06-ship.md): DONE (READY WITH NOTES)

Map COMPLETE 2026-10-29. Next (owner): run DEPLOY.md step 3b on live after the plugin is uploaded.

## Evidence

Survey 2026-10-29 (3088 published products): brand missing 13.6%, gender 37%, sport 91%, club 87%, colour 98.5%.
Full SQL backup before any write: `Local Sites/astro-ms/backups/pre-catalog-clean-2026-10-29.sql` (591 MB).
