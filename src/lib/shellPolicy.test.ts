import { describe, expect, it } from 'vitest';
import { BACKGROUND_QUEUE, BACKGROUND_REFRESHES, FRESH_MS, HARD_MAX_AGE_MS, canStore, freshFor, canonicalQuery, freshness, normalPath, filterValuesKnown, refreshAdmission, refreshBackoffMs, replayHeaderNames, shellKey, shellPolicy, storableFilterQuery } from './shellPolicy';

const q = (s: string) => new URLSearchParams(s);
const H = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe('shellPolicy: what is stored, and for how long', () => {
  it('gives product pages a day and home and listings five minutes', () => {
    expect(shellPolicy('/vara/treyja-1/', q(''))).toEqual({ tier: 'product', freshMs: 24 * H, memoryOnly: false });
    // A catalogue URL is a listing until the product page marks itself (lib/shellIncomplete setShellTier).
    expect(shellPolicy('/verslun/skor/vara-1/', q(''))).toMatchObject({ tier: 'listing', freshMs: FRESH_MS.listing });
    expect(shellPolicy('/verslun/kyn/born/', q(''))).toMatchObject({ tier: 'listing' });
    expect(freshFor('product')).toBe(24 * H);
    expect(shellPolicy('/', q(''))).toMatchObject({ tier: 'listing', freshMs: 5 * MIN, memoryOnly: false });
    expect(shellPolicy('/verslun/', q(''))).toMatchObject({ tier: 'listing', freshMs: 5 * MIN });
    expect(shellPolicy('/verslun/page/3/', q(''))).toMatchObject({ tier: 'listing', freshMs: 5 * MIN });
    expect(shellPolicy('/verslun/skor/', q(''))).toMatchObject({ tier: 'listing', freshMs: 5 * MIN });
    expect(shellPolicy('/voruflokkur/skor/', q(''))).toMatchObject({ tier: 'listing' });
    expect(shellPolicy('/brand/casall/', q(''))).toMatchObject({ tier: 'listing' });
    expect(shellPolicy('/merkimidar/x/', q(''))).toMatchObject({ tier: 'listing' });
  });

  it('gives content pages a day', () => {
    expect(shellPolicy('/hafa-samband/', q(''))).toEqual({ tier: 'content', freshMs: 24 * H, memoryOnly: false });
    expect(shellPolicy('/opnunartimi/', q(''))).toMatchObject({ tier: 'content' });
  });

  it('stores filtered archive URLs in memory only, for two minutes, when every parameter is a known filter', () => {
    expect(shellPolicy('/verslun/skor/', q('litur=svartur&verd=5000-10000'))).toEqual({ tier: 'filtered', freshMs: 2 * MIN, memoryOnly: true });
    expect(shellPolicy('/voruflokkur/skor/', q('orderby=price'))).toMatchObject({ tier: 'filtered', memoryOnly: true });
    expect(shellPolicy('/verslun/page/2/', q('utsala=1'))).toMatchObject({ tier: 'filtered', memoryOnly: true });
  });

  // Changed on purpose (stock rule): a stock-filtered listing (lager=1, alone or with utsala=1) is no longer kept in
  // the page store at all, because which products it lists and its counts change with stock.
  it('never stores a stock-filtered listing (lager=1), alone or combined with another filter', () => {
    expect(shellPolicy('/verslun/skor/', q('lager=1'))).toBeNull();
    expect(shellPolicy('/verslun/page/2/', q('utsala=1&lager=1'))).toBeNull();
    expect(shellPolicy('/voruflokkur/skor/', q('litur=svartur&lager=1'))).toBeNull();
    expect(shellPolicy('/verslun/skor/', q('lager=1&orderby=price'))).toBeNull();
  });

  it('never stores a URL with a parameter outside the filter set (sent, error, postlisti, s)', () => {
    for (const s of ['sent=1', 'error=1', 'postlisti=1', 's=treyja', 'litur=svartur&s=x', 'utm_source=x', 'foo']) {
      expect(shellPolicy('/hafa-samband/', q(s)), s).toBeNull();
      expect(shellPolicy('/verslun/', q(s)), s).toBeNull();
    }
  });

  it('never stores a query on a product or content page, even with a filter key', () => {
    expect(shellPolicy('/vara/treyja-1/', q('litur=svartur'))).toBeNull();
    expect(shellPolicy('/verslun/skor/vara-1/', q('litur=svartur'))).toMatchObject({ tier: 'filtered' });
    expect(shellPolicy('/hafa-samband/', q('litur=svartur'))).toBeNull();
  });

  it('never stores personal, API, island, image or asset paths', () => {
    for (const p of ['/karfa/', '/gera-upp/', '/gera-upp/order-received/1/', '/min-sida/', '/oskalisti/', '/utskra/x/', '/api/products', '/_server-islands/abc', '/_image', '/_astro/x.js']) {
      expect(shellPolicy(p, q('')), p).toBeNull();
    }
  });
});

