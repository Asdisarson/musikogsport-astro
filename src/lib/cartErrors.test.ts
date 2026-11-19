// cartErrors.ts: stock and quantity refusals reach the shopper in Icelandic; nothing English from these codes.
import { describe, expect, it } from 'vitest';
import { CART_ERROR_TEXT, CART_QUANTITY_FALLBACK, cartErrorText } from './cartErrors';

describe('cartErrorText', () => {
  it('maps the WooCommerce stock and quantity codes to their Icelandic texts', () => {
    expect(cartErrorText('woocommerce_rest_product_out_of_stock', 'x')).toBe('Þessi vara er uppseld.');
    expect(cartErrorText('woocommerce_rest_product_partially_out_of_stock', 'x')).toBe('Ekki nægar birgðir til fyrir þetta magn.');
    expect(cartErrorText('woocommerce_rest_product_too_many_in_cart', 'x')).toBe('Aðeins eitt stykki af þessari vöru er leyft í körfunni.');
    expect(cartErrorText('invalid_quantity', 'The maximum quantity of "Nike" allowed in the cart is 10')).toBe('Þetta magn er ekki leyft í körfunni.');
    expect(cartErrorText('readonly_quantity', 'x')).toBe('Ekki er hægt að breyta magni þessarar vöru.');
  });
  it('never returns the English message for a known code', () => {
    for (const code of Object.keys(CART_ERROR_TEXT)) {
      expect(cartErrorText(code, 'The maximum quantity of &quot;Nike&quot; allowed in the cart is 10')).not.toMatch(/[Tt]he |allowed|quantity of/);
    }
  });
  it('an unknown stock or quantity code gets the generic Icelandic line', () => {
    expect(cartErrorText('woocommerce_rest_some_new_stock_code', 'English')).toBe(CART_QUANTITY_FALLBACK);
  });
  it('any other code, or no code, keeps the message as it came', () => {
    expect(cartErrorText('woocommerce_rest_cart_invalid_coupon', 'Coupon is invalid')).toBe('Coupon is invalid');
    expect(cartErrorText(undefined, 'Villa')).toBe('Villa');
  });
});
