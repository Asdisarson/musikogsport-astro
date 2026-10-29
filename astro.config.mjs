// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import { allowedDomains, buildEnv } from './src/lib/allowedHosts.mjs';

// Headless WooCommerce storefront — SSR on-demand by default.
// Static pages opt out per-route with `export const prerender = true`.
export default defineConfig({
  // Production origin — drives canonical links, OG/Twitter absolute URLs, and the sitemap.
  site: 'https://musikogsport.is',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  env: {
    schema: {
      // public, client-readable, inlined at build: the host serving WordPress media (lib/img MEDIA_BASE_URL — local
      // media URLs are rewritten onto it, and photoBg samples photos from it only). After DNS cutover the apex
      // serves the storefront, so set WordPress's public origin (e.g. https://wp.musikogsport.is).
      MOS_MEDIA_BASE_URL: envField.string({ context: 'client', access: 'public', url: true, default: 'https://musikogsport.is' }),
      // server-only
      WP_INTERNAL_URL: envField.string({ context: 'server', access: 'public' }),
      // Read at run time only (lib/woo getSecret), so the build needs neither. Optional in the schema because
      // astro:env validates every REQUIRED secret whenever the module is imported, prerendering included; lib/woo
      // refuses to make a request without them instead.
      WOOCOMMERCE_CONSUMER_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      WOOCOMMERCE_CONSUMER_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Reverse proxies in front of Node that append to X-Forwarded-For. Default 1: the TLS proxy DEPLOY.md
      // requires. 0 only when Node faces visitors directly (requests carrying X-Forwarded-For then share one
      // limit). Drives the per-visitor rate limits (lib/http visitorIp).
      MOS_TRUSTED_PROXY_HOPS: envField.number({ context: 'server', access: 'public', int: true, min: 0, default: 1 }),
      // A header the hosting edge sets to the visitor's IP, overwriting any client copy; when set and present it
      // replaces the X-Forwarded-For hop count. App Platform: `do-connecting-ip` (its X-Forwarded-For carries
      // DO's ingress address, not the visitor). Leave unset behind nginx.
      MOS_CLIENT_IP_HEADER: envField.string({ context: 'server', access: 'public', optional: true }),
    },
  },
  security: {
    // TLS ends at the proxy, so Node sees plain http. These hosts let Astro trust the proxy's
    // X-Forwarded-Proto/Host for ctx.url, which its own form-POST origin check and lib/http
    // sameOrigin compare against. Without it every form POST in production would get a 403.
    // Plus exact hosts from MOS_EXTRA_ALLOWED_HOSTS at build time (lib/allowedHosts.mjs).
    allowedDomains: allowedDomains(buildEnv('MOS_EXTRA_ALLOWED_HOSTS')),
  },
  // Also the built server's default bind (@astrojs/node standalone bakes it in); the HOST and PORT env vars
  // override both at runtime. App Platform sets HOST=0.0.0.0 / PORT=8080 (.do/app.yaml).
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
  vite: {
    server: {
      // Local's router proxies astro-ms.local (formerly musikogsport.local) → the dev server; Vite
      // rejects proxied Host headers unless they're allowlisted.
      allowedHosts: ['astro-ms.local', 'www.astro-ms.local', 'musikogsport.local', 'www.musikogsport.local'],
    },
  },
});
