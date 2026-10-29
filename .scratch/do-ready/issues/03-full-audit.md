# 03 Full audit: every file, every logic path

Type: task
Status: open
Blocked by: 02 (audit the hardened code, not code that is about to change)

See map.md. This answers the user's "go over everything, each file and every logic".

## Scope

- **Storefront `src/`**: 177 files.
  - `pages/` (SSR and prerendered routes, `api/*`)
  - `lib/` (about 60 modules plus tests)
  - `components/` (41)
  - `layouts/`, `middleware.ts`, `styles/`
  - `astro.config.mjs`, `public/` (robots, static assets), `scripts/` (verify and crawl)
- **`wp-mu-plugins/`**:
  - `headless-bridge.php`, `mos-headless-mode.php`, `mos-headless-api.php`, `mos-account-api.php`
  - `mos-checkout-fields.php`, `mos-posturinn-droppoints.php`, `mos-size-index.php`
  - `seed/`, `tests/`, and `README.md` accuracy
  - `headless-bridge-local.php` only to confirm it is never deployable.
- **Per file**: what it does; inputs and trust boundaries; error paths; data that crosses to the client;
  correctness against WooCommerce/WordPress behaviour; dead code; test coverage of each branch.
- **Logic paths, traced end to end**:
  - browse → filter → product → cart → checkout → Straumur → order-received
  - sign-in / out / lost and reset password / account edits / order view
  - contact, wishlist, search, sitemap, the headless redirects and 404/500.
- **Lenses**: /x-ray (security, API consistency, observability, types, architecture),
  `superpowers-lab:finding-duplicate-functions`, and the money path read-only unless the user says otherwise.

## Method

1. Fan out by area with /delegate:
   - pages + api
   - lib (catalog / filters)
   - lib (cart / checkout / auth)
   - components
   - mu-plugins
2. Each agent reads every file in its area and reports findings with `file:line`, severity and evidence.
3. Consolidate everything into `.scratch/do-ready/audit.md`.
4. Fix in /cleanup batches with tests. Money-path fixes need the user's sign-off.
5. Finish with one consolidated /ship.

## Done when

- Every file in scope is listed in `audit.md` as reviewed, with its findings or "clean".
- Findings are fixed or ticketed.
- The gates from ticket 01 pass.
