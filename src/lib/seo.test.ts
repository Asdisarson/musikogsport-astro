import { describe, expect, it } from 'vitest';
import {
  SITE_NAME,
  isCanonicalHost,
  listingCanonicalSearch,
  listingDescription,
  metaDescription,
  pageTitle,
  productFallbackDescription,
  storeLd,
} from './seo';

describe('pageTitle', () => {
  it('ends every page title with the shop name', () => {
    expect(pageTitle('Hlaupaskór')).toBe('Hlaupaskór | Músík og Sport');
  });
  it('gives the home page its own title', () => {
    expect(pageTitle(undefined)).toBe('Músík og Sport – íþróttavöruverslun í Hafnarfirði');
    expect(pageTitle('')).toBe('Músík og Sport – íþróttavöruverslun í Hafnarfirði');
  });
  it('uses one spelling of the name', () => {
    expect(SITE_NAME).toBe('Músík og Sport');
  });
});

describe('metaDescription', () => {
  it('takes the first candidate that has text', () => {
    expect(metaDescription('', '   ', 'Þriðja.')).toBe('Þriðja.');
    expect(metaDescription('Fyrsta.', 'Önnur.')).toBe('Fyrsta.');
  });
  it('strips tags, decodes entities and collapses white space', () => {
    expect(metaDescription('<p>Léttir &amp; mjúkir</p>\n<p>skór</p>')).toBe('Léttir & mjúkir skór');
  });
  it('skips a candidate that is only markup', () => {
    expect(metaDescription('<p><br></p>', 'Texti.')).toBe('Texti.');
  });
  it('cuts at a word boundary within 155 characters and marks the cut', () => {
    const long = Array(60).fill('orðið').join(' ');
    const out = metaDescription(long);
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1).endsWith('orðið')).toBe(true);
  });
  it('leaves a text of exactly 155 characters alone', () => {
    const exact = 'a'.repeat(155);
    expect(metaDescription(exact)).toBe(exact);
  });
  it('cuts one unbroken long word hard', () => {
    const out = metaDescription('a'.repeat(300));
    expect(out.length).toBe(155);
  });
  it('is empty when nothing has text', () => {
    expect(metaDescription(undefined, null, '')).toBe('');
  });
});

describe('productFallbackDescription', () => {
  it('names the product, brand and price', () => {
    expect(productFallbackDescription({ name: 'Clifton 9', brand: 'Hoka', price: '24.990 kr.' })).toBe(
      'Clifton 9 frá Hoka. 24.990 kr. Fæst í vefverslun Músík og Sport.',
    );
  });
  it('leaves out what is missing', () => {
    expect(productFallbackDescription({ name: 'Bolti' })).toBe('Bolti. Fæst í vefverslun Músík og Sport.');
  });
});

describe('listingDescription', () => {
  it('prefers the term description from WooCommerce', () => {
    expect(listingDescription({ name: 'Skór', count: 12, termDescription: '<p>Allir skór.</p>' })).toBe('Allir skór.');
  });
  it('else names the listing and how many products it has', () => {
    expect(listingDescription({ name: 'Skór', count: 12 })).toBe(
      'Skór – 12 vörur í vefverslun Músík og Sport. Íþróttavörur frá fagfólki í Hafnarfirði.',
    );
  });
  it('says "vara" for a count ending in 1 (but not 11)', () => {
    expect(listingDescription({ name: 'Skór', count: 21 })).toContain('21 vara í');
    expect(listingDescription({ name: 'Skór', count: 11 })).toContain('11 vörur í');
  });
  it('leaves the count out when it is unknown or zero', () => {
    expect(listingDescription({ name: 'Hoka', count: 0 })).toBe(
      'Hoka í vefverslun Músík og Sport. Íþróttavörur frá fagfólki í Hafnarfirði.',
    );
  });
});

