// cartErrors.ts: stock and quantity refusals reach the shopper in Icelandic; nothing English from these codes.
import { describe, expect, it } from 'vitest';
import { CART_ERROR_TEXT, CART_QUANTITY_FALLBACK, CART_VARIATION_FALLBACK, cartErrorText } from './cartErrors';

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
  // A variable product added without its variation choice: WooCommerce's English "Missing attributes ..." must never show.
  it('maps the variation-choice codes to Icelandic texts', () => {
    expect(cartErrorText('woocommerce_rest_missing_attributes', 'Missing attributes for variable product.')).toBe('Veldu alla valkosti vörunnar áður en hún er sett í körfuna.');
    expect(cartErrorText('woocommerce_rest_missing_variation_data', 'Missing variation data for variable product.')).toBe('Veldu alla valkosti vörunnar áður en hún er sett í körfuna.');
    expect(cartErrorText('woocommerce_rest_invalid_variation_data', 'Invalid value posted for Size.')).toBe('Þetta val er ekki gilt fyrir þessa vöru.');
    expect(cartErrorText('woocommerce_rest_variation_id_from_variation_data', 'No matching variation found.')).toBe('Ekkert afbrigði vörunnar passar við þetta val.');
  });
  it('an unknown variation-choice code gets the generic Icelandic line, never the English', () => {
    expect(cartErrorText('woocommerce_rest_some_new_variation_code', 'Some English text')).toBe(CART_VARIATION_FALLBACK);
  });
  it('the variation-choice texts never carry English', () => {
    for (const code of ['woocommerce_rest_missing_attributes', 'woocommerce_rest_missing_variation_data', 'woocommerce_rest_invalid_variation_data', 'woocommerce_rest_variation_id_from_variation_data']) {
      expect(cartErrorText(code, 'Missing attributes for variable product.')).not.toMatch(/product|variation|missing|attributes|found/i);
    }
  });
  it('any other code, or no code, keeps the message as it came', () => {
    expect(cartErrorText('woocommerce_rest_cart_invalid_coupon', 'Coupon is invalid')).toBe('Coupon is invalid');
    expect(cartErrorText(undefined, 'Villa')).toBe('Villa');
  });
});
