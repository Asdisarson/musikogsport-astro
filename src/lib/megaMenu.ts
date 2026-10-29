// Shape one top-level nav-menu item into its desktop mega-menu panel. Pure (siteChrome is imported for its
// type only). Two shapes, because the WordPress menu mixes them:
//   grouped: some depth-1 child has children (Konur, Börn, Karlar) → one column per child, its title as the
//            heading and its children as the links (deeper levels stay on the links as nested lists);
//   flat:    every child is a leaf (Fatnaður, Skór, Vörumerki) → one list under the item's own title,
//            flowed into columns of at most FLOW_ROWS rows.
import type { MenuItem } from './siteChrome';

export interface MegaGroup {
  title: string;
  href: string;
  target: string;
  links: MenuItem[];
}

interface PanelBase {
  /** Column slots the panel grid reserves (at least MIN_COLUMNS, so short menus keep the same rhythm). */
  columns: number;
}
export type MegaPanel =
  | (PanelBase & { kind: 'grouped'; groups: MegaGroup[] })
  | (PanelBase & { kind: 'flat'; title: string; href: string; target: string; links: MenuItem[]; flow: number });

const MIN_COLUMNS = 4;
const MAX_COLUMNS = 6;
const MAX_FLOW = 4;
const FLOW_ROWS = 7;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The item's mega-menu panel, or null when it has no children (a plain link). */
export function megaPanel(item: MenuItem): MegaPanel | null {
  const kids = item.children;
  if (!kids.length) return null;
  if (kids.some((k) => k.children.length)) {
    return {
      kind: 'grouped',
      columns: clamp(kids.length, MIN_COLUMNS, MAX_COLUMNS),
      groups: kids.map((k) => ({ title: k.title, href: k.href, target: k.target, links: k.children })),
    };
  }
  return {
    kind: 'flat',
    columns: MIN_COLUMNS,
    title: item.title,
    href: item.href,
    target: item.target,
    links: kids,
    flow: clamp(Math.ceil(kids.length / FLOW_ROWS), 1, MAX_FLOW),
  };
}
