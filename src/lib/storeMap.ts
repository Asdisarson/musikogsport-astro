// The Store API (/wc/store/v1/products) product shape and its mapping onto the WooProduct card subset. Pure: no
// astro:env import, so it is unit-testable (storeCatalog.ts does the fetching).
import { scaleMinor } from './format';
import type { WooProduct } from './types';

export interface StorePrices {
  price: string;
  regular_price: string;
  sale_price: string;
  currency_minor_unit: number;
  price_range?: { min_amount: string; max_amount: string } | null;
}
export interface StoreProductRaw {
  id: number;
  name: string;
  slug: string;
  type: WooProduct['type'];
  prices: StorePrices;
  price_html?: string;
  on_sale: boolean;
  is_in_stock: boolean;
  permalink?: string;
  /** srcset: every WordPress sub-size (`NNNw` candidates); thumbnail: the 450×450 catalog crop. */
  images?: { src: string; thumbnail?: string; srcset?: string; sizes?: string; alt?: string }[];
  categories?: { id: number; name: string; slug: string }[];
  /** Global (pa_*) and local attributes; local ones (this store's "Litur") have id 0 and taxonomy null. */
  attributes?: { id: number; name: string; taxonomy: string | null; has_variations: boolean; terms?: { name: string }[] }[];
}

/** Map a Store API product onto the WooProduct fields the catalog cards consume. */
export function mapStoreProduct(p: StoreProductRaw): WooProduct {
  const mu = p.prices?.currency_minor_unit ?? 0;
  const toMajor = (v: string | undefined) => (v == null || v === '' ? '' : String(scaleMinor(v, mu)));
  // Variable parents: show "frá {min}" exactly like the REST v3 path (search/home/related),
  // which returns the min `price` but blank regular/sale. Keep the min price, but BLANK
  // regular/sale so PriceTag can't draw a strikethrough from a min-sale and min-regular
  // pulled from *different* variations (the incoherent "frá X / was Y" bug). Net: every
  // surface renders a variable product identically as "frá {min}".
  const isVariable = p.type === 'variable';
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    price: toMajor(p.prices?.price),
    regular_price: isVariable ? '' : toMajor(p.prices?.regular_price),
    sale_price: isVariable ? '' : toMajor(p.prices?.sale_price),
    on_sale: Boolean(p.on_sale),
    price_html: p.price_html,
    stock_status: p.is_in_stock ? 'instock' : 'outofstock',
    permalink: p.permalink,
    // Keep the URLs raw — productImage()/mediaUrl()/mediaSrcset() rewrite local hosts at render time. The srcset
    // lets a card load a ~360–720px candidate instead of the full-size original.
    images: (p.images ?? []).map((im) => ({
      src: im.src,
      alt: im.alt ?? '',
      ...(im.srcset ? { srcset: im.srcset } : {}),
      ...(im.sizes ? { sizes: im.sizes } : {}),
      ...(im.thumbnail ? { thumbnail: im.thumbnail } : {}),
    })),
    categories: (p.categories ?? []).map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    // For the card's "N litir" line (productCard.colourCount).
    attributes: (p.attributes ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      visible: true,
      variation: Boolean(a.has_variations),
      options: (a.terms ?? []).map((t) => t.name),
    })),
  };
}
