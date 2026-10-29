// Domain-neutral request-input guards. Non-cart routes (order, products) need them too, so they
// live here rather than in cartProxy.ts, which re-exports some of them for its existing importers.

export function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** A real object literal — `typeof null === 'object'`, so null/arrays must be excluded explicitly. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const MAX_QTY = 99;
export function clampQty(v: unknown): number {
  return isPosInt(v) ? Math.min(v, MAX_QTY) : 1;
}

/** A quantity field's text as a cart quantity: whole number, 1–99 (1 for an empty or odd value). */
export function qtyFromInput(text: string): number {
  const n = Math.floor(Number(text.trim()));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_QTY) : 1;
}

/** Why a new password can't be used, or null. Counted in code points, as WordPress's mb_strlen does: at
 *  most 200 as typed (WordPress hashes it untrimmed and stores '*' above 4096 bytes) and at least 8 once
 *  spaces at the ends are left out. The length guard runs first so a huge body costs nothing to reject. */
export function passwordProblem(password: string): 'short' | 'long' | null {
  if (password.length > 800) return 'long'; // over 400 code points for certain
  if ([...password].length > 200) return 'long';
  return [...password.trim()].length < 8 ? 'short' : null;
}
