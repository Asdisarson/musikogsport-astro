# 01 Boot and verify

Type: task
Status: resolved
Blocked by:

## Question

Port the trashed site into astro-ms, create the worktree, and verify permalink parity, menus, WP-CLI and the
baseline gates.

## Answer

- The old `musikogsport` Local site was trashed 2026-10-02. Ported into `astro-ms` (id `neCvTzPqB`):
  - imported the old `app/sql/local.sql` (839 MB; home `http://localhost:10025`, 3,108 products)
  - copied plugins, mu-plugins, 518 MB of uploads and the app-astro repo
  - `app-node` is the Astro shim; the Next starter is kept as `app-node.faust-starter`
  - wp-config gets the `GhiaGNR_` prefix and JWT defines
  - backups: `app/sql/astro-ms-blank-backup-2026-10-06.sql`, `app/wp-config.astro-ms-orig.php`
- Ports are unchanged (WP 10025, Astro 10026, MySQL 10024, Mailpit 10021). WP-CLI works by sourcing
  `app/.envrc`.
- Permalink parity (80 live hrefs): 15 same, 7 differ, 58 missing locally (post-May products). 6 of the 7
  follow `_yoast_wpseo_primary_product_cat`; 1 is data drift.
- Baseline gate: `astro check` 0/0/0.
