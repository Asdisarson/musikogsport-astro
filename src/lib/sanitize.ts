// Server-side HTML sanitizer for untrusted WooCommerce content rendered via set:html
// (product descriptions, price_html). Allows safe formatting tags only — strips
// scripts, event handlers, and other XSS vectors as defense-in-depth.
import sanitizeHtmlLib from 'sanitize-html';

const OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 'small', 'sub', 'sup', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'bdi', 'del', 'ins', // used by WooCommerce price_html
  ],
  allowedAttributes: {
    '*': ['class', 'style'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  // WP page content centres text with inline styles (live: style="text-align: center;"); nothing
  // else from style attributes survives.
  allowedStyles: {
    '*': { 'text-align': [/^(left|right|center|justify)$/] },
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