describe('canonicalQuery and shellKey', () => {
  it('sorts keys and drops empty values, so equal filters share one entry', () => {
    expect(canonicalQuery(q('litur=svartur&verd=1&'))).toBe('litur=svartur&verd=1');
    expect(canonicalQuery(q('verd=1&litur=svartur'))).toBe('litur=svartur&verd=1');
    expect(canonicalQuery(q(''))).toBe('');
  });

  it('keys by build and path, and by the canonical query only when there is one', () => {
    expect(shellKey('b1', '/vara/x/', q(''))).toBe('b1|/vara/x/');
    expect(shellKey('b1', '/verslun/', q('verd=1&litur=a'))).toBe('b1|/verslun/?litur=a&verd=1');
    expect(shellKey('b2', '/vara/x/', q(''))).not.toBe(shellKey('b1', '/vara/x/', q('')));
  });
});

describe('freshness', () => {
  const entry = { at: 1_000_000, freshMs: 5 * MIN };
  it('is fresh inside its lifetime, stale after it, expired past the hard age', () => {
    expect(freshness(entry, 1_000_000 + 5 * MIN)).toBe('fresh');
    expect(freshness(entry, 1_000_000 + 5 * MIN + 1)).toBe('stale');
    expect(freshness(entry, 1_000_000 + HARD_MAX_AGE_MS + 1)).toBe('expired');
  });

  it('treats an entry written before an invalidation as stale, one written after as fresh', () => {
    expect(freshness({ ...entry, invalidatedAt: 1_000_500 }, 1_000_100)).toBe('stale');
    expect(freshness({ ...entry, invalidatedAt: 999_000 }, 1_000_100)).toBe('fresh');
  });
});

describe('canStore', () => {
  const ok = {
    method: 'GET',
    status: 200,
    contentType: 'text/html; charset=utf-8' as string | null,
    cacheControl: null as string | null,
    setsCookie: false,
    incomplete: false,
    maintenance: false,
    preview: false,
    canonical: true,
    hasPolicy: true,
  };

  it('stores a complete public 200 HTML page on the canonical host', () => {
    expect(canStore(ok)).toBe(true);
    expect(canStore({ ...ok, cacheControl: 'public, max-age=60' })).toBe(true);
  });

  it('refuses every case the plan lists', () => {
    const refused: Partial<typeof ok>[] = [
      { status: 404 },
      { status: 503 },
      { status: 301 },
      { setsCookie: true },
      { cacheControl: 'no-store' },
      { cacheControl: 'private, no-store' },
      { cacheControl: 'no-cache' },
      { incomplete: true },
      { maintenance: true },
      { preview: true },
      { method: 'HEAD' },
      { method: 'POST' },
      { contentType: 'application/json' },
      { contentType: null },
      { canonical: false },
      { hasPolicy: false },
    ];
    for (const r of refused) expect(canStore({ ...ok, ...r }), JSON.stringify(r)).toBe(false);
  });

  it('keeps the stored headers out of the list that must never be replayed', () => {
    expect(replayHeaderNames(['Content-Type', 'Set-Cookie', 'Content-Length', 'Cache-Control', 'Content-Language', 'Date'])).toEqual([
      'Content-Type',
      'Cache-Control',
      'Content-Language',
    ]);
  });
});

