// Address helpers for /min-sida/ (client-safe, no WooCommerce access).

export const ADDRESS_FIELDS = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'postcode', 'city', 'country', 'phone', 'email'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];
export type Address = Partial<Record<AddressField | 'state', string>>;

/** Pick only the known address fields from a submitted form, trimmed and capped; the store ships in Iceland. */
export function addressFromForm(form: FormData, type: 'billing' | 'shipping'): Address {
  const out: Address = {};
  for (const f of ADDRESS_FIELDS) {
    if (f === 'country' || (type === 'shipping' && f === 'email')) continue;
    const v = form.get(f);
    if (typeof v === 'string') out[f] = v.trim().slice(0, 200);
  }
  out.country = 'IS';
  return out;
}

/** Address lines for display (WooCommerce's formatted address, Icelandic order). */
export function addressLines(a: Address): string[] {
  return [
    [a.first_name, a.last_name].filter(Boolean).join(' '),
    a.company,
    a.address_1,
    a.address_2,
    [a.postcode, a.city].filter(Boolean).join(' '),
  ].filter((l): l is string => Boolean(l && l.trim()));
}
