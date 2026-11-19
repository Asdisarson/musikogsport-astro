// Icelandic texts for the WooCommerce Store API cart errors the shopper can meet (stock and quantity refusals).
// The Store API sends a code and an English message; the storefront shows only these texts, never the English.
// Codes are from the installed WooCommerce (src/StoreApi/Utilities/CartController.php, QuantityLimits.php).
// Client-safe and server-safe.

export const CART_ERROR_TEXT: Record<string, string> = {
  // add to cart: the product is sold out
  woocommerce_rest_product_out_of_stock: 'Þessi vara er uppseld.',
  // add or update: more than the stock left (the stock count is in the English message, not read here)
  woocommerce_rest_product_partially_out_of_stock: 'Ekki nægar birgðir til fyrir þetta magn.',
  woocommerce_rest_product_not_purchasable: 'Þessi vara er ekki til sölu.',
  // a sold-individually product added a second time
  woocommerce_rest_product_too_many_in_cart: 'Aðeins eitt stykki af þessari vöru er leyft í körfunni.',
  // update or add over the line maximum (or under the minimum, or off a multiple): WooCommerce's code is the same
  invalid_quantity: 'Þetta magn er ekki leyft í körfunni.',
  readonly_quantity: 'Ekki er hægt að breyta magni þessarar vöru.',
};

/** Any other stock or quantity code that is not listed above. */
export const CART_QUANTITY_FALLBACK = 'Ekki tókst að breyta magninu. Reyndu aftur.';

const STOCK_OR_QUANTITY = /stock|quantity/;

/** The text to show for a failed cart call: the Icelandic text for a known stock or quantity code, the generic line for
 *  an unknown one of those, otherwise the message as it came. */
export function cartErrorText(code: unknown, message: string): string {
  if (typeof code !== 'string') return message;
  if (Object.prototype.hasOwnProperty.call(CART_ERROR_TEXT, code)) return CART_ERROR_TEXT[code];
  if (STOCK_OR_QUANTITY.test(code)) return CART_QUANTITY_FALLBACK;
  return message;
}
