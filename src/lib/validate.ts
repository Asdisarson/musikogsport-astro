// Domain-neutral request-input guards. Previously these lived in cartProxy.ts (cart domain);
// non-cart routes (order, products) needed them too, so they live here and cartProxy re-exports
// them for its existing importers.

export function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

const MAX_QTY = 99;
export function clampQty(v: unknown): number {
  return isPosInt(v) ? Math.min(v, MAX_QTY) : 1;
}
