import { describe, expect, it } from 'vitest';
import { addressFromForm, addressLines, addressProblems, detailsFromForm, detailsProblems } from './accountFormat';

describe('addressFromForm', () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it('keeps only known address fields, trimmed, and pins the country to Iceland', () => {
    expect(addressFromForm(form({ first_name: ' Jón ', city: 'Reykjavík', role: 'administrator', country: 'US' }), 'billing')).toEqual({
      first_name: 'Jón',
      city: 'Reykjavík',
      country: 'IS',
    });
  });

  it('drops email from a shipping address (WooCommerce shipping has none)', () => {
    expect(addressFromForm(form({ email: 'a@b.is', postcode: '220' }), 'shipping')).toEqual({ postcode: '220', country: 'IS' });
  });

  it('sends a field submitted empty as "" so clearing it in the form clears it in WooCommerce', () => {
    expect(addressFromForm(form({ company: '   ', city: 'Reykjavík' }), 'billing')).toEqual({ company: '', city: 'Reykjavík', country: 'IS' });
  });

  it('caps very long values', () => {
    expect(addressFromForm(form({ address_1: 'x'.repeat(500) }), 'billing').address_1).toHaveLength(200);
  });
});

describe('addressLines', () => {
  it('formats a WooCommerce address the Icelandic way (postcode before town)', () => {
    expect(addressLines({ first_name: 'Jón', last_name: 'Jónsson', address_1: 'Dalshraun 10', postcode: '220', city: 'Hafnarfjörður' })).toEqual([
      'Jón Jónsson',
      'Dalshraun 10',
      '220 Hafnarfjörður',
    ]);
  });

  it('is empty for an empty address', () => {
    expect(addressLines({})).toEqual([]);
  });
});

// The address form (/min-sida/edit-address/<type>/) shows each problem at its own field.
describe('addressProblems', () => {
  const full = { first_name: 'Anna', last_name: 'Jónsdóttir', address_1: 'Dalshraun 10', postcode: '220', city: 'Hafnarfjörður', phone: '5550000', email: 'anna@b.is' };

  it('a complete address has none', () => {
    expect(addressProblems(full, 'billing').size).toBe(0);
    expect(addressProblems({ ...full, phone: '', email: '' }, 'shipping').size).toBe(0); // a delivery address has no phone or e-mail
  });

  it('names each missing required field under that field, in the form\'s order', () => {
    expect(Object.fromEntries(addressProblems({ ...full, first_name: '', postcode: '', email: '' }, 'billing'))).toEqual({
      first_name: 'Eiginnafn er nauðsynlegur reitur.',
      postcode: 'Póstnúmer er nauðsynlegur reitur.',
      email: 'Netfang er nauðsynlegur reitur.',
    });
    expect([...addressProblems({}, 'shipping').keys()]).toEqual(['first_name', 'last_name', 'address_1', 'postcode', 'city']);
    expect([...addressProblems({}, 'billing').keys()]).toEqual(['first_name', 'last_name', 'address_1', 'postcode', 'city', 'phone', 'email']);
  });

  it('a malformed e-mail address on the billing address is reported at the e-mail field', () => {
    expect(Object.fromEntries(addressProblems({ ...full, email: 'anna@b' }, 'billing'))).toEqual({ email: 'Ógilt netfang.' });
  });
});

describe('detailsProblems', () => {
  const ok = { first: 'Anna', last: 'Jónsdóttir', email: 'anna@b.is', current: '', next: '', confirm: '' };

  it('name and e-mail alone are enough', () => {
    expect(detailsProblems(ok).size).toBe(0);
  });

  it('names each missing or malformed field under that field', () => {
    expect(Object.fromEntries(detailsProblems({ ...ok, first: '', last: '', email: '' }))).toEqual({
      account_first_name: 'Eiginnafn er nauðsynlegur reitur.',
      account_last_name: 'Eftirnafn er nauðsynlegur reitur.',
      account_email: 'Netfang er nauðsynlegur reitur.',
    });
    expect(Object.fromEntries(detailsProblems({ ...ok, email: 'anna@b' }))).toEqual({ account_email: 'Ógilt netfang.' });
  });

  it('a password change needs the current password, a usable new one and a matching repeat', () => {
    expect(Object.fromEntries(detailsProblems({ ...ok, next: 'nytt-lykilord', confirm: 'nytt-lykilord' }))).toEqual({
      password_current: 'Sláðu inn núverandi lykilorð.',
    });
    expect(Object.fromEntries(detailsProblems({ ...ok, current: 'gamalt' }))).toEqual({ password_1: 'Sláðu inn nýtt lykilorð.' });
    expect(Object.fromEntries(detailsProblems({ ...ok, current: 'gamalt', next: 'stutt', confirm: 'stutt' }))).toEqual({
      password_1: 'Nýja lykilorðið þarf að vera að minnsta kosti 8 stafir.',
    });
    expect(Object.fromEntries(detailsProblems({ ...ok, current: 'gamalt', next: 'x'.repeat(201), confirm: 'x'.repeat(201) }))).toEqual({
      password_1: 'Lykilorðið má mest vera 200 stafir.',
    });
    expect(Object.fromEntries(detailsProblems({ ...ok, current: 'gamalt', next: 'nytt-lykilord', confirm: 'annad-lykilord' }))).toEqual({
      password_2: 'Nýju lykilorðin eru ekki eins.',
    });
    expect(detailsProblems({ ...ok, current: 'gamalt', next: 'nytt-lykilord', confirm: 'nytt-lykilord' }).size).toBe(0);
  });

  it('a current password over WordPress\'s limit cannot be the password', () => {
    expect(Object.fromEntries(detailsProblems({ ...ok, current: 'x'.repeat(4097), next: 'nytt-lykilord', confirm: 'nytt-lykilord' }))).toEqual({
      password_current: 'Núverandi lykilorð er rangt.',
    });
  });
});

describe('detailsFromForm', () => {
  it('trims and caps the name and e-mail, and leaves the passwords as typed', () => {
    const f = new FormData();
    f.set('account_first_name', '  Anna ');
    f.set('account_last_name', 'x'.repeat(300));
    f.set('account_email', ' anna@b.is ');
    f.set('password_current', ' gamalt ');
    f.set('password_1', ' nytt ');
    expect(detailsFromForm(f)).toEqual({ first: 'Anna', last: 'x'.repeat(200), email: 'anna@b.is', current: ' gamalt ', next: ' nytt ', confirm: '' });
  });
});