describe('listingCanonicalSearch', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('keeps kyn when it is the only filter and one value', () => {
    expect(listingCanonicalSearch(q('kyn=konur'))).toBe('?kyn=konur');
  });
  it('drops every other combination', () => {
    expect(listingCanonicalSearch(q(''))).toBe('');
    expect(listingCanonicalSearch(q('kyn=konur,born'))).toBe('');
    expect(listingCanonicalSearch(q('kyn=konur&brand=nike'))).toBe('');
    expect(listingCanonicalSearch(q('brand=nike'))).toBe('');
    expect(listingCanonicalSearch(q('kyn=konur&orderby=price'))).toBe('');
    expect(listingCanonicalSearch(q('kyn=konur&kyn=karlar'))).toBe('');
  });
  it('ignores a value that is not a plain slug', () => {
    expect(listingCanonicalSearch(q('kyn=%3Cscript%3E'))).toBe('');
    expect(listingCanonicalSearch(q('kyn='))).toBe('');
  });
});

describe('isCanonicalHost', () => {
  it('is true on the site host, whatever the case or port', () => {
    expect(isCanonicalHost('musikogsport.is', 'https://musikogsport.is')).toBe(true);
    expect(isCanonicalHost('MusikOgSport.is:443', 'https://musikogsport.is/')).toBe(true);
  });
  it('is false on any other host', () => {
    expect(isCanonicalHost('new.musikogsport.is', 'https://musikogsport.is')).toBe(false);
    expect(isCanonicalHost('www.musikogsport.is', 'https://musikogsport.is')).toBe(false);
  });
  it('is true when the host or the site is unknown (never hide the real site by accident)', () => {
    expect(isCanonicalHost(null, 'https://musikogsport.is')).toBe(true);
    expect(isCanonicalHost('new.musikogsport.is', undefined)).toBe(true);
  });
});

describe('storeLd', () => {
  const base = {
    siteUrl: 'https://musikogsport.is/',
    logo: 'https://musikogsport.is/logo-header.webp',
    email: 'verslun@example.is',
    phone: '555 2887',
    address: 'Dalshraun 10\n220 Hafnarfjörður',
    instagram: 'https://www.instagram.com/musikogsport/',
  };
  it('describes the shop as a sporting goods store with its address', () => {
    const node = storeLd({ ...base, week: null });
    expect(node['@type']).toBe('SportingGoodsStore');
    expect(node.name).toBe('Músík og Sport');
    expect(node.telephone).toBe('+3545552887');
    expect(node.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Dalshraun 10',
      postalCode: '220',
      addressLocality: 'Hafnarfjörður',
      addressCountry: 'IS',
    });
    expect(node.sameAs).toEqual(['https://www.instagram.com/musikogsport/']);
  });
  it('has no opening hours when the page could not be read', () => {
    expect('openingHoursSpecification' in storeLd({ ...base, week: null })).toBe(false);
  });
  it('lists the open days, grouped by equal hours, and skips closed days', () => {
    const day = { open: '10:00', close: '18:00' };
    const week = [day, day, day, day, day, { open: '11:00', close: '15:00' }, null];
    expect(storeLd({ ...base, week }).openingHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '10:00', closes: '18:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday'], opens: '11:00', closes: '15:00' },
    ]);
  });
  it('falls back to the known address when the footer text has another shape', () => {
    const node = storeLd({ ...base, address: 'Einhvers staðar', week: null });
    expect(node.address.streetAddress).toBe('Dalshraun 10');
    expect(node.address.postalCode).toBe('220');
  });
  it('keeps a phone number that already has a country code', () => {
    expect(storeLd({ ...base, phone: '+354 555 2887', week: null }).telephone).toBe('+3545552887');
  });
  it('leaves out an empty phone or e-mail', () => {
    const node = storeLd({ ...base, phone: '', email: '', week: null });
    expect('telephone' in node).toBe(false);
    expect('email' in node).toBe(false);
  });
});
