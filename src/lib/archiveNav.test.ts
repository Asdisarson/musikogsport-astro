import { describe, expect, it } from 'vitest';
import { announceText, applyOp, chipFocusIndex, composeOp, focusFallbacks, historyAction, initialScroll, isFilterKey, isPlainClick, matchesSearch, viewKey, withTimeout } from './archiveNav';

describe('matchesSearch: the search box in long option lists', () => {
  it('matches however the name is typed: case, accents, Icelandic letters', () => {
    expect(matchesSearch('Keflavík', 'keflavik')).toBe(true);
    expect(matchesSearch('Þór', 'thor')).toBe(true);
    expect(matchesSearch('Blakfélag Hafnarfjarðar', 'hafnarfjardar')).toBe(true);
    expect(matchesSearch('Músík & Sport', 'MÚSÍK')).toBe(true);
  });

  it('needs every typed word, in any order', () => {
    expect(matchesSearch('Manchester United', 'united man')).toBe(true);
    expect(matchesSearch('Manchester City', 'united man')).toBe(false);
  });

  it('matches everything on an empty or blank search', () => {
    expect(matchesSearch('Liverpool', '')).toBe(true);
    expect(matchesSearch('Liverpool', '   ')).toBe(true);
  });
});

describe('applyOp (the URL a filter click leads to, composed on the pending URL)', () => {
  it('toggles a value on and off, landing on page 1 of the archive base', () => {
    expect(applyOp('/voruflokkur/skor/', '/voruflokkur/skor/', { type: 'toggle', key: 'brand', value: 'nike' })).toBe('/voruflokkur/skor/?brand=nike');
    expect(applyOp('/voruflokkur/skor/page/3/?brand=nike', '/voruflokkur/skor/', { type: 'toggle', key: 'brand', value: 'nike' })).toBe(
      '/voruflokkur/skor/',
    );
  });
  it('composes rapid clicks: each one applies to the URL the previous one asked for', () => {
    let url = '/verslun/?orderby=price';
    url = applyOp(url, '/verslun/', { type: 'toggle', key: 'brand', value: 'nike' });
    url = applyOp(url, '/verslun/', { type: 'toggle', key: 'staerd', value: '42' });
    url = applyOp(url, '/verslun/', { type: 'toggle', key: 'utsala', value: '1' });
    expect(url).toBe('/verslun/?orderby=price&brand=nike&staerd=42&utsala=1');
  });
  it('replaces the single-valued price preset', () => {
    expect(applyOp('/verslun/?verd=0-5000', '/verslun/', { type: 'toggle', key: 'verd', value: '5000-10000' })).toBe('/verslun/?verd=5000-10000');
  });
  it('clears one group, or every filter keeping sort and search', () => {
    expect(applyOp('/?s=nike&brand=nike&kyn=konur', '/', { type: 'clear', key: 'brand' })).toBe('/?s=nike&kyn=konur');
    expect(applyOp('/?s=nike&brand=nike&kyn=konur&orderby=price', '/', { type: 'clear-all' })).toBe('/?s=nike&orderby=price');
  });
  it('sets the sort order, keeping the filters, on page 1', () => {
    expect(applyOp('/verslun/page/2/?brand=nike', '/verslun/', { type: 'sort', value: 'price' })).toBe('/verslun/?brand=nike&orderby=price');
    expect(applyOp('/verslun/?orderby=date&brand=nike', '/verslun/', { type: 'sort', value: 'price' })).toBe('/verslun/?orderby=price&brand=nike');
  });
  it('accepts an absolute URL and drops its hash', () => {
    expect(applyOp('http://127.0.0.1:4323/verslun/?brand=nike#main', '/verslun/', { type: 'toggle', key: 'lager', value: '1' })).toBe(
      '/verslun/?brand=nike&lager=1',
    );
  });
});

describe('composeOp: a click that would cross a pick cap does nothing (confirmed 1)', () => {
  const base = '/verslun/';
  const brands = (...slugs: string[]) => `${base}?brand=${slugs.join(',')}`;
  const pick = (key: 'brand' | 'kyn' | 'team', value: string) => ({ type: 'toggle' as const, key, value });

  it('refuses a seventh brand composed onto a pending URL that already holds six, and allows the sixth', () => {
    const shown = brands('b1', 'b2', 'b3', 'b4', 'b5');
    const pending = composeOp(shown, base, pick('brand', 'b6'));
    expect(pending).not.toBeNull();
    expect(composeOp(pending!, base, pick('brand', 'b7'))).toBeNull();
  });

  it('refuses the seventh pick when a second click arrives while the first is still in flight', () => {
    // the page shows five; the first click (b6) is pending and has not landed; the second (b7) composes onto the pending URL
    const pending = composeOp(brands('b1', 'b2', 'b3', 'b4', 'b5'), base, pick('brand', 'b6'))!;
    expect(composeOp(pending, base, pick('brand', 'b7'))).toBeNull();
  });

  it('refuses the thirteenth pick across groups (12 in all), but still allows unticking', () => {
    const kyn = Array.from({ length: 6 }, (_, i) => `k${i + 1}`).join(',');
    const url = `${base}?kyn=${kyn}&brand=b1,b2,b3,b4,b5,b6`;
    expect(composeOp(url, base, pick('team', 't1'))).toBeNull();
    expect(composeOp(url, base, { type: 'toggle', key: 'brand', value: 'b1' })).toBe(`${base}?kyn=${encodeURIComponent(kyn)}&brand=b2%2Cb3%2Cb4%2Cb5%2Cb6`);
  });

  it('is the same as applyOp when the composed URL is within the caps', () => {
    expect(composeOp(brands('b1'), base, pick('brand', 'b2'))).toBe(applyOp(brands('b1'), base, pick('brand', 'b2')));
    expect(composeOp(base, base, { type: 'sort', value: 'price' })).toBe(applyOp(base, base, { type: 'sort', value: 'price' }));
  });
});

