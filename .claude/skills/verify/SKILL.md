---
name: verify
description: How to runtime-verify the musikogsport Astro storefront (live-clone) — launch handle, URLs to drive, gotchas
---

# Verifying the musikogsport storefront

## Handle

- WordPress + WooCommerce: Local site **astro-ms** on **http://127.0.0.1:10025**. If pages fail with
  `fetch failed` (or `:10025` refuses connections), the site has halted: start it in the Local app.
- Storefront: Local's headless add-on on **http://127.0.0.1:10026**, which runs `astro dev` from the main
  app-astro checkout (on `feat/live-clone` since the 2026-10-16 handoff). From a worktree, start a dev
  server there instead (`npx astro dev --port 4322 --host 127.0.0.1`) and point the scripts at it with
  `STOREFRONT_URL=http://127.0.0.1:4322`.
- Confirm it's up: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:10026/` → 200.

## Flows worth driving

- Home `/` — campaign bar, header with live's cascading dropdowns (live has no top bar and no mega-menu),
  hero slider, product rows, banners, footer
  (all edited in wp-admin: Forsíða fields + menus).
- Archives — `/verslun/`, `/voruflokkur/skor/`, `/brand/<slug>/`, `/merkimidar/<slug>/`: sidebar filters
  (`?kyn=`, `?brand=`, `?team=`, `?product-category=`), sort, "Load more", `/page/2/`.
- Search — `/?s=<q>&post_type=product`; HTML in the query renders escaped.
- PDP — first product card href on a category (`/verslun/<category path>/<slug>/`): pick a swatch →
  "Setja í körfu" → side cart opens with the line.
- Cart `/karfa/` → checkout `/gera-upp/` (Pósturinn rates + locker picker) → **bacs** order →
  `/gera-upp/order-received/<id>/`. **Never place a Straumur order: its key is LIVE.** Afterwards cancel,
  then delete the test order (never set it Completed) and check the product's stock came back.
- Account `/min-sida/` (login box, no register form), lost password (mail in Mailpit), orders and
  view-order (another customer's order is a 404). Use a disposable local test customer and delete it.
- Legacy 301s: `/vara/<slug>`, `/verslun/<category>`, `/utskra`, `/leita?q=`. Slash 301:
  `/voruflokkur/skor` → `/voruflokkur/skor/`.
- Outage: with WordPress unreachable, archives, PDP, `/` and `/vara/` answer 503 with `Retry-After: 30`.

Scripted checks (against :10026, or `STOREFRONT_URL`): `python3 -I scripts/verify_live_routes.py` (31 route
checks) and `python3 -I scripts/crawl_links.py` (homepage links, sitemap sample, JSON-LD).

## Gotchas

- SSR pages fetch Woo per request — slow first paint is the WP backend, not the frontend.
- **Astro dev inlines a per-route CSS snapshot** into SSR HTML; CSS-only edits reach connected browsers via
  HMR but curl keeps getting the stale snapshot until the route recompiles. `touch src/pages/<route>.astro`
  before asserting on served CSS. Production builds are unaffected.
- After `npm run build` (or a second dev server), restart the dev server with `--force`, or islands can fail
  with "Outdated Optimize Dep".
- Rate limits (sign-in, reset, contact) live in the server process: restart the dev server to reset them
  between repeated test runs.
- `npm run build` (= `astro check && astro build`) is hygiene, not verification — drive the pages.
