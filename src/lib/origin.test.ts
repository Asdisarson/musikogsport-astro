// Where a visit came from, in the shape WooCommerce's order attribution reads (what sourcebuster would have sent).
import { describe, expect, it } from 'vitest';
import { REMEMBER_MS, chooseOrigin, countPage, pageOrigin, rememberSince, originExtension, originFromVisit, readConsent, rememberedOrigin } from './origin';

const now = new Date('2026-11-16T06:30:05Z');
const visit = (url: string, referrer = '') => originFromVisit({ url, referrer, now });

describe('originFromVisit', () => {
  it('a tagged link is "utm", with the tags it carries', () => {
    expect(visit('https://musikogsport.is/verslun/?utm_source=facebook&utm_medium=cpc&utm_campaign=jol&utm_content=a&utm_term=b&utm_id=7', 'https://l.facebook.com/')).toEqual({
      source_type: 'utm',
      referrer: 'https://l.facebook.com/',
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'jol',
      utm_content: 'a',
      utm_term: 'b',
      utm_id: '7',
      session_entry: 'https://musikogsport.is/verslun/',
      session_start_time: '2026-11-16 06:30:05',
      session_pages: '1',
      session_count: '1',
    });
  });

  it('a search engine is "organic", named without its country or www', () => {
    expect(visit('https://musikogsport.is/', 'https://www.google.is/')).toMatchObject({ source_type: 'organic', utm_source: 'google', utm_medium: 'organic', referrer: 'https://www.google.is/' });
    expect(visit('https://musikogsport.is/', 'https://duckduckgo.com/')).toMatchObject({ source_type: 'organic', utm_source: 'duckduckgo' });
    expect(visit('https://musikogsport.is/', 'https://www.bing.com/search?q=x#f')).toMatchObject({ source_type: 'organic', utm_source: 'bing', referrer: 'https://www.bing.com/search' }); // no query: it can hold what was searched
  });

  it('another site is a "referral" from its host', () => {
    expect(visit('https://musikogsport.is/', 'https://www.ja.is/musik-og-sport/')).toMatchObject({ source_type: 'referral', utm_source: 'ja.is', utm_medium: 'referral' });
    expect(visit('https://musikogsport.is/', 'https://notgoogle.example/')).toMatchObject({ source_type: 'referral', utm_source: 'notgoogle.example' });
  });

  it('no referrer, our own pages and an unreadable referrer are "typein" (Direct)', () => {
    const direct = { source_type: 'typein', utm_source: '(direct)', utm_medium: '(none)', referrer: '' };
    expect(visit('https://musikogsport.is/')).toMatchObject(direct);
    expect(visit('https://musikogsport.is/karfa/', 'https://musikogsport.is/verslun/')).toMatchObject(direct);
    expect(visit('https://musikogsport.is/', 'https://wp.musikogsport.is/gera-upp/order-pay/1/')).toMatchObject(direct);
    expect(visit('https://musikogsport.is/', 'not a url')).toMatchObject(direct);
  });

  it('keeps the entry page without its query (no tags or tokens in the stored URL) and caps long values', () => {
    const o = visit(`https://musikogsport.is/verslun/?utm_source=${'x'.repeat(500)}&key=secret`);
    expect(o.session_entry).toBe('https://musikogsport.is/verslun/');
    expect(o.utm_source).toHaveLength(200);
  });
});

describe('countPage', () => {
  it('adds one page to the visit, starting from 1 for an odd value', () => {
    const o = visit('https://musikogsport.is/');
    expect(countPage(o).session_pages).toBe('2');
    expect(countPage({ ...o, session_pages: 'x' }).session_pages).toBe('1');
  });
});

describe('originExtension', () => {
  it('keeps only the known fields, as capped strings', () => {
    expect(originExtension({ source_type: 'utm', utm_source: 'f'.repeat(300), session_pages: 3, role: 'administrator', user_agent: 'spoofed' })).toEqual({
      source_type: 'utm',
      utm_source: 'f'.repeat(200),
    });
  });

  it('is null without a usable source type', () => {
    expect(originExtension(null)).toBeNull();
    expect(originExtension('typein')).toBeNull();
    expect(originExtension({ utm_source: 'x' })).toBeNull();
    expect(originExtension({ source_type: 'admin', utm_source: 'x' })).toBeNull();
  });
});

