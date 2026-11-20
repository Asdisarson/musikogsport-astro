// The empty /karfa/ tile row (nike-look, SPEC § Bag): the home page's "popular" row from the WordPress "Forsíða"
// data (title and count as WordPress sets them), its products cached in-process for a minute like the front page,
// so a cart request never waits on a fresh catalog query. SERVER-ONLY. No popular row in WordPress: no tiles.
import { createCachedLoader } from './cache';
import { loadFrontPage } from './frontPage';
import { storeProducts } from './storeCatalog';
import type { CachedWooProduct } from './types';

export interface CartSuggest {
  title: string;
  /** From the catalog grid, so without stock (see storeCatalog). */
  products: CachedWooProduct[];
}

const load = createCachedLoader<CartSuggest | null>({
  load: async () => {
    const row = (await loadFrontPage())?.rows.find((r) => r.source === 'popular');
    if (!row) return null;
    const { items } = await storeProducts({ orderby: 'popularity', order: 'desc', page: 1, per_page: row.count });
    return { title: row.title, products: items };
  },
  ttlMs: 60_000,
  failMemoMs: 30_000,
});

export async function loadCartSuggest(): Promise<CartSuggest | null> {
  return (await load()).value;
}
