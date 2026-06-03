// Plain-text catalog price for contexts that can't render the PriceTag component
// (the wishlist API → React island). Sale-aware; variable parents (REST returns an
// empty `price`) fall back to the WooCommerce price_html with the screen-reader cruft
// stripped, so e.g. "12.990 kr." or a "X kr. – Y kr." range survives cleanly.
import { formatISK } from './format';
import { decodeEntities } from './decode';
import type { WooProduct } from './types';

type PriceFields = Pick<WooProduct, 'type' | 'price' | 'regular_price' | 'sale_price' | 'on_sale' | 'price_html'>;

export function cardPriceText(p: PriceFields): string {
  if (p.on_sale && p.sale_price) return formatISK(p.sale_price);
  if (p.price && Number.isFinite(Number(p.price)) && Number(p.price) > 0) {
    return (p.type === 'variable' ? 'frá ' : '') + formatISK(p.price);
  }
  if (p.price_html) {
    const clean = p.price_html.replace(/<span class="screen-reader-text">[\s\S]*?<\/span>/gi, '');
    return decodeEntities(clean.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  return '';
}
