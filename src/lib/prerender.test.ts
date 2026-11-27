// A page built on the Base layout shows the live site chrome (menus, campaign bar, logos, footer: lib/siteChrome).
// Prerendering such a page bakes that chrome in at build time, so a WordPress edit would not reach it until the next
// deploy while every other page picks it up within the chrome cache's minute.
import { describe, expect, it } from 'vitest';

// src/routes holds the pages mounted on their Icelandic addresses (lib/localizedRoutes.mjs).
const pages = import.meta.glob(['../pages/**/*.astro', '../routes/**/*.astro'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('prerendered pages', () => {
  it('finds the pages (the premise of the next test)', () => {
    expect(Object.keys(pages).length).toBeGreaterThan(15);
  });

  it('no page using the Base layout is prerendered', () => {
    const frozen = Object.entries(pages)
      .filter(([, src]) => /layouts\/Base\.astro/.test(src) && /export const prerender = true/.test(src))
      .map(([path]) => path);
    expect(frozen).toEqual([]);
  });
});
