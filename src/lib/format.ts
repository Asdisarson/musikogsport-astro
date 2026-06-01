// ISK money formatting. WooCommerce here: 0 decimals, "." thousands separator,
// " kr." suffix (e.g. 37990 -> "37.990 kr.").

/** Group an integer with "." thousands separators (no decimals). */
function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Format a whole-króna value as "37.990 kr.". Accepts number or numeric string. */
export function formatISK(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const grouped = groupThousands(Math.round(Math.abs(n)).toString());
  return `${sign}${grouped} kr.`;
}

/** Scale a Store API integer-string amount by its currency_minor_unit (ISK = 0). */
export function scaleMinor(amount: string | number, minorUnit: number): number {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return 0;
  return minorUnit > 0 ? n / 10 ** minorUnit : n;
}

/** Format a Store API monetary value (integer string + minor unit) for display. */
export function formatStoreMoney(amount: string | number, minorUnit: number): string {
  return formatISK(scaleMinor(amount, minorUnit));
}
