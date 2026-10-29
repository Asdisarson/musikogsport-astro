# 01 App Platform readiness

Type: task
Status: done (2026-10-26), uncommitted in the worktree. The user commits.
Blocked by: -

See map.md.

## What changed

- **`.do/app.yaml`**: one `services` component.
  - Build: `node-js` buildpack, `github` source `Asdisarson/musikogsport` on branch `main` (placeholder),
    `deploy_on_push: false`.
  - Build and run: the buildpack's default `npm run build`, then `node dist/server/entry.mjs`.
  - Network and health: `http_port` 8080, health check `GET /api/healthz`.
  - Size and location: one `apps-s-1vcpu-1gb-fixed` instance in region `ams`.
  - Alerts: deploy failed, domain failed, restarts, memory.
  - Domains: `musikogsport.is` (PRIMARY) and `www` (ALIAS), plus an ingress rule that 301s `www` to the apex.
    All three are commented out, to be added at cutover (DEPLOY.md step 6), so that until then the default
    `<app>.ondigitalocean.app` stays the primary domain and `${APP_DOMAIN}`.
  - No `build_command`: the buildpack runs the `build` script by default, so setting it could build twice.
  - Envs: listed in DEPLOY.md "App Platform". Secrets have no values.
- **`src/pages/api/healthz.ts`**: returns 200 `ok` with `no-store` and makes no upstream calls. It sits under `/api/`
  because the trailing-slash middleware would 301 `/healthz`, and robots.txt already disallows `/api/`. It is not in
  the sitemap.
- **Visitor IP**:
  - `MOS_CLIENT_IP_HEADER` (env schema, optional, build time).
  - `lib/http` `visitorIp(..., edgeIp)`: the edge header wins, using its last entry. Without it the hop logic
    applies as before.
  - `lib/visitor` reads the configured header.
  - 3 new tests.
- **Allowed hosts**:
  - `src/lib/allowedHosts.mjs` builds `security.allowedDomains` from the two production hosts plus exact
    hostnames from `MOS_EXTRA_ALLOWED_HOSTS`.
  - It ignores and warns on wildcards, schemes, ports, paths, unresolved `${…}` and dot-less names.
  - `buildEnv()` reads `process.env` without `@types/node`.
  - 4 new tests.
- **Node**: `engines.node` is now `22.x`, in both package.json and the lockfile root; `.nvmrc` is `22`.
- **DEPLOY.md**:
  - New "App Platform" section: reasons, env table, owner steps, rollback, what is not done.
  - Env table: new rows for `MOS_CLIENT_IP_HEADER` and `MOS_EXTRA_ALLOWED_HOSTS`; the `HOST`/`PORT` row now covers
    both setups; the secrets row says they must also be present at build.
- `paths.test.ts`: added a check that `/api/healthz` is never slash-redirected.
- `scripts/verify_live_routes.py`: new check that `/api/healthz` returns 200 `ok` with no redirect.
- `.gitignore`: `node_modules/` became `node_modules`, which also matches the worktree's `node_modules` symlink.
  `.env` and `dist/` were already ignored. With a buildpack there is no Docker image, so no `.dockerignore` is needed.

## Findings

- **`server.host` is baked into the build.** `@astrojs/node` standalone passes `config.server.host` (`127.0.0.1`)
  to the runtime as `options.host`, and `standalone.js` binds `process.env.HOST ?? options.host` and
  `process.env.PORT ?? options.port`. So the config is not dev-only, and App Platform must set `HOST=0.0.0.0`
  (the spec does). The config keeps the safe self-hosting default.
- **The build needs the WooCommerce secrets.** `/um-okkur/` and `/personuvernd/` are prerendered. The chunk they
  load evaluates `_internalGetSecret('WOOCOMMERCE_CONSUMER_KEY')` at module top level, and a clean build without it
  fails with `EnvInvalidVariables`. The secrets are therefore `RUN_AND_BUILD_TIME`. A grep of `dist/` after a build
  with the real values finds 0 occurrences.
  - Alternative for ticket 02: read them lazily with `getSecret()` inside `lib/woo.ts`, then drop BUILD_TIME.
- **Public server env vars are inlined at build** (`const WP_INTERNAL_URL = "…"` and `MOS_TRUSTED_PROXY_HOPS = 1`
  in `dist/server/chunks`), so they are BUILD_TIME. `allowedDomains` is serialised into the manifest at build.
