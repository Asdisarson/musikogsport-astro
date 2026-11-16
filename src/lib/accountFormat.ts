// Address and account-details helpers for /min-sida/ (client-safe, no WooCommerce access).
import { passwordProblem } from './validate';

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

export interface AddressFormField {
  name: AddressField;
  label: string;
  width: 'first' | 'last' | 'wide';
  required?: boolean;
  type?: 'text' | 'tel' | 'email';
  autocomplete?: string;
}

/** The address form's fields, in order. Widths match the checkout (live's Checkout Field Editor config) except
 *  billing company: wide here, paired with Kennitala on the checkout. There is no Kennitala field here, and Land
 *  comes last (the form adds it, read-only). A delivery address has no phone or e-mail. */
export function addressFormFields(type: 'billing' | 'shipping'): AddressFormField[] {
  return [
    { name: 'first_name', label: 'Eiginnafn', width: 'first', required: true, autocomplete: 'given-name' },
    { name: 'last_name', label: 'Eftirnafn', width: 'last', required: true, autocomplete: 'family-name' },
    { name: 'company', label: 'Nafn fyrirtækis', width: 'wide', autocomplete: 'organization' },
    { name: 'address_1', label: 'Heimilisfang', width: 'wide', required: true, autocomplete: 'address-line1' },
    { name: 'address_2', label: 'Íbúð, hæð o.fl.', width: 'wide', autocomplete: 'address-line2' },
    { name: 'postcode', label: 'Póstnúmer', width: 'first', required: true, autocomplete: 'postal-code' },
    { name: 'city', label: 'Borg / Bær', width: 'last', required: true, autocomplete: 'address-level2' },
    ...(type === 'billing'
      ? ([
          { name: 'phone', label: 'Sími', width: 'wide', required: true, type: 'tel', autocomplete: 'tel' },
          { name: 'email', label: 'Netfang', width: 'wide', required: true, type: 'email', autocomplete: 'email' },
        ] as const)
      : []),
  ];
}

/** What a submitted address still lacks: field name → the message shown under that field, in the form's order. */
export function addressProblems(address: Address, type: 'billing' | 'shipping'): Map<AddressField, string> {
  const problems = new Map<AddressField, string>();
  for (const f of addressFormFields(type)) {
    if (f.required && !(address[f.name] ?? '').trim()) problems.set(f.name, `${f.label} er nauðsynlegur reitur.`);
  }
  const email = (address.email ?? '').trim();
  if (type === 'billing' && email && !/^\S+@\S+\.\S+$/.test(email)) problems.set('email', 'Ógilt netfang.');
  return problems;
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

export type DetailsField = 'account_first_name' | 'account_last_name' | 'account_email' | 'password_current' | 'password_1' | 'password_2';

/** What the "Aðgangsupplýsingar" form submitted. */
export interface DetailsInput {
  first: string;
  last: string;
  email: string;
  current: string;
  next: string;
  confirm: string;
}

/** Name and e-mail trimmed and capped; the passwords as typed (WordPress hashes them untrimmed). */
export function detailsFromForm(form: FormData): DetailsInput {
  const text = (k: DetailsField) => String(form.get(k) ?? '').trim().slice(0, 200);
  const secret = (k: DetailsField) => String(form.get(k) ?? '');
  return {
    first: text('account_first_name'),
    last: text('account_last_name'),
    email: text('account_email'),
    current: secret('password_current'),
    next: secret('password_1'),
    confirm: secret('password_2'),
  };
}

export const WRONG_CURRENT_PASSWORD = 'Núverandi lykilorð er rangt.';
const NEW_PASSWORD_PROBLEMS = {
  short: 'Nýja lykilorðið þarf að vera að minnsta kosti 8 stafir.',
  long: 'Lykilorðið má mest vera 200 stafir.',
} as const;

/** What a submitted details form still lacks: field → the message shown under it. The passwords are checked
 *  only when one of them is filled in; whether the current one is right is WordPress's to say. */
export function detailsProblems(d: DetailsInput): Map<DetailsField, string> {
  const problems = new Map<DetailsField, string>();
  if (!d.first) problems.set('account_first_name', 'Eiginnafn er nauðsynlegur reitur.');
  if (!d.last) problems.set('account_last_name', 'Eftirnafn er nauðsynlegur reitur.');
  if (!d.email) problems.set('account_email', 'Netfang er nauðsynlegur reitur.');
  else if (!/^\S+@\S+\.\S+$/.test(d.email)) problems.set('account_email', 'Ógilt netfang.');
  if (!d.current && !d.next) return problems;

  if (!d.current) problems.set('password_current', 'Sláðu inn núverandi lykilorð.');
  else if (d.current.length > 4096) problems.set('password_current', WRONG_CURRENT_PASSWORD); // over WordPress's limit
  if (!d.next) {
    problems.set('password_1', 'Sláðu inn nýtt lykilorð.');
    return problems;
  }
  const weak = passwordProblem(d.next);
  if (weak) problems.set('password_1', NEW_PASSWORD_PROBLEMS[weak]);
  else if (d.next !== d.confirm) problems.set('password_2', 'Nýju lykilorðin eru ekki eins.');
  return problems;
}
