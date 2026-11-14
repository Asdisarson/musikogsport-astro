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

  // Valitor: WooCommerce answers with its own "pay for order" page on the WordPress host, which posts to Valitor.
  const WP = 'https://wp.musikogsport.is';
  it("follows WordPress's pay-for-order page on the WordPress host", () => {
    const url = 'https://wp.musikogsport.is/gera-upp/order-pay/265094/?pay_for_order=true&key=wc_order_x';
    expect(paymentRedirectTarget(url, ORIGIN, WP)).toBe(url);
  });

  it('refuses a pay-for-order page on any other host, over http, or with no WordPress host known', () => {
    expect(paymentRedirectTarget('https://evil.example/gera-upp/order-pay/5/?key=k', ORIGIN, WP)).toBeNull();
    expect(paymentRedirectTarget('http://wp.musikogsport.is/gera-upp/order-pay/5/?key=k', ORIGIN, WP)).toBeNull();
    expect(paymentRedirectTarget('https://wp.musikogsport.is/gera-upp/order-pay/5/?key=k', ORIGIN)).toBeNull();
    expect(paymentRedirectTarget('https://wp.musikogsport.is/gera-upp/order-pay/5/?key=k', ORIGIN, 'not a url')).toBeNull();
  });

  it('refuses every other page on the WordPress host', () => {
    expect(paymentRedirectTarget('https://wp.musikogsport.is/wp-login.php', ORIGIN, WP)).toBeNull();
    expect(paymentRedirectTarget('https://wp.musikogsport.is/gera-upp/order-pay/5/../../wp-admin/', ORIGIN, WP)).toBeNull();
    expect(paymentRedirectTarget('https://wp.musikogsport.is/gera-upp/order-pay/x/', ORIGIN, WP)).toBeNull();
  });
});
