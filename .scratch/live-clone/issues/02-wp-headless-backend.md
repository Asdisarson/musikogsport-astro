# 02 WP headless backend (mu-plugins + seed)

Type: task
Status: resolved
Blocked by: 01

## Question

Build:
- `mos-headless-api`: the menu endpoint, the ACF "Forsíða" group, and the primary-category permalink filter
- `mos-headless-mode`
- `mos-account-api`
- the bridge URL updates (`/gera-upp/order-received/`, `/gera-upp/?straumurStatus=`)
- the seed script (images, ACF content, menu drift)

## Answer

**Data source corrected.** The previous local DB was an April snapshot that predated live's Kyn categories
and menu. astro-ms now runs the **real May-3 prod dump**, guarded and verified:
- `wp-config`: WP_HOME/SITEURL pinned, DISABLE_WP_CRON, WP_HTTP_BLOCK_EXTERNAL (allowlist: wordpress.org +
  api.mobiz.posturinn.is).
- Import: reset, then 209/209 tables, then `siteurl`/`home` fixed by SQL before WordPress ever loaded.
- `search-replace` of the prod URLs (43k replacements).
- Webhooks disabled and pending Action Scheduler jobs cleared; local plugin set (incl. disable-emails);
  theme twentytwentyfour.
- Gateways: Straumur test mode with placeholder credentials (prod LIVE key/hmac/webhook removed); Valitor
  disabled and blanked; bacs enabled. The .env consumer key is registered locally (user 2).
- `wp core update-db` 60717 → 61833.
- Backups: `app/sql/astro-ms-april-snapshot-backup-2026-10-06.sql`, `app/sql/astro-ms-blank-backup-2026-10-06.sql`.

**Built** (`wp-mu-plugins/`, deployed to the astro-ms mu-plugins):
- `mos-headless-api.php`
  - menu locations primary/topbar/footer plus `mos/v1/menu/location/<loc>` and `mos/v1/menu/<id>`
  - ACF "Forsíða" (campaign, 3 hero product slides, 2 product rows, 8 banners, footer) and
    `mos/v1/front-page`
  - primary-category permalink filter at **priority 20**: free Yoast's `restore_legacy_permalink_category`
    at 10 was overriding it
- `mos-headless-mode.php`: front-end pages 302 to the storefront at the same path; admin/REST/login/feeds
  untouched.
- `mos-account-api.php`: lost/reset password, generic answers, per-IP rate limit, WooCommerce's reset email.

**Seeded:**
- Forsíða from live's homepage: 8 banners and 2 of 3 hero slides; slide 2's product `adidas-barnaulpa` is
  post-May. Live's dead `?attra-aldur=651` hero link became `/verslun/?kyn=born`.
- New menu **"Aðalvalmynd" (id 2648)**, identical to live's 158-item mega-menu, set as primary. Old menu
  2642 is untouched. Top bar = 158, footer = 839.

**Verified:**
- Store API 3,088 products; REST v3 with the .env keys returns 200; payment methods bacs + straumur.
- Kyn category counts karlar 970 / konur 1148 / born 990.
- Permalink parity: 21 same, 3 differ (live re-categorised after May), 59 post-May.
- Headless redirects: front pages 302 → :10026, product old path → 301 canonical; wp-json, wp-login,
  feed → 200.

**Deferred to ticket 08:** the bridge URL change to `/gera-upp/…`. The shared WP serves the current :10026
storefront too, so it ships together with the new checkout routes.
