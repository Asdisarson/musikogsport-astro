import { describe, expect, it } from 'vitest';
import { paymentRedirectTarget } from './checkoutRedirect';

const ORIGIN = 'https://musikogsport.is';

describe('paymentRedirectTarget', () => {
  it('follows a same-origin URL as is', () => {
    expect(paymentRedirectTarget('https://musikogsport.is/gera-upp/order-received/5/?key=wc_order_x', ORIGIN)).toBe(
      'https://musikogsport.is/gera-upp/order-received/5/?key=wc_order_x',
    );
  });

  it('follows the Straumur hosted checkout over https', () => {
    expect(paymentRedirectTarget('https://greidslugatt.straumur.is/pay/abc', ORIGIN)).toBe('https://greidslugatt.straumur.is/pay/abc');
  });

  it('keeps only the path of an order-received URL that names another host (WordPress return URL on a different storefront host)', () => {
    expect(paymentRedirectTarget('http://localhost:10026/gera-upp/order-received/265094/?key=wc_order_x', 'http://127.0.0.1:4322')).toBe(
      '/gera-upp/order-received/265094/?key=wc_order_x',
    );
  });

  it('refuses anything else (scripts, other hosts, plain-http gateways)', () => {
    expect(paymentRedirectTarget('javascript:alert(1)', ORIGIN)).toBeNull();
    expect(paymentRedirectTarget('https://evil.example/gera-upp/', ORIGIN)).toBeNull();
    expect(paymentRedirectTarget('http://greidslugatt.straumur.is/pay', ORIGIN)).toBeNull();
    expect(paymentRedirectTarget('https://evil.example/gera-upp/order-received/5/extra', ORIGIN)).toBeNull();
  });
});
