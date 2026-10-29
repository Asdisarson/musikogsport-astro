# Map: musikogsport storefront, production-ready on DigitalOcean App Platform

Label: wayfinder:map · Tracker: local markdown (`.scratch/do-ready/`) · Branch `feat/do-ready` off `feat/better-filters` (a822b16)

## Destination

The user asked to make the project ready for DigitalOcean App Platform, make it production ready, and then go
over every file and every logic path. The end state:

- The Astro storefront runs on App Platform from `.do/app.yaml`, with no hand steps beyond secrets, DNS and the
  WordPress-host checklist in `DEPLOY.md`.
- It is hardened for production traffic: headers, caching, error handling and logging, rate limits.
- Every file has been audited, storefront and `wp-mu-plugins`, with the findings fixed or ticketed.

## Decisions (2026-10-26)

1. Hosting (user): **only the storefront goes on App Platform.** WordPress/WooCommerce stays on its current host
   and is reached over HTTPS through `WP_INTERNAL_URL`.
2. No deploys, no DigitalOcean resources and no DNS changes from the agent. The owner creates the app.
3. Buildpack, not a Dockerfile. With a buildpack, sharp's linux binaries come from the lockfile and `${APP_DOMAIN}`
   reaches the build. Node is `22.x`.
4. Visitor IP on App Platform comes from `do-connecting-ip` (`MOS_CLIENT_IP_HEADER`), not X-Forwarded-For hops,
   because DO puts its ingress IP in X-Forwarded-For. Whether DO overwrites a client-sent copy is unverified; the
   owner checks it at first deploy (DEPLOY.md step 5).
5. `allowedDomains` gets exact extra hosts from `MOS_EXTRA_ALLOWED_HOSTS` at build time. No `*.ondigitalocean.app`
   wildcard, because that would trust other tenants' hosts.
6. Money path (cart, checkout, Straumur) is untouched in phase 1.

## Tickets

- [01 App Platform readiness](issues/01-do-app-platform.md): DONE (2026-10-26). Spec, health route, IP header,
  allowed hosts, Node pin, DEPLOY.md.
- [02 Production hardening](issues/02-hardening.md): implemented (2026-10-26), uncommitted. Headers (CSP report-only),
  caching, JSON logs with redaction, `/api/*` limits and the count fan-out cap, lazy secrets, media host env,
  graceful shutdown (`server.mjs`), DEPLOY.md checklists. Open for the owner: payment-flow limits, CSP enforcement,
  HSTS, Node 24.
- [03 Full audit](issues/03-full-audit.md): open, blocked by 02. Every file and every logic path, storefront and
  `wp-mu-plugins`.
