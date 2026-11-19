// The staff admin bar (components/AdminBar.astro): who may see it and where its links go. Pure; shared by the
// server (lib/auth, api/account/editor) and the browser.

/** Whether WordPress's capability map (users/me, context=edit) grants editing products: administrators and
 *  shop managers. */
export function canEditProducts(capabilities: unknown): boolean {
  return typeof capabilities === 'object' && capabilities !== null && (capabilities as Record<string, unknown>).edit_products === true;
}

export interface AdminLink {
  label: string;
  href: string;
}

/** The bar's links into wp-admin on WordPress's public origin `base`: "Breyta vöru" first on a product page,
 *  then the sections. Empty when `base` isn't an http(s) URL, so a bad setting can't produce a script link. */
export function adminBarLinks(base: string, productId: number | null): AdminLink[] {
  let admin: string;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
    admin = `${url.origin}/wp-admin/`;
  } catch {
    return [];
  }
  const links: AdminLink[] = [
    { label: 'Stjórnborð', href: admin },
    // The classic order list: WooCommerce forwards it to its own order screen where orders live in its tables.
    { label: 'Pantanir', href: `${admin}edit.php?post_type=shop_order` },
    { label: 'Vörur', href: `${admin}edit.php?post_type=product` },
    { label: 'Stillingar', href: `${admin}admin.php?page=mos-stillingar` },
  ];
  if (productId !== null && Number.isInteger(productId) && productId > 0) {
    links.unshift({ label: 'Breyta vöru', href: `${admin}post.php?post=${productId}&action=edit` });
  }
  return links;
}
