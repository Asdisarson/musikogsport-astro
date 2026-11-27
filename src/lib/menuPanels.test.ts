import { describe, expect, it } from 'vitest';
import { buildPanels } from './menuPanels';
import type { MenuItem } from './siteChrome';

const item = (id: number, title: string, href: string, children: MenuItem[] = []): MenuItem => ({
  id, title, href, external: false, target: '', classes: [], children,
});

const tree = [
  item(1, 'Verslun', '/verslun/'),
  item(2, 'Konur', '/verslun/?kyn=konur', [
    item(21, 'Fatnaður', '/voruflokkur/fatnadur/?kyn=konur', [item(211, 'Peysur', '/p/')]),
    item(22, 'Skór', '/voruflokkur/skor/?kyn=konur'),
  ]),
];

describe('buildPanels', () => {
  const panels = buildPanels(tree);

  it('starts with a root panel holding the top-level items', () => {
    expect(panels[0]).toMatchObject({ id: 'root', parent: null, title: null, href: null });
    expect(panels[0].items.map((i) => i.title)).toEqual(['Verslun', 'Konur']);
  });

  it('creates one panel per item with children, pointing back at its parent panel', () => {
    expect(panels.map((p) => p.id)).toEqual(['root', 'm2', 'm21']);
    expect(panels[1]).toMatchObject({ parent: 'root', title: 'Konur', href: '/verslun/?kyn=konur' });
    expect(panels[2]).toMatchObject({ parent: 'm2', title: 'Fatnaður' });
  });

  it('gives a sub-panel no "Sjá allt" link when its parent is only a heading', () => {
    const headed = buildPanels([item(3, 'Vörumerki', '#', [item(31, 'Nike', '/brand/nike/')]), item(4, 'Gamalt', '/', [item(41, 'x', '/x/')])]);
    expect(headed.map((p) => p.href)).toEqual([null, null, null]);
  });

  it('links each parent entry to its panel and leaves leaves unlinked', () => {
    const womens = panels[0].items.find((i) => i.title === 'Konur');
    const shopItem = panels[0].items.find((i) => i.title === 'Verslun');
    expect(womens?.panel).toBe('m2');
    expect(shopItem?.panel).toBeNull();
  });
});
