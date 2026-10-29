import { describe, expect, it } from 'vitest';
import { orderAmounts } from './orderAmounts';

// Local order 251193: 2 × Macron Stuttbuxur at 3.990 with the 20 % coupon bf2025.
const couponOrder = {
  discount_total: '1596',
  discount_tax: '0',
  line_items: [{ name: 'Macron Stuttbuxur - M', quantity: 2, subtotal: '7980', subtotal_tax: '0', total: '6384', total_tax: '0' }],
  shipping_lines: [{ method_title: 'Sótt í verslun', total: '0', total_tax: '0' }],
};

describe('orderAmounts', () => {
  it('shows line amounts before the coupon, so the discount is subtracted once (WooCommerce receipt)', () => {
    const a = orderAmounts(couponOrder);
    expect(a.items).toEqual([{ name: 'Macron Stuttbuxur - M', quantity: 2, total: '7980' }]);
    expect(a.subtotal).toBe(7980);
    expect(a.discount).toBe(1596);
    expect(a.subtotal - a.discount).toBe(6384);
  });

  it('adds tax to lines, shipping and discount, as the storefront shows prices incl. tax', () => {
    const taxed = {
      discount_total: '800',
      discount_tax: '192',
      line_items: [{ name: 'Skór', quantity: 1, subtotal: '8000', subtotal_tax: '1920', total: '7200', total_tax: '1728' }],
      shipping_lines: [{ method_title: 'Pósturinn', total: '1000', total_tax: '240' }],
    };
    const a = orderAmounts(taxed);
    expect(a.items[0].total).toBe('9920');
    expect(a.subtotal).toBe(9920);
    expect(a.discount).toBe(992);
    expect(a.shipping).toEqual([{ title: 'Pósturinn', total: '1240' }]);
  });

  it('treats missing fields as zero instead of NaN', () => {
    const a = orderAmounts({ line_items: [{ name: 'X', quantity: 1 }] });
    expect(a.items[0].total).toBe('0');
    expect(a.discount).toBe(0);
    expect(a.shipping).toEqual([]);
  });
});
