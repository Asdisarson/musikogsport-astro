// @ts-check
// The shop's pages keep their Icelandic addresses while their files have English names. Files in src/pages are
// routed by their path, so these live in src/routes (same depth, so their imports are unchanged) and are mounted on
// their public URL here (astro.config.mjs). Astro.url is the address the shopper asked for, as before.

/** @type {ReadonlyArray<readonly [pattern: string, file: string]>} */
export const LOCALIZED_ROUTES = [
  ['/bidlisti/stadfesta', 'waitlist/confirm.astro'],
  ['/gera-upp', 'checkout/index.astro'],
  ['/gera-upp/order-received/[id]', 'checkout/order-received/[id].astro'],
  ['/hafa-samband', 'contact.astro'],
  ['/karfa', 'cart.astro'],
  ['/leita', 'search.astro'],
  ['/merkimidar/[...path]', 'tags/[...path].astro'],
  ['/min-sida', 'my-account/index.astro'],
  ['/min-sida/customer-logout', 'my-account/customer-logout.astro'],
  ['/min-sida/edit-account', 'my-account/edit-account.astro'],
  ['/min-sida/edit-address', 'my-account/edit-address/index.astro'],
  ['/min-sida/edit-address/[type]', 'my-account/edit-address/[type].astro'],
  ['/min-sida/lost-password', 'my-account/lost-password.astro'],
  ['/min-sida/orders/[...page]', 'my-account/orders/[...page].astro'],
  ['/min-sida/view-order/[id]', 'my-account/view-order/[id].astro'],
  ['/opnunartimi', 'opening-hours.astro'],
  ['/oskalisti', 'wishlist.astro'],
  ['/personuvernd', 'privacy.astro'],
  ['/staerdir', 'sizes.astro'],
  ['/utskra/[...rest]', 'legacy-checkout/[...rest].astro'],
  ['/vara/[slug]', 'product/[slug].astro'],
  ['/verslun', 'shop/index.astro'],
  ['/verslun/[...path]', 'shop/[...path].astro'],
  ['/verslun/page/[n]', 'shop/page/[n].astro'],
  ['/vidhald', 'maintenance.astro'],
  ['/voruflokkur/[...path]', 'product-category/[...path].astro'],
];

/** @returns {import('astro').AstroIntegration} */
export function localizedRoutes() {
  return {
    name: 'mos-localized-routes',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const [pattern, file] of LOCALIZED_ROUTES) injectRoute({ pattern, entrypoint: `./src/routes/${file}` });
      },
    },
  };
}
