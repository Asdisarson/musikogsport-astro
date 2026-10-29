// sanitizeHtml is the XSS gate for every set:html of WordPress/WooCommerce content (product descriptions, price_html,
// WP page bodies, the shipping bar). Pinned here (LC-14); behaviour unchanged.
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('removes scripts, event handlers and unknown tags', () => {
    expect(sanitizeHtml('<p>a<script>alert(1)</script>b</p>')).toBe('<p>ab</p>');
    expect(sanitizeHtml('<img src="https://x.is/a.jpg" onerror="alert(1)" />')).toBe('<img src="https://x.is/a.jpg" />');
    expect(sanitizeHtml('<iframe src="https://evil.example"></iframe><object></object><svg onload="x"></svg>')).toBe('');
    expect(sanitizeHtml('<p onclick="x" onmouseover="y">t</p>')).toBe('<p>t</p>');
  });

  it('drops javascript:, data: and vbscript: URLs but keeps http(s), mailto and tel', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
    expect(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
    expect(sanitizeHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=" />')).toBe('<img />');
    expect(sanitizeHtml('<a href="vbscript:x">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
    expect(sanitizeHtml('<a href="mailto:a@b.is">m</a><a href="tel:+3545552887">t</a>')).toBe(
      '<a href="mailto:a@b.is" rel="noopener noreferrer">m</a><a href="tel:+3545552887" rel="noopener noreferrer">t</a>',
    );
  });

  it('forces rel="noopener noreferrer" on links, keeping target', () => {
    expect(sanitizeHtml('<a href="https://x.is" target="_blank" rel="opener">x</a>')).toBe('<a href="https://x.is" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it('keeps only text-align from style attributes; srcset and other attributes go', () => {
    expect(sanitizeHtml('<p style="text-align: center; color: red; background: url(javascript:x)">c</p>')).toBe('<p style="text-align:center">c</p>');
    expect(sanitizeHtml('<p style="text-align: expression(alert(1))">c</p>')).toBe('<p>c</p>');
    expect(sanitizeHtml('<img src="https://x.is/a.jpg" srcset="https://evil.example/a.jpg 2x" alt="a" width="10" loading="lazy" />')).toBe(
      '<img src="https://x.is/a.jpg" alt="a" width="10" loading="lazy" />',
    );
  });

  it("keeps WooCommerce's price_html markup and formatting tags with their class", () => {
    const price = '<del aria-hidden="true"><span class="woocommerce-Price-amount amount"><bdi>9.990&nbsp;kr.</bdi></span></del> <ins><span class="woocommerce-Price-amount amount"><bdi>7.990&nbsp;kr.</bdi></span></ins>';
    expect(sanitizeHtml(price)).toBe(
      '<del><span class="woocommerce-Price-amount amount"><bdi>9.990\u00a0kr.</bdi></span></del> <ins><span class="woocommerce-Price-amount amount"><bdi>7.990\u00a0kr.</bdi></span></ins>',
    );
    expect(sanitizeHtml('<table><tr><td colspan="2">x</td></tr></table>')).toBe('<table><tr><td colspan="2">x</td></tr></table>');
  });

  it('is empty for nothing', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });
});