describe('isFilterKey', () => {
  it('knows the URL filter keys only', () => {
    expect(isFilterKey('brand')).toBe(true);
    expect(isFilterKey('product-category')).toBe(true);
    expect(isFilterKey('orderby')).toBe(false);
    expect(isFilterKey(undefined)).toBe(false);
  });
});

describe('isPlainClick', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  it('lets modified, middle and already-handled clicks through to the browser', () => {
    expect(isPlainClick(click)).toBe(true);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
  });
});

describe('announceText', () => {
  it('says how many products show, or that none were found', () => {
    expect(announceText(24)).toBe('Sýni 24 vörur');
    expect(announceText(21)).toBe('Sýni 21 vara');
    expect(announceText(0)).toBe('Engar vörur fundust');
  });
});

describe('focusFallbacks (where focus goes when the control it was on is gone after a swap)', () => {
  it('keeps the option, then its group heading, then the title', () => {
    expect(focusFallbacks('opt:brand:nike', 'brand')).toEqual(['opt:brand:nike', 'group:brand', 'title']);
  });
  it('sends a per-group clear to its group heading', () => {
    expect(focusFallbacks('clear:staerd', 'staerd')).toEqual(['clear:staerd', 'group:staerd', 'title']);
  });
  it('sends a removed chip to the chips heading, then the title', () => {
    expect(focusFallbacks('chip:brand:nike')).toEqual(['chip:brand:nike', 'chips', 'title']);
    expect(focusFallbacks('clear-all')).toEqual(['clear-all', 'chips', 'title']);
  });
  it('sends the sheet clear to the sheet close button', () => {
    expect(focusFallbacks('sheet-clear')).toEqual(['sheet-clear', 'sheet-close', 'title']);
  });
});

describe('chipFocusIndex', () => {
  it('focuses the chip that took the removed one’s place, else the last, else none', () => {
    expect(chipFocusIndex(0, 3)).toBe(0);
    expect(chipFocusIndex(2, 2)).toBe(1);
    expect(chipFocusIndex(0, 0)).toBe(-1);
  });
});

describe('viewKey', () => {
  it('ignores the hash, so the skip link is not a filter change', () => {
    expect(viewKey('http://x/verslun/?brand=nike#main')).toBe(viewKey('http://x/verslun/?brand=nike'));
    expect(viewKey('http://x/verslun/?brand=nike')).not.toBe(viewKey('http://x/verslun/?brand=adidas'));
  });
});

describe('initialScroll: an archive history entry opened by a fresh load restores its own scroll (F-4)', () => {
  it('returns the saved scroll of one of our entries on a fresh load', () => {
    expect(initialScroll({ mosArchive: 3, scrollY: 1200 }, false)).toBe(1200);
    expect(initialScroll({ mosArchive: 0, scrollY: 0 }, false)).toBe(0);
  });
  it('leaves a bfcache restore alone: the page comes back as it was', () => {
    expect(initialScroll({ mosArchive: 3, scrollY: 1200 }, true)).toBeNull();
  });
  it('leaves other entries to the browser (no state, someone else\'s state, no saved scroll)', () => {
    expect(initialScroll(null, false)).toBeNull();
    expect(initialScroll({ other: 1 }, false)).toBeNull();
    expect(initialScroll({ mosArchive: 2 }, false)).toBeNull();
    expect(initialScroll({ mosArchive: 2, scrollY: 'x' }, false)).toBeNull();
    expect(initialScroll({ mosArchive: 2, scrollY: -5 }, false)).toBeNull();
  });
});

describe('historyAction: what a landed swap does to the history (F-10)', () => {
  it('pushes a new entry for a new view', () => {
    expect(historyAction('push', '/verslun/?brand=nike', '/verslun/')).toBe('push');
  });
  it('replaces the entry when the click led back to what is already shown (e.g. on and off again quickly)', () => {
    expect(historyAction('push', '/verslun/', '/verslun/')).toBe('replace');
  });
  it('leaves the history alone for back/forward', () => {
    expect(historyAction('pop', '/verslun/?brand=nike', '/verslun/')).toBe('none');
  });
});

describe('withTimeout: the archive fetch gives up after a while, apart from a user abort (F-11)', () => {
  it('aborts after the timeout without aborting the caller\'s own signal', async () => {
    const ctrl = new AbortController();
    const t = withTimeout(ctrl.signal, 10);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(true);
    expect(ctrl.signal.aborted).toBe(false);
    t.clear();
  });
  it('follows the caller\'s abort and reports it as not a timeout', () => {
    const ctrl = new AbortController();
    const t = withTimeout(ctrl.signal, 1000);
    ctrl.abort();
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(false);
    t.clear();
  });
  it('works without AbortSignal.any (older browsers): a manual timer', async () => {
    const any = AbortSignal.any;
    // @ts-expect-error simulate a browser without AbortSignal.any
    AbortSignal.any = undefined;
    try {
      const ctrl = new AbortController();
      const t = withTimeout(ctrl.signal, 10);
      await new Promise((r) => setTimeout(r, 30));
      expect(t.signal.aborted).toBe(true);
      expect(t.timedOut()).toBe(true);
      expect(ctrl.signal.aborted).toBe(false);
      const c2 = new AbortController();
      const t2 = withTimeout(c2.signal, 1000);
      c2.abort();
      expect(t2.signal.aborted).toBe(true);
      expect(t2.timedOut()).toBe(false);
      t2.clear();
    } finally {
      AbortSignal.any = any;
    }
  });
});
