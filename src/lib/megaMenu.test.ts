import { describe, expect, it } from 'vitest';
import { megaPanel } from './megaMenu';
import type { MenuItem } from './siteChrome';

const item = (id: number, title: string, children: MenuItem[] = []): MenuItem => ({
  id, title, href: `/${id}/`, external: false, target: '', classes: [], children,
});
const leaves = (n: number, from = 100) => Array.from({ length: n }, (_, i) => item(from + i, `L${i}`));

describe('megaPanel', () => {
  it('gives a plain link (no panel) to an item without children', () => {
    expect(megaPanel(item(1, 'Verslun'))).toBeNull();
  });

  it('groups depth-1 children into heading columns when any of them has children', () => {
    const konur = item(2, 'Konur', [item(21, 'Fatnaður', leaves(6)), item(22, 'Skór', leaves(5, 200)), item(23, 'Sund')]);
    const panel = megaPanel(konur);
    expect(panel?.kind).toBe('grouped');
    if (panel?.kind !== 'grouped') return;
    expect(panel.groups.map((g) => g.title)).toEqual(['Fatnaður', 'Skór', 'Sund']);
    expect(panel.groups[0].links).toHaveLength(6);
    expect(panel.groups[2].links).toEqual([]);   // a childless group is a heading link on its own
    expect(panel.groups[0].href).toBe('/21/');
  });

  it('keeps depth-3 children on the links so they render as nested lists', () => {
    const born = item(3, 'Börn', [item(31, 'Fatnaður', [item(311, 'Útivera', leaves(5))])]);
    const panel = megaPanel(born);
    if (panel?.kind !== 'grouped') throw new Error('expected grouped');
    expect(panel.groups[0].links[0].children).toHaveLength(5);
  });

  it('links "Sjá allt" under a column and across the panel only where the heading is a real link', () => {
    const fatnadur = item(21, 'Fatnaður', leaves(3));
    const urval = { ...item(22, 'Úrval', leaves(2, 200)), href: '#' };
    const panel = megaPanel(item(2, 'Konur', [fatnadur, urval]));
    if (panel?.kind !== 'grouped') throw new Error('expected grouped');
    expect(panel.groups.map((g) => g.more)).toEqual(['/21/', null]);
    expect(panel.all).toBe('/2/');
    expect(megaPanel({ ...item(7, 'Vörumerki', [fatnadur]), href: '#' })?.all).toBeNull();
    expect(megaPanel({ ...item(8, 'Gamalt', [fatnadur]), href: '/' })?.all).toBeNull();
  });

  it('uses at least four column slots and at most six for groups', () => {
    const few = megaPanel(item(4, 'A', [item(41, 'x', leaves(2))]));
    const many = megaPanel(item(5, 'B', Array.from({ length: 8 }, (_, i) => item(50 + i, `g${i}`, leaves(1, 500 + i * 10)))));
    expect(few?.columns).toBe(4);
    expect(many?.columns).toBe(6);
  });

  it('flows an all-leaf item into one list under the item title, up to seven rows per column', () => {
    const cases: [number, number][] = [[3, 1], [7, 1], [8, 2], [9, 2], [13, 2], [16, 3], [40, 4]];
    for (const [n, flow] of cases) {
      const panel = megaPanel(item(6, 'Fatnaður', leaves(n)));
      expect(panel?.kind).toBe('flat');
      if (panel?.kind !== 'flat') return;
      expect(panel.title).toBe('Fatnaður');
      expect(panel.href).toBe('/6/');
      expect(panel.links).toHaveLength(n);
      expect(panel.flow, `${n} links`).toBe(flow);
      expect(panel.columns).toBe(4);
    }
  });
});
