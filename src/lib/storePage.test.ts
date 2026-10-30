import { describe, expect, it } from 'vitest';
import { storeLayout } from './storePage';
import type { Column, Row } from './wpbakery';

const col = (span: number, ...blocks: Column['blocks']): Column => ({ span, blocks });
const html = (h: string) => ({ type: 'html' as const, html: h });
const phone = col(4, { type: 'icon', glyph: 'phone' }, html('<h4>Viltu spjalla?</h4>'));
const visit = col(4, { type: 'icon', glyph: 'pin' }, html('<h4>Komdu til okkar</h4>'));
const info = col(4, html('<h4>Upplýsingar</h4>'));
const map = col(12, { type: 'map', src: 'https://www.google.com/maps/embed?pb=x' });
const form = col(12, { type: 'form', id: 1 });

describe('storeLayout', () => {
  it('splits the Hafa samband page into its info cards, the map and the form', () => {
    const rows: Row[] = [
      { fullWidth: false, cols: [phone, visit, info] },
      { fullWidth: true, cols: [map] },
      { fullWidth: false, cols: [form] },
    ];
    expect(storeLayout(rows)).toEqual({ cards: [phone, visit, info], map, form });
  });
  it('drops empty spacer columns', () => {
    const rows: Row[] = [{ fullWidth: false, cols: [col(3), phone, col(3, html('  '))] }, { fullWidth: true, cols: [map] }];
    expect(storeLayout(rows)).toEqual({ cards: [phone], map, form: null });
  });
  it('gives up (null) on a page it doesn’t recognise: no map and no form, or a wishlist', () => {
    expect(storeLayout([{ fullWidth: false, cols: [phone, info] }])).toBeNull();
    expect(storeLayout([{ fullWidth: false, cols: [phone, col(12, { type: 'wishlist' })] }, { fullWidth: true, cols: [map] }])).toBeNull();
    expect(storeLayout([])).toBeNull();
  });
});
