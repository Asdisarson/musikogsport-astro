// JSON-LD helpers for structured data emitted into <head> via `set:html`.
// `ld()` serialises and escapes `<` so a value can never break out of the
// <script type="application/ld+json"> element.

export function ld(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

interface Crumb {
  label: string;
  href?: string;
}

/** schema.org BreadcrumbList from the same `items` array <Breadcrumbs> consumes. */
export function breadcrumbList(crumbs: Crumb[], siteUrl: string, currentUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: c.href ? new URL(c.href, siteUrl).href : currentUrl,
    })),
  };
}

const AVAILABILITY = {
  in: 'https://schema.org/InStock',
  out: 'https://schema.org/OutOfStock',
};

export interface ProductLdInput {
  name: string;
  url: string;
  images: string[];
  description?: string;
  sku?: string;
  brand?: string;
  inStock: boolean;
  /** Simple product price (whole ISK as string/number). */
  price?: string | number;
  /** Variable product: min/max across variations. */
  priceRange?: { low: number; high: number; count: number };
}

/** schema.org Product with Offer (simple) or AggregateOffer (variable). */
export function productLd(p: ProductLdInput) {
  const availability = p.inStock ? AVAILABILITY.in : AVAILABILITY.out;
  let offers: Record<string, unknown> | undefined;
  if (p.priceRange && p.priceRange.count > 0) {
    offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'ISK',
      lowPrice: p.priceRange.low,
      highPrice: p.priceRange.high,
      offerCount: p.priceRange.count,
      availability,
      url: p.url,
    };
  } else {
    const price = Number(p.price);
    offers = {
      '@type': 'Offer',
      priceCurrency: 'ISK',
      ...(price > 0 ? { price } : {}),
      availability,
      url: p.url,
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    ...(p.images.length ? { image: p.images } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    offers,
  };
}
