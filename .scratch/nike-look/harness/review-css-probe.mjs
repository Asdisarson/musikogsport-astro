// Review fixes N-7..N-11: thumbs max-height with the store notice, focus-ring room in the chips row and tile tracks
// (with shots), the phone account label, mega headings without a target, footer columns. Local preview only.
// usage: node review-css-probe.mjs <base>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base = 'http://127.0.0.1:4323'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'review-fixes');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  // N-7
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 800 } });
    await p.goto(base + '/verslun/skor/strigaskor-skor-2/nike-gamma-force-low/', { waitUntil: 'load' });
    const r = await p.evaluate(() => {
      const t = document.querySelector('.pdp-thumbs');
      const n = document.querySelector('.store-notice');
      const shown = n && getComputedStyle(n).display !== 'none';
      return { notice: shown ? Math.round(n.getBoundingClientRect().height) : 0, maxHeight: getComputedStyle(t).maxHeight, thumbsBottomAtTop: Math.round(t.getBoundingClientRect().top + t.clientHeight), noticeTop: shown ? Math.round(n.getBoundingClientRect().top) : innerHeight };
    });
    await p.evaluate(() => scrollTo(0, 600));
    await p.waitForTimeout(300);
    const sticky = await p.evaluate(() => {
      const t = document.querySelector('.pdp-thumbs').getBoundingClientRect();
      const n = document.querySelector('.store-notice');
      return { thumbsBottom: Math.round(t.bottom), noticeTop: n && getComputedStyle(n).display !== 'none' ? Math.round(n.getBoundingClientRect().top) : innerHeight };
    });
    console.log(`N-7 1440x800 ${JSON.stringify(r)} scrolled ${JSON.stringify(sticky)} clear=${sticky.thumbsBottom <= sticky.noticeTop}`);
    await p.close();
  }
  // N-8 tiles: focus a tile title link, check the ring isn't clipped by the track
  for (const w of [1440, 390]) {
    const p = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(base + '/', { waitUntil: 'load' });
    const link = p.locator('.product-row__track .product-card__title a').first();
    await link.scrollIntoViewIfNeeded();
    await p.keyboard.press('Tab'); // make the page keyboard-modal so focus-visible applies
    await link.focus();
    const r = await p.evaluate(() => {
      const a = document.activeElement;
      const track = a.closest('.product-row__track');
      const ar = a.getBoundingClientRect();
      const tr = track.getBoundingClientRect();
      const cs = getComputedStyle(track);
      const ring = parseFloat(getComputedStyle(a).outlineWidth) + parseFloat(getComputedStyle(a).outlineOffset);
      return { ring, trackPad: cs.paddingTop, trackMargin: cs.marginTop, roomTop: Math.round(ar.top - tr.top), roomBottom: Math.round(tr.bottom - ar.bottom), snap: cs.scrollSnapType };
    });
    const box = await link.boundingBox();
    await p.screenshot({ path: join(OUT, `tile-focus-${w}.png`), clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 520), width: Math.min(w, 520), height: 600 } });
    const head = await p.evaluate(() => {
      const h = document.querySelector('.product-row__head').getBoundingClientRect();
      const t = document.querySelector('.product-row__track li').getBoundingClientRect();
      return { headBottomToFirstTile: Math.round(t.top - h.bottom) };
    });
    console.log(`N-8 tiles ${w} ${JSON.stringify(r)} ${JSON.stringify(head)}`);
    await p.close();
  }
  // N-8 chips (phones)
  {
    const p = await browser.newPage({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
    await p.goto(base + '/voruflokkur/skor/', { waitUntil: 'load' });
    const has = await p.locator('.archive__chips a').count();
    if (has) {
      await p.keyboard.press('Tab');
      await p.locator('.archive__chips a').first().focus();
      const r = await p.evaluate(() => {
        const a = document.activeElement;
        const ul = a.closest('ul');
        const ar = a.getBoundingClientRect();
        const ur = ul.getBoundingClientRect();
        return { roomTop: Math.round(ar.top - ur.top), roomBottom: Math.round(ur.bottom - ar.bottom), chipsRowH: Math.round(document.querySelector('.archive__chips').getBoundingClientRect().height) };
      });
      const b = await p.locator('.archive__chips').boundingBox();
      await p.screenshot({ path: join(OUT, 'chips-focus-390.png'), clip: { x: 0, y: Math.max(0, b.y - 20), width: 390, height: b.height + 40 } });
      console.log(`N-8 chips 390 ${JSON.stringify(r)}`);
    } else console.log('N-8 chips: none on this page');
    await p.close();
  }
  // N-9, N-10, N-11
  {
    const p = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await p.goto(base + '/', { waitUntil: 'load' });
    const acct = await p.evaluate(() => { const a = document.querySelector('.site-header__account'); return { ariaLabel: a.getAttribute('aria-label'), label: a.querySelector('[data-login-label]')?.textContent, rect: [Math.round(a.getBoundingClientRect().width), Math.round(a.getBoundingClientRect().height)] }; });
    await p.context().addCookies([{ name: 'mos_li', value: '1', url: base }]);
    await p.reload({ waitUntil: 'load' });
    const signed = await p.evaluate(() => document.querySelector('.site-header__account [data-login-label]')?.textContent);
    const name = await p.locator('.site-header__account').evaluate((a) => a.textContent.trim());
    await p.context().clearCookies();
    console.log(`N-9 signed out ${JSON.stringify(acct)} | signed-in label ${JSON.stringify(signed)} (accessible text ${JSON.stringify(name)})`);
    const heads = await p.evaluate(() => [...document.querySelectorAll('.mega__head')].map((h) => `${h.tagName}:${h.getAttribute('href') ?? '-'}:${h.textContent.trim()}`));
    const dead = heads.filter((h) => /^A:(\/|#):/.test(h));
    console.log(`N-10 mega heads ${heads.length}, spans ${heads.filter((h) => h.startsWith('SPAN')).length} ${JSON.stringify(heads.filter((h) => h.startsWith('SPAN')))}, links to / or #: ${dead.length}`);
    const footer = await p.evaluate(() => [...document.querySelectorAll('.site-footer a')].filter((a) => a.textContent.trim() === 'Persónuvernd').length);
    console.log(`N-11 footer Persónuvernd links: ${footer}; notice dismiss present: ${await p.locator('.store-notice [data-dismiss]').count()}`);
    if (await p.locator('.store-notice [data-dismiss]').count()) {
      await p.locator('.store-notice [data-dismiss]').click();
      const stored = await p.evaluate(() => ({ off: document.documentElement.dataset.noticeOff ?? null, ls: localStorage.getItem('mos-dismissed'), shown: getComputedStyle(document.querySelector('.store-notice')).display }));
      await p.reload({ waitUntil: 'load' });
      const after = await p.evaluate(() => getComputedStyle(document.querySelector('.store-notice')).display);
      console.log(`N-11 notice dismiss ${JSON.stringify(stored)} after reload display=${after}`);
    }
    await p.close();
  }
} finally {
  await browser.close();
}
