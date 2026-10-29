// Minimal WPBakery (Visual Composer) parser for live's WordPress content pages. WPBakery isn't
// installed headlessly, so its shortcodes arrive raw in post_content; this turns the subset live's
// pages use into a row/column/block model the storefront renders. Pure — HTML is NOT sanitized
// here (the renderer does that).
import { safeIframeSrc } from './safeUrl';

export type Block =
  | { type: 'html'; html: string }
  | { type: 'icon'; glyph: IconGlyph }
  | { type: 'map'; src: string }
  | { type: 'form'; id: number }
  | { type: 'wishlist' };

export interface Column {
  /** Width in twelfths (WPBakery "1/3" → 4). */
  span: number;
  blocks: Block[];
}

export interface Row {
  fullWidth: boolean;
  cols: Column[];
}

const TOKEN = /\[(\/?)([a-z_]+)([^\]]*)\]/g;

// Live's vc_icon linecons names → the storefront Icon glyph for what each contact column holds
// (the t-shirt sits above "Viltu spjalla?", the phone and email column). Unknown icons render nothing.
const ICON_GLYPHS = { 'vc_li-t-shirt': 'phone', 'vc_li-location': 'pin', 'vc_li-user': 'user' } as const;
export type IconGlyph = (typeof ICON_GLYPHS)[keyof typeof ICON_GLYPHS];

function iconGlyph(linecons: string | undefined): IconGlyph | null {
  const name = linecons?.split(/\s+/).find((c) => c in ICON_GLYPHS) as keyof typeof ICON_GLYPHS | undefined;
  return name ? ICON_GLYPHS[name] : null;
}

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-z_]+)=(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

function span(width: string | undefined): number {
  const m = width?.match(/^(\d+)\/(\d+)$/);
  if (!m) return 12;
  const n = Math.round((12 * Number(m[1])) / Number(m[2]));
  return n >= 1 && n <= 12 ? n : 12;
}

/** Strip wpautop debris (orphan </p> / <p>, empty paragraphs) and HTML comments, then apply the
 *  line-break half of wpautop: a newline between two pieces of text becomes <br>. */
function clean(html: string): string {
  return html
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*(?:<\/p>\s*)+/i, '')
    .replace(/(?:\s*<p>)+\s*$/i, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .trim()
    .replace(/([^>\s])[ \t]*\n(?=[ \t]*(?:[^<\s]|<\/(?:span|a|b|strong|em|i|u|small)\b))/g, '$1<br>\n');
}

// vc_gmaps stores its iframe HTML base64-encoded; only an http(s) src survives (no javascript: embeds).
function mapSrc(link: string | undefined): string | null {
  const b64 = link?.replace(/^#E-8_/, '');
  if (!b64) return null;
  try {
    const decoded = decodeURIComponent(atob(b64));
    return safeIframeSrc(decoded.match(/src="([^"]+)"/)?.[1]);
  } catch {
    return null;
  }
}

export function parseWpBakery(content: string): Row[] {
  if (!/\[vc_row\b/.test(content)) {
    const html = clean(content.replace(TOKEN, ''));
    return html ? [{ fullWidth: false, cols: [{ span: 12, blocks: [{ type: 'html', html }] }] }] : [];
  }

  const rows: Row[] = [];
  let row: Row | null = null;
  let col: Column | null = null;
  let text: string[] | null = null; // collecting inside [vc_column_text]
  let last = 0;

  const pushHtml = (raw: string) => {
    if (!col) return;
    const html = clean(raw);
    if (html) col.blocks.push({ type: 'html', html });
  };
  const flushText = () => {
    if (text) pushHtml(text.join(''));
    text = [];
  };

  for (const m of content.matchAll(TOKEN)) {
    const between = content.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    if (text) text.push(between);
    else if (col) pushHtml(between);

    const [, closing, name, rawAttrs] = m;
    const a = attrs(rawAttrs);
    if (name === 'vc_row') {
      if (!closing) {
        row = { fullWidth: Boolean(a.full_width), cols: [] };
        rows.push(row);
      } else row = null;
    } else if (name === 'vc_row_inner' || name === 'vc_column_inner') {
      // A nested row lives inside an outer column: its columns' content flows into that column, in order (the model
      // has no nesting). Treating it as a row of its own used to end the outer row and drop what followed.
    } else if (name === 'vc_column') {
      if (!closing && row) {
        col = { span: span(a.width), blocks: [] };
        row.cols.push(col);
      } else col = null;
    } else if (name === 'vc_column_text') {
      if (!closing) text = [];
      else {
        flushText();
        text = null;
      }
    } else if (name === 'vc_icon' && !closing && col) {
      const glyph = iconGlyph(a.icon_linecons);
      if (glyph) col.blocks.push({ type: 'icon', glyph });
    } else if (name === 'vc_gmaps' && !closing && col) {
      const src = mapSrc(a.link);
      if (src) col.blocks.push({ type: 'map', src });
    } else if (name === 'ninja_form' && !closing && col) {
      flushText();
      col.blocks.push({ type: 'form', id: Number(a.id) || 0 });
    } else if (name === 'yith_wcwl_wishlist' && !closing && col) {
      flushText();
      col.blocks.push({ type: 'wishlist' });
    }
    // anything else: tag dropped, surrounding text kept
  }
  return rows;
}
