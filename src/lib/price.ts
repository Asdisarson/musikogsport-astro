// Plain-text catalog price for contexts that can't render the PriceTag component
// (the wishlist API → React island). Sale-aware; variable parents (REST returns an
// empty `price`) fall back to the WooCommerce price_html with the screen-reader cruft
// stripped, so e.g. "12.990 kr." or a "X kr. – Y kr." range survives cleanly.
import { formatISK } from './format';
import { decodeEntities } from './decode';
import type { WooProduct } from './types';

type PriceFields = Pick<WooProduct, 'type' | 'price' | 'regular_price' | 'sale_price' | 'on_sale' | 'price_html'>;

/** First ISK amount inside an HTML fragment ("13.990&nbsp;kr." → 13990), or NaN. */
function firstAmount(html: string): number {
  const text = decodeEntities(html.replace(/<[^>]*>/g, ' '));
  const m = text.match(/\d[\d.]*/);
  return m ? Number(m[0].replace(/\./g, '')) : NaN;
}

/** Discount % for the "-N%" sale badge, read from the <del>/<ins> amounts of Woo's price_html
 *  (works for variable products too, whose regular/sale fields are blank). Null if not discounted. */
export function salePercent(priceHtml: string | null | undefined): number | null {
  if (!priceHtml) return null;
  const del = priceHtml.match(/<del\b[^>]*>([\s\S]*?)<\/del>/i);
  const ins = priceHtml.match(/<ins\b[^>]*>([\s\S]*?)<\/ins>/i);
  if (!del || !ins) return null;
  const was = firstAmount(del[1]);
  const now = firstAmount(ins[1]);
  if (!(was > 0) || !(now > 0) || now >= was) return null;
  return Math.round((1 - now / was) * 100);
}

/** The sale badge's label for a discount from salePercent(): "-55%", shared by product cards and the product page. */
export function formatSaleBadge(percent: number): string {
  return `-${percent}%`;
}

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