- **The build calls WordPress.** The prerendered pages render the menus, so `WP_INTERNAL_URL` must be reachable
  from DO's builders.
- **X-Forwarded-For on DO**: "App Platform adds a `do-connecting-ip` HTTP header that contains the client's IP
  address … While the `x-forwarded-for` header is often used for this purpose, App Platform uses this header for
  the IP address of the DigitalOcean ingress server that forwarded the request to your app."
  ([DO support docs](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/)).
  The docs don't say whether a client-sent `do-connecting-ip` is overwritten. DEPLOY.md step 5 has an 11-request
  sign-in test, checked locally: with one fixed header the 11th attempt is `?login=limited`; with a rotating header
  the 11th is `?login=failed`.
- **`${APP_DOMAIN}` at build.** The docs call it the "Application's primary domain" and say bindables work "at
  build and runtime" with buildpacks. They don't say what it resolves to while a custom PRIMARY domain is
  unverified. So the spec adds no custom domain until cutover, and DEPLOY.md step 5 first checks for a 303 and
  gives the literal-hostname fallback before the forged-header test.
- **Astro wildcards**: `allowedDomains` supports `*.` (one label) and `**.` (`@astrojs/internal-helpers/remote`
  `matchHostname`).
  - Not used: an unlisted Host makes `ctx.url` fall back to `localhost` (`core/app/node.js` `createRequest`), but a
    wildcard would accept any tenant's `X-Forwarded-Host`.
  - Probed with an extra host baked in, on the logout POST: allowed default host → 303, apex → 303,
    `X-Forwarded-Host: evil-x1.ondigitalocean.app` → 403, foreign Origin → 403.
- **Region**: `ams` gives EU/EEA residency and is close to Iceland; `lon` is similar. WordPress-host proximity
  matters more and is unknown.
- **Instance size**: 512 MiB is tight with sharp plus caches, so the spec uses 1 GiB fixed at $10/month. Services
  have no free tier ([pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)).
- Spec references:
  - [app spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/)
  - [Node buildpack](https://docs.digitalocean.com/products/app-platform/reference/buildpacks/nodejs/): `npm ci`,
    engines, devDependency pruning, default Node 22
  - [env vars / bindables](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/)
  - [domains](https://docs.digitalocean.com/products/app-platform/how-to/manage-domains/)

## Gates (2026-10-26)

- vitest: 31 files / 399 tests (baseline 30 / 392, +7).
- `astro check`: 0 errors, 0 warnings, 1 hint (the old `auth.ts` hint). `npm run build` OK.
- Clean copy on Node 22.23.4 / npm 10.9.9, no `.env`, no `NODE_ENV`:
  - `npm ci` OK, lockfile accepted unchanged. `npm run build` with the env set as App Platform would: OK.
  - `npm prune --omit=dev`, then boot: `/api/healthz`, `/`, `/verslun/`, `/um-okkur/`, `/personuvernd/` and
    `/sitemap.xml` all return 200.
  - sharp 0.34.5 / libvips 8.17.3 loads, and photo tiles carry `--photo-bg`.
- Lockfile:
  - `@img/sharp-linux-x64` 0.34.5 and `@img/sharp-libvips-linux-x64` 1.2.4 are present, with `resolved` and
    `integrity`, and match sharp's optionalDependencies.
  - `npm install --package-lock-only` on npm 10 only changes the root `engines` (synced by hand) and drops npm 11's
    `libc` metadata, so the npm 11 lock was kept.
- Built server as App Platform runs it (`HOST=0.0.0.0 PORT=8080 NODE_ENV=production`): listens on `*:8080`.
  `/api/healthz` returns 200 `ok` with `no-store`, and `/` returns 200.
  - The health route is `/api/healthz`, not the brief's `/healthz`. `/healthz` 301s to `/healthz/` through the
    trailing-slash middleware.
- On 127.0.0.1:4323: `verify_live_routes.py` 32 PASS / 0 FAIL, with a new `/api/healthz` check (31 before);
  `crawl_links.py` OK.
- `.do/app.yaml`: `yaml` parse OK. `doctl apps spec validate --schema-only` exit 0, run offline against a dead API
  URL. It checks types and shape only; a bad `instance_count` type is caught, enums and semantics are not.