describe('rememberedOrigin (after "Samþykkja": kept 30 days)', () => {
  const origin = visit('https://musikogsport.is/?utm_source=facebook');
  const at = now.getTime();

  it('returns the kept origin within 30 days', () => {
    expect(rememberedOrigin({ origin, at }, new Date(at + REMEMBER_MS - 1))).toEqual({ origin, at });
  });

  it('forgets it after 30 days, when dated in the future, or when it is not an origin', () => {
    expect(rememberedOrigin({ origin, at }, new Date(at + REMEMBER_MS + 1))).toBeNull();
    expect(rememberedOrigin({ origin, at: at + 60_000 }, now)).toBeNull();
    expect(rememberedOrigin({ origin: { evil: 1 }, at }, now)).toBeNull();
    expect(rememberedOrigin({ origin }, now)).toBeNull();
    expect(rememberedOrigin(null, now)).toBeNull();
  });
});

describe('chooseOrigin', () => {
  const ad = { origin: visit('https://musikogsport.is/?utm_source=facebook&utm_campaign=jol'), at: now.getTime() - 86_400_000 };
  const later = new Date('2026-11-20T10:00:00Z');
  const direct = originFromVisit({ url: 'https://musikogsport.is/karfa/', referrer: '', now: later });

  it('a direct visit keeps the remembered source, with this visit\'s own entry page and time, as one more visit', () => {
    expect(chooseOrigin(direct, ad, later)).toEqual({
      origin: { ...ad.origin, session_entry: 'https://musikogsport.is/karfa/', session_start_time: '2026-11-20 10:00:00', session_pages: '1', session_count: '2' },
      at: ad.at,
    });
  });

  it('a new tagged link, search or referral replaces it and restarts the 30 days', () => {
    const google = originFromVisit({ url: 'https://musikogsport.is/', referrer: 'https://www.google.is/', now: later });
    expect(chooseOrigin(google, ad, later)).toEqual({ origin: { ...google, session_count: '2' }, at: later.getTime() });
  });

  it('with nothing remembered, the visit is its own origin', () => {
    expect(chooseOrigin(direct, null, later)).toEqual({ origin: direct, at: later.getTime() });
  });
});

describe('readConsent', () => {
  it('reads only a clear yes or no', () => {
    expect(readConsent('yes')).toBe('yes');
    expect(readConsent('no')).toBe('no');
    expect(readConsent(null)).toBeNull();
    expect(readConsent('1')).toBeNull();
  });
});

describe('pageOrigin (each page of a visit)', () => {
  const ad = visit('https://musikogsport.is/?utm_source=facebook');
  const inside = originFromVisit({ url: 'https://musikogsport.is/verslun/', referrer: 'https://musikogsport.is/', now });

  it('a page reached from inside the site is one more page of the same visit', () => {
    expect(pageOrigin(ad, inside)).toEqual({ ...ad, session_pages: '2' });
  });

  it('arriving again from a tagged link, a search or another site in the same tab starts from that source', () => {
    const google = visit('https://musikogsport.is/', 'https://www.google.is/');
    expect(pageOrigin(ad, google)).toEqual(google);
  });

  it('the first page is its own origin', () => {
    expect(pageOrigin(null, inside)).toEqual(inside);
  });
});

describe('rememberSince', () => {
  const ad = visit('https://musikogsport.is/?utm_source=facebook');
  const kept = { origin: ad, at: now.getTime() - 5 * 86_400_000 };

  it('saying yes again to the same source does not restart its 30 days', () => {
    expect(rememberSince(kept, countPage(ad), now)).toBe(kept.at);
  });

  it('a different source, or nothing kept, counts from now', () => {
    expect(rememberSince(kept, visit('https://musikogsport.is/', 'https://www.google.is/'), now)).toBe(now.getTime());
    expect(rememberSince(null, ad, now)).toBe(now.getTime());
  });
});
