// Server-side HTML sanitizer for untrusted WooCommerce content rendered via set:html
// (product descriptions, price_html). Allows safe formatting tags only — strips
// scripts, event handlers, and other XSS vectors as defense-in-depth.
import sanitizeHtmlLib from 'sanitize-html';

const OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: [
    'p', 'br', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 'small', 'sub', 'sup',
    'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'bdi', 'del', 'ins', // used by WooCommerce price_html
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    span: ['class'],
    bdi: ['class'],
    del: ['class'],
    ins: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    a: sanitizeHtmlLib.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtmlLib(html, OPTIONS);
}
