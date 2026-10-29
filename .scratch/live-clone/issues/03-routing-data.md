# 03 Routing and data layer to live URLs

Type: task
Status: resolved
Blocked by: 02

## Question

- live URL routes
- the `page/N` segment
- slash middleware
- legacy 301s
- `productPath`
- live filter vars (`kyn`, `brand`, `team`, `product-category`, `orderby`)
- sitemap, robots and JSON-LD

## Answer

**WP side** — the Store API takes only ONE product_cat clause, and `category_operator=and` returns 0 on
hierarchical terms (WP expands every child into the AND set). `mos-headless-api.php` adds
`mos_and_cat=<ids>`: an extra AND'ed product_cat clause, via `pre_get_posts`, plus a
`woocommerce_pre_product_filter_data` recompute so the FilterData transient cache doesn't serve
unfiltered counts. HTTP test `wp-mu-plugins/tests/store_api_and_cat_test.py`: fatnadur 2086 → ∩konur 681,
brand counts 1844 → 589.

**Pure modules, test-first with vitest (39 tests, `npm test`):**
- `src/lib/paths.ts`: `productPath`, `categoryPath`, `splitPagination`, `archiveHref`, `slashRedirect`
  (legacy /leita and /vara/ exempt, so their 301s stay single-hop)
- `src/lib/liveFilters.ts`: live WCPF vars → Store API filter; live's 4 sort options; toggle/clear hrefs
- `src/lib/categoryTree.ts`: chain, canonical-path resolution, breadcrumb trail

**Server:**
- `catalogTerms.ts`: categories, brands, teams (attr 5), tags; 10 min cache, stale on error.
- `storeCatalog.ts`: categoryIds / andCategoryIds / tagIds, 27 per page, keeps permalink + categories,
  generic `collectionCounts`.
- `archive.ts`: one loader for every archive. Groups use live's order, labels and count/collapse
  settings: Aldur/Kyn, Vöruflokkar (tree), Vörumerki, Félag/Lið.

**Routes:**

| URL | Route |
|---|---|
| `/verslun/` | shop |
| `/verslun/page/N/` | shop pages |
| `/verslun/<cat path>/<slug>/` | product page; non-canonical → 301; one-segment category → 301 `/voruflokkur/` |
| `/voruflokkur/<chain>/[page/N/]` | category archive (short chain → 301) |
| `/brand/<slug>/`, `/merkimidar/<slug>/` | brand and tag archives |
| `/?s=…&post_type=product`, `/page/N/?s=…` | search (home URL rewritten to `page/[n]`) |
| `/vara/<slug>`, `/leita?q=` | legacy 301s |

- Middleware 301s slash-less GET page paths (like WP).
- Sitemap uses live URLs (3,152); robots disallows `?s=`, cart, checkout, account; the SearchAction
  target is updated.

**Removed:** the old `verslun/[category]`, `ShopFilters`, `facets.ts`, `query.ts`, `RecentlyViewed` (decision 8),
and the dead woo search/attribute helpers. The wishlist snapshot and `/api/products` carry `path`; cart lines
link via `productPath`.

**Verified:** `astro check` 0/0/0, build green, and `scripts/verify_live_routes.py` 23/23 against :4322
(27/page, distinct page 2, kyn 2086 → 681, brand/tag/search archives, all redirects single-hop,
sitemap shapes). The archive UI is still the basic version; ticket 06 restyles it to live (filter popup,
load more).
