// The Hafa samband page ("Verslunin" in the utility bar) is still written in wp-admin: a row of info columns (phone,
// address, company details), a map and the contact form. The storefront lays those parts out itself — the columns
// as cards beside the map, the form under them — and falls back to the page as written when it has other parts.
import type { Column, Row } from './wpbakery';

/** The page's info cards, its map column and its form column, or null when it isn't laid out that way. */
export function storeLayout(rows: Row[]): { cards: Column[]; map: Column | null; form: Column | null } | null {
  const cols = rows.flatMap((r) => r.cols).filter((c) => c.blocks.some((b) => b.type !== 'html' || b.html.trim() !== ''));
  if (cols.some((c) => c.blocks.some((b) => b.type === 'wishlist'))) return null;
  const map = cols.find((c) => c.blocks.some((b) => b.type === 'map')) ?? null;
  const form = cols.find((c) => c.blocks.some((b) => b.type === 'form')) ?? null;
  if (!map && !form) return null;
  return { cards: cols.filter((c) => c !== map && c !== form), map, form };
}
