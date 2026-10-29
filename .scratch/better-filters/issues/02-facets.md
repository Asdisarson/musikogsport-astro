# 02 Facets and counts

Type: task
Status: done (uncommitted, awaiting orchestrator verify + commit)
Blocked by: 01

See map.md.

## Built (2026-10-26, server-rendered only; ticket 03 adds in-place updates, chips, sheet buttons)

- **Dead-end bug:** `collectionCounts` now returns `null` on failure (non-2xx, transport error) and empty maps for an
  empty result; `keepOption` (lib/facets.ts) hides zero-count options when counts are known, shows all only on
  failure, always keeps active ones. `/voruflokkur/skor/?kyn=konur` no longer lists Félag/Lið at all; the old
  dead-end URL `…?kyn=konur&team=argentina` lists only the selected (removable) team.
- **Counts on every option**, zero hidden: Aldur/Kyn (companion request without kyn), Vöruflokkar, sizes, price,
  Útsala, Á lager, Íþrótt, Félag/Lið, Vörumerki.
- **New URL keys** (lib/liveFilters.ts): `staerd` (→ `mos_size`, OR, validated against GET mos/v1/sizes; ignored
  if the size index is absent), `verd` (`0-5000` `5000-10000` `10000-20000` `20000-`, single-valued; max bound is
  hi−1 since Store API bounds are inclusive and ISK is whole krónur), `utsala=1` (→ `on_sale=true`), `lager=1`
  (→ `stock_status[]=instock`), `ithrott` (→ `attributes[]` pa_ithrott, OR).
  Verð semantics: single-valued **checkbox** (role=checkbox; choosing a preset replaces the current one, choosing the
  current one clears it), so every filter link keeps one role.
- **Attribute ids** looked up by taxonomy from /products/attributes (fallbacks 5 = pa_felag-lid, 6 = pa_ithrott).
  Íþrótt is optional: id 6 only when the list can't be read, none when the list lacks pa_ithrott, and a failed
  fetch leaves the group out instead of failing the term sweep (which would 503 every category).
- **Rail order:** category links → Útsala / Á lager rows → Stærð → Aldur/Kyn → Verð → Vörumerki → Íþrótt →
  Félag/Lið → Vöruflokkar (shop, brand, tag, search; on a category page only while a product-category is active).
  Groups with a selection open; Stærð opens on `skor` and below; others closed; headings show "(N)".
- **Stærð grid:** 4 × 48px buttons at 192px (13px labels; >6-character labels span two cells), blocks shoe → letter →
  kids → other with 14px #707072 headings (only when >1 block). With >28 sizes the 24 best-stocked + every selected
  one show; the rest appear in place via "Sýna allar stærðir" (`<details>` + `:has()`; no `:has()` = all shown).
  Deviation from "first ~24 shoe sizes": on Skór the first 24 by number are children's 17–29, so visibility is by
  stock, order is by size.
- **Pseudo-categories** hidden from Vöruflokkar (lib/facets.ts `pseudoCategoryIds`): name = a product_brand name
  (Didriksons ×2), the `felag-lid` root and its subtree, or — outside the `ithrott` subtree — name = a pa_felag-lid
  term or ends with one as a whole word (Stjarnan, FH, "Fimleikafélagið Björk"). Íþrótt children (Fótbolti,
  Körfubolti) are exempt because pa_felag-lid has stray sport terms.
- **Phone pills** for every group incl. Útsala (opens the sheet focused on the toggle block; its "(N)" counts only
  utsala), Stærð, Verð.
- **Title:** "Skór – Nike, Konur, 42, Útsala | Músik & Sport" (canonical still strips filters).
- **Cache:** collection-data results cached in-process 60s keyed by request URL (failures never cached; stale served
  on failure). The grid is never cached.
- No WordPress PHP change: stock counts honour `mos_and_cat` and `mos_size` in either request order (probed).

## Measurements (Local, php-fpm `pm.max_children = 2`)

Store API calls per render (logging proxy, same method before/after):
| URL | before | after, counts miss | after, counts hit |
|---|---|---|---|
| /voruflokkur/skor/ | 2 | 7 | 1 |
| /verslun/ | 2 | 7 | 1 |
| skor ?brand=nike&kyn=konur | 4 | 9 | 1 |
| skor ?staerd=42&brand=nike&kyn=konur&utsala=1 | 4 | 8 | 1 |

Render times (ms): warm median Skór 270 → 280 (+10), /verslun/ 216 → 232; first visit of a new filter
combination (counts miss) median 222 → 341 (+~120: five extra ~45 ms collection-data calls queue on 2 PHP workers).

## Gates

vitest 28 files / 296 tests; astro check 0 errors 0 warnings 1 hint (auth.ts, pre-existing); npm run build OK;
verify_live_routes 31 PASS; crawl_links OK; Playwright probe 36 PASS (counts consistency, dead end, presets, toggles,
pills, hscroll 0 at 320–1920, console clean); HTTP consistency probe 65 samples across 5 contexts, 0 mismatches.
Probe scripts and shots: /private/tmp/claude-501/bf02/, /private/tmp/claude-501/filters-audit/bf02-probe.mjs.

## Open

- The 60 s counts cache can, for up to a minute after a stock change, list an option that no longer has products
  (a brief dead end). Shorten the TTL or leave the main counts call uncached if that matters more than speed.
- Smoke-tested also: /brand/nike/?kyn=konur, /merkimidar/nike/?utsala=1, /?s=nike&post_type=product&brand=nike,
  /page/2/?s=nike&post_type=product&lager=1 (all 200, titles carry the filters, search links keep s/post_type).

- Count-cache misses cost ~+120 ms locally; a PHP `mos_price_counts` on the main collection-data call would remove
  4 of the 5 extra calls if production shows the same.
- /verslun/ rail category links (railCategoryLinks) still list Didriksons, Félag/lið, Stjarnan, NETTILBOD, Sumar;
  Vöruflokkar duplicates those links on /verslun/ by the brief's wish. NETTILBOD overlaps Útsala.
- Íþrótt data duplicates (snjóbretti / Snowboarding) left as-is.
