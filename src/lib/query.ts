// Helpers for catalog list pages: sort param <-> Woo orderby/order, and
// pagination hrefs that preserve existing query params.
import type { ProductOrderBy } from './types';

export function parseSort(sort: string | null | undefined): { orderby: ProductOrderBy; order: 'asc' | 'desc' } {
  switch (sort) {
    case 'price-asc':
      return { orderby: 'price', order: 'asc' };
    case 'price-desc':
      return { orderby: 'price', order: 'desc' };
    case 'title':
      return { orderby: 'title', order: 'asc' };
    case 'popularity':
      return { orderby: 'popularity', order: 'desc' };
    case 'date':
    default:
      return { orderby: 'date', order: 'desc' };
  }
}

/** Build an href to `path` for a page number, preserving the given params. */
export function pageHref(path: string, params: URLSearchParams, page: number): string {
  const p = new URLSearchParams(params);
  if (page <= 1) p.delete('page');
  else p.set('page', String(page));
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}
