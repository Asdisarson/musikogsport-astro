import { describe, expect, it } from 'vitest';
import { parseWpBakery } from './wpbakery';

const mapLink = (src: string) =>
  '#E-8_' + btoa(encodeURIComponent(`<iframe src="${src}" width="600" height="450"></iframe>`));

describe('parseWpBakery', () => {
  it('turns rows and fractional columns into a grid model', () => {
    const rows = parseWpBakery(
      '[vc_row][vc_column width="1/3"][vc_column_text]<h4>A</h4>[/vc_column_text][/vc_column][vc_column width="2/3"][vc_column_text]<p>B</p>[/vc_column_text][/vc_column][/vc_row]',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cols.map((c) => c.span)).toEqual([4, 8]);
    expect(rows[0].cols[0].blocks).toEqual([{ type: 'html', html: '<h4>A</h4>' }]);
  });

  it('keeps empty spacer columns (live uses them to centre narrow content)', () => {
    const rows = parseWpBakery(
      '[vc_row][vc_column width="1/4" offset="vc_hidden-md vc_hidden-sm"][/vc_column][vc_column width="1/2"][vc_column_text]<h4>Opið</h4>[/vc_column_text][/vc_column][vc_column width="1/4"][/vc_column][/vc_row]',
    );
    expect(rows[0].cols.map((c) => [c.span, c.blocks.length])).toEqual([[3, 0], [6, 1], [3, 0]]);
  });

  it('recognises icons, Google map embeds, the Ninja form and the wishlist shortcode', () => {
    const src = 'https://www.google.com/maps/embed?pb=!1m18';
    const rows = parseWpBakery(
      `[vc_row][vc_column][vc_icon icon_linecons="vc_li vc_li-user"][vc_gmaps link="${mapLink(src)}"][vc_column_text][ninja_form id='1'][/vc_column_text][vc_column_text][yith_wcwl_wishlist][/vc_column_text][/vc_column][/vc_row]`,
    );
    expect(rows[0].cols[0].blocks).toEqual([
      { type: 'icon', glyph: 'user' },
      { type: 'map', src },
      { type: 'form', id: 1 },
      { type: 'wishlist' },
    ]);
  });

  it("maps live's linecons icons to the glyph matching each contact column", () => {
    const icon = (name: string) => parseWpBakery(`[vc_row][vc_column][vc_icon icon_linecons="vc_li ${name}"][/vc_column][/vc_row]`)[0].cols[0].blocks;
    // live's contact page: t-shirt above "Viltu spjalla?" (phone + email), location above the address, user above company details
    expect(icon('vc_li-t-shirt')).toEqual([{ type: 'icon', glyph: 'phone' }]);
    expect(icon('vc_li-location')).toEqual([{ type: 'icon', glyph: 'pin' }]);
    expect(icon('vc_li-user')).toEqual([{ type: 'icon', glyph: 'user' }]);
  });

  it('renders nothing for an icon it has no glyph for (no empty circle)', () => {
    for (const raw of ['[vc_icon icon_linecons="vc_li vc_li-diamond"]', '[vc_icon icon_fontawesome="fa fa-star"]', '[vc_icon]', '[vc_icon icon_linecons="vc_li constructor"]', '[vc_icon icon_linecons="toString"]']) {
      expect(parseWpBakery(`[vc_row][vc_column]${raw}[/vc_column][/vc_row]`)[0].cols[0].blocks).toEqual([]);
    }
  });

  it('drops a map embed whose src is not an http(s) URL (stored XSS through the iframe)', () => {
    for (const src of ['javascript:alert(document.cookie)', 'java&#9;script:alert(1)', 'data:text/html,x']) {
      const rows = parseWpBakery(`[vc_row][vc_column][vc_gmaps link="${mapLink(src)}"][/vc_column][/vc_row]`);
      expect(rows[0].cols[0].blocks).toEqual([]);
    }
  });

  it('marks full-width rows', () => {
    const rows = parseWpBakery('[vc_row full_width="stretch_row_content_no_spaces"][vc_column][vc_column_text]x[/vc_column_text][/vc_column][/vc_row]');
    expect(rows[0].fullWidth).toBe(true);
  });

  it('drops the stray <p> wrappers wpautop puts around shortcodes', () => {
    const rows = parseWpBakery('<p>[vc_row][vc_column][vc_column_text css=""]</p>\n<p><b>Skilmálar</b></p>\n<p>[/vc_column_text][/vc_column][/vc_row]</p>');
    expect(rows[0].cols[0].blocks).toEqual([{ type: 'html', html: '<p><b>Skilmálar</b></p>' }]);
  });

  it('treats content without WPBakery rows as one full-width text column', () => {
    const rows = parseWpBakery('<figure><table><tr><td>S</td></tr></table></figure>');
    expect(rows).toEqual([{ fullWidth: false, cols: [{ span: 12, blocks: [{ type: 'html', html: '<figure><table><tr><td>S</td></tr></table></figure>' }] }] }]);
  });

  it('turns line breaks inside text into <br> like wpautop, leaving breaks between tags alone', () => {
    const rows = parseWpBakery(
      '[vc_row][vc_column][vc_column_text]\r\n<h4 class="c">Virkir dagar 10-18\r\nLaugardagar 10-16</h4>\r\n[/vc_column_text][/vc_column][/vc_row]',
    );
    expect(rows[0].cols[0].blocks).toEqual([{ type: 'html', html: '<h4 class="c">Virkir dagar 10-18<br>\nLaugardagar 10-16</h4>' }]);
  });

  it('also breaks a line that ends right before a closing inline tag (wpautop does)', () => {
    const rows = parseWpBakery(
      '[vc_row][vc_column][vc_column_text]<p>Kennitala: <span class="bold"> 710303-2310\n</span>VSK Númer</p>[/vc_column_text][/vc_column][/vc_row]',
    );
    expect(rows[0].cols[0].blocks).toEqual([{ type: 'html', html: '<p>Kennitala: <span class="bold"> 710303-2310<br>\n</span>VSK Númer</p>' }]);
  });

  it('ignores unknown shortcodes but keeps their text', () => {
    const rows = parseWpBakery('[vc_row][vc_column][vc_column_text]<p>a [vc_btn title="x"] b</p>[/vc_column_text][/vc_column][/vc_row]');
    expect(rows[0].cols[0].blocks).toEqual([{ type: 'html', html: '<p>a  b</p>' }]);
  });

  it('keeps everything around a nested vc_row_inner: its columns flow into the outer column (LC-02)', () => {
    const rows = parseWpBakery(
      '[vc_row][vc_column width="1/2"]<p>A</p>[vc_row_inner][vc_column_inner width="1/2"]<p>B</p>[/vc_column_inner][vc_column_inner width="1/2"]<p>B2</p>[/vc_column_inner][/vc_row_inner]<p>C</p>[/vc_column][vc_column width="1/2"]<p>D</p>[/vc_column][/vc_row][vc_row][vc_column]<p>E</p>[/vc_column][/vc_row]',
    );
    expect(rows).toEqual([
      {
        fullWidth: false,
        cols: [
          { span: 6, blocks: ['A', 'B', 'B2', 'C'].map((t) => ({ type: 'html', html: `<p>${t}</p>` })) },
          { span: 6, blocks: [{ type: 'html', html: '<p>D</p>' }] },
        ],
      },
      { fullWidth: false, cols: [{ span: 12, blocks: [{ type: 'html', html: '<p>E</p>' }] }] },
    ]);
  });

  it('keeps vc_column_text inside an inner row', () => {
    const rows = parseWpBakery('[vc_row][vc_column][vc_row_inner][vc_column_inner][vc_column_text]<p>X</p>[/vc_column_text][/vc_column_inner][/vc_row_inner][/vc_column][/vc_row]');
    expect(rows).toEqual([{ fullWidth: false, cols: [{ span: 12, blocks: [{ type: 'html', html: '<p>X</p>' }] }] }]);
  });
});