describe('shellPolicy: one path form, junk filters, backoff (review 10, 15, 1)', () => {
  it('never stores a URL that repeats a query key: the page reads the first value, the key would hold both', () => {
    // ?orderby=price&orderby=date and its reverse sort differently but would share one sorted key.
    expect(shellPolicy('/verslun/', q('orderby=price&orderby=date'))).toBeNull();
    expect(shellPolicy('/verslun/', q('orderby=date&orderby=price'))).toBeNull();
    expect(shellPolicy('/verslun/', q('utsala=1&utsala=1'))).toBeNull();
    expect(shellPolicy('/verslun/', q('orderby=price'))).toMatchObject({ tier: 'filtered' });
  });

  it('compares an Icelandic slug the same however it is encoded', () => {
    const decoded = '/verslun/þjálfun-æfing/';
    const upper = '/verslun/%C3%BEj%C3%A1lfun-%C3%A6fing/';
    const lower = '/verslun/%c3%bej%c3%a1lfun-%c3%a6fing/';
    const nfd = '/verslun/' + 'þjálfun-æfing'.normalize('NFD') + '/';
    const forms = [decoded, upper, lower, nfd].map(normalPath);
    expect(new Set(forms).size).toBe(1);
    expect(forms[0]).toBe('/verslun/þjálfun-æfing/'.normalize('NFC'));
  });

  it('keeps a path with bad percent-encoding as it is, without throwing', () => {
    expect(normalPath('/verslun/%E0%A4%A/')).toBe('/verslun/%E0%A4%A/');
  });

  it('gives the store key one path form, so a poke and a page meet', () => {
    expect(shellKey('b1', '/verslun/%C3%BEj%C3%A1lfun/', q(''))).toBe(shellKey('b1', '/verslun/þjálfun/', q('')));
  });

  it('gives a filter key only to values the archive can produce', () => {
    expect(storableFilterQuery(q('orderby=price'))).toBe(true);
    expect(storableFilterQuery(q('orderby=rand-7f3a'))).toBe(false);
    expect(storableFilterQuery(q('verd=0-5000'))).toBe(true);
    expect(storableFilterQuery(q('verd=junk'))).toBe(false);
    expect(storableFilterQuery(q('utsala=1'))).toBe(true);
    expect(storableFilterQuery(q('utsala=yes'))).toBe(false);
    expect(storableFilterQuery(q('kyn=karlar'))).toBe(true);
    expect(storableFilterQuery(q('kyn=' + Array.from({ length: 30 }, (_, i) => `t${i}`).join(',')))).toBe(false);
    expect(storableFilterQuery(q('kyn=A%20B'))).toBe(false);
  });

  it('refuses a junk filter value in the policy, so no page is kept for it', () => {
    expect(shellPolicy('/verslun/skor/', q('orderby=rand-x'))).toBeNull();
    expect(shellPolicy('/verslun/skor/', q('orderby=price'))?.memoryOnly).toBe(true);
  });

  it('backs a failing refresh off: 30 s, doubling, at most 30 min', () => {
    expect(refreshBackoffMs(1)).toBe(30_000);
    expect(refreshBackoffMs(2)).toBe(60_000);
    expect(refreshBackoffMs(3)).toBe(120_000);
    expect(refreshBackoffMs(50)).toBe(30 * 60_000);
  });
});

describe('shellPolicy: filter values must be catalogue terms (review 10)', () => {
  const terms = {
    categories: [{ slug: 'karlar' }, { slug: 'skor' }],
    brands: [{ slug: 'nike' }],
    teams: [{ slug: 'valur' }],
    sports: [{ slug: 'fotbolti' }],
    colours: [{ slug: 'hvitur' }],
    sizes: [{ slug: 'm' }],
  };
  it('keeps a filter whose values are catalogue terms', () => {
    expect(filterValuesKnown(q('kyn=karlar,skor&brand=nike&staerd=m'), terms)).toBe(true);
  });
  it('refuses a made-up value, in any one of the values', () => {
    expect(filterValuesKnown(q('kyn=a1'), terms)).toBe(false);
    expect(filterValuesKnown(q('kyn=karlar,a2'), terms)).toBe(false);
    expect(filterValuesKnown(q('brand=nike-x'), terms)).toBe(false);
  });
  it('does not check sort, price and flags here (storableFilterQuery does)', () => {
    expect(filterValuesKnown(q('orderby=price&utsala=1'), terms)).toBe(true);
  });
  it('refuses a size when the size index is not loaded', () => {
    expect(filterValuesKnown(q('staerd=m'), { ...terms, sizes: undefined })).toBe(false);
  });
});

describe('refreshAdmission', () => {
  // A content save marks every stored page stale at once: the re-renders it starts are bounded, the rest wait or are
  // not made (the stale copy is served meanwhile, so nothing waits on them).
  it('starts a background refresh while a slot is free', () => {
    expect(refreshAdmission(0, 0)).toBe('start');
    expect(refreshAdmission(BACKGROUND_REFRESHES - 1, 0)).toBe('start');
  });

  it('queues the refreshes past the slots, up to the queue length, then skips them', () => {
    expect(refreshAdmission(BACKGROUND_REFRESHES, 0)).toBe('queue');
    expect(refreshAdmission(BACKGROUND_REFRESHES, BACKGROUND_QUEUE - 1)).toBe('queue');
    expect(refreshAdmission(BACKGROUND_REFRESHES, BACKGROUND_QUEUE)).toBe('skip');
  });
}); 
