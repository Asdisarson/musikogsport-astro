// Minimal HTML-entity decoder for server-side text (WooCommerce category/product
// names contain entities like &amp;). No DOM dependency.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Remove WPBakery/WordPress shortcodes like [vc_row]…[/vc_row] from HTML. */
export function stripShortcodes(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/\[\/?[^\]\n]{1,60}\]/g, '');
}

export function decodeEntities(input: string | null | undefined): string {
  if (!input) return input ?? '';
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      // Guard the valid Unicode range — String.fromCodePoint throws RangeError above 0x10FFFF
      // (e.g. a malformed &#9999999;), which would otherwise crash SSR frontmatter mid-render.
      return Number.isFinite(num) && num >= 0 && num <= 0x10ffff ? String.fromCodePoint(num) : match;
    }
    return NAMED[code] ?? match;
  });
}
