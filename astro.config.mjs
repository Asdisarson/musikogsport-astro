// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';

// Headless WooCommerce storefront — SSR on-demand by default.
// Static pages opt out per-route with `export const prerender = true`.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  env: {
    schema: {
      // public, client-readable
      PUBLIC_WOOCOMMERCE_STORE_URL: envField.string({ context: 'client', access: 'public' }),
      WP_PUBLIC_URL: envField.string({ context: 'client', access: 'public' }),
      // server-only
      WP_INTERNAL_URL: envField.string({ context: 'server', access: 'public' }),
      WOOCOMMERCE_CONSUMER_KEY: envField.string({ context: 'server', access: 'secret' }),
      WOOCOMMERCE_CONSUMER_SECRET: envField.string({ context: 'server', access: 'secret' }),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
});
