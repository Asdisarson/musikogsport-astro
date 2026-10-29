// Flatten a nav-menu tree into the sliding panels of live's side/mobile menu: a root panel,
// then one panel per item that has children. Pure (siteChrome is imported for its type only).
import type { MenuItem } from './siteChrome';

export interface PanelEntry {
  title: string;
  href: string;
  target: string;
  /** Panel id this entry slides to, or null for a plain link. */
  panel: string | null;
}

export interface MenuPanel {
  id: string;
  parent: string | null;
  /** Parent item's title/link shown at the top of a sub-panel; null on the root panel. */
  title: string | null;
  href: string | null;
  items: PanelEntry[];
}

const panelId = (item: MenuItem) => `m${item.id}`;

export function buildPanels(tree: MenuItem[]): MenuPanel[] {
  const panels: MenuPanel[] = [];
  const add = (id: string, parent: string | null, owner: MenuItem | null, items: MenuItem[]) => {
    panels.push({
      id,
      parent,
      title: owner?.title ?? null,
      href: owner?.href ?? null,
      items: items.map((i) => ({ title: i.title, href: i.href, target: i.target, panel: i.children.length ? panelId(i) : null })),
    });
    for (const i of items) if (i.children.length) add(panelId(i), id, i, i.children);
  };
  add('root', null, null, tree);
  return panels;
}
