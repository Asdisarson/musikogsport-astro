// /verify drive: real interactions on the production preview, with screenshots as evidence.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4323';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const browser = await chromium.launch();
const phoneCtx = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
try {
  // 1. Phone campaign bar: layout, unbreakable hours, 44px close, dismiss persists across reload
  {
    const ctx = await phoneCtx();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    const bar = await p.evaluate(() => {
      const c = document.querySelector('.campaign');
      const close = document.querySelector('.campaign__close').getBoundingClientRect();
      return { height: Math.round(c.getBoundingClientRect().height), nowrap: [...c.querySelectorAll('.nowrap')].map((s) => s.textContent), close: `${Math.round(close.width)}x${Math.round(close.height)}` };
    });
    log('1 campaign', JSON.stringify(bar));
    await p.screenshot({ path: `${OUT}/1-campaign-390.png`, clip: { x: 0, y: 0, width: 390, height: 160 } });
    await p.locator('.campaign__close').tap();
    const hidden1 = await p.locator('.campaign').isHidden();
    await p.reload({ waitUntil: 'load' });
    log('1 dismiss: hidden after tap', hidden1, '| hidden after reload', await p.locator('.campaign').isHidden());
    await ctx.close();
  }
  // 2. Desktop home carousel: arrows hidden at rest, appear on hover, next scrolls and reveals prev
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    const row = p.locator('.product-row:not(.product-row--related)').first();
    await row.scrollIntoViewIfNeeded();
    const next = row.locator('.product-row__arrow--next');
    const op = () => next.evaluate((b) => getComputedStyle(b).opacity);
    const rest = await op();
    await row.hover(); await p.waitForTimeout(350);
    const hov = await op();
    const track = row.locator('.product-row__track');
    const before = await track.evaluate((t) => t.scrollLeft);
    await next.click(); await p.waitForTimeout(800);
    const after = await track.evaluate((t) => t.scrollLeft);
    const prevShown = await row.locator('.product-row__arrow--prev').evaluate((b) => getComputedStyle(b).display !== 'none' && !b.disabled);
    log('2 carousel: opacity rest', rest, 'hover', hov, '| scrollLeft', before, '->', after, '| prev enabled', prevShown, '| page overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    await p.screenshot({ path: `${OUT}/2-carousel-hover-1440.png`, clip: await row.boundingBox() });
    await p.close();
  }
  // 3. Phone category: 2-up grid, open Sía, apply a Kyn filter, Endursetja appears, Load More appends
  {
    const ctx = await phoneCtx();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/voruflokkur/skor/`, { waitUntil: 'load' });
    const cols = await p.evaluate(() => getComputedStyle(document.querySelector('[data-archive-grid] .product-grid')).gridTemplateColumns.split(' ').length);
    const resetBefore = await p.locator('.archive-filters__reset').count();
    await p.locator('[data-filters-open]').tap(); await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/3a-filters-panel-390.png` });
    const group = p.locator('.filter-group').first();
    if (!(await group.evaluate((d) => d.open))) await group.locator('summary').tap();
    const opt = group.locator('.filter-option__link').first();
    const optH = Math.round((await opt.boundingBox()).height);
    const label = (await opt.textContent()).trim();
    await Promise.all([p.waitForURL((u) => u.search.includes('kyn='), { timeout: 30000 }), opt.tap()]); await p.waitForLoadState('load');
    const url = p.url();
    const resetAfter = await p.locator('.archive-filters__reset').count();
    log('3 archive phone: columns', cols, '| reset before', resetBefore, '| option row height', optH, '| tapped', JSON.stringify(label), '->', url.replace(BASE, ''), '| reset after', resetAfter);
    await p.screenshot({ path: `${OUT}/3b-filtered-390.png` });
    await ctx.close();
  }
  // 4. Search: real query and a garbage/HTML query
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(`${BASE}/?s=hoka&post_type=product`, { waitUntil: 'load' });
    const t = await p.locator('h1').first().textContent();
    const titles = await p.locator('.product-card__title a').evaluateAll((as) => as.slice(0, 4).map((a) => a.textContent));
    log('4 search title', JSON.stringify(t.trim()), '| first titles', JSON.stringify(titles));
    await p.goto(`${BASE}/?s=${encodeURIComponent('<b>zz</b>"')}&post_type=product`, { waitUntil: 'load' });
    log('4 garbage search h1', JSON.stringify((await p.locator('h1').first().textContent()).trim()), '| bold tags rendered', await p.locator('h1 b').count(), '| empty text', JSON.stringify((await p.locator('.empty, .archive .empty').first().textContent().catch(() => '')).trim()));
    // keyboard: tab into the first card title, ring not clipped
    await p.goto(`${BASE}/voruflokkur/skor/`, { waitUntil: 'load' });
    await p.locator('.product-card__title a').first().focus();
    await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
    const ring = await p.evaluate(() => { const a = document.activeElement; return { tag: a.className || a.tagName, outline: getComputedStyle(a).outlineStyle, h3overflow: getComputedStyle(a.parentElement).overflow }; });
    log('4 keyboard focus on card title', JSON.stringify(ring));
    const box = await p.locator('.product-card').first().boundingBox();
    await p.screenshot({ path: `${OUT}/4-title-focus-1440.png`, clip: { x: box.x - 10, y: box.y + box.height - 160, width: box.width + 20, height: 170 } });
    await p.close();
  }
  // 5. Cart -> checkout: add an item, Millisamtala, field edges and focus ring, Icelandic labels, 20px controls
  {
    const ctx = await phoneCtx();
    const p = await ctx.newPage();
    await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
    await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
    const cart = await p.evaluate(() => ({
      rows: [...document.querySelectorAll('.cart-totals th')].map((t) => t.textContent.trim()),
      back: document.querySelector('a[href="/verslun/"]')?.textContent.trim(),
      couponBorder: getComputedStyle(document.querySelector('.coupon__form input') ?? document.body).borderTopColor,
    }));
    log('5 cart', JSON.stringify(cart));
    await p.screenshot({ path: `${OUT}/5a-cart-390.png`, fullPage: true });
    await p.goto(`${BASE}/gera-upp/`, { waitUntil: 'load' }); await p.waitForTimeout(1500);
    const first = p.locator('.checkout-fields .input-text').first();
    await first.focus();
    const co = await p.evaluate(() => {
      const f = document.activeElement; const s = getComputedStyle(f);
      const box = document.querySelector('.checkout input[type=checkbox]');
      return {
        focusBorder: s.borderTopColor, focusShadow: s.boxShadow,
        labels: [...document.querySelectorAll('.checkout-fields label')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /Land|Íbúð|valfrjálst/.test(t)).slice(0, 4),
        back: [...document.querySelectorAll('a')].find((a) => /Til baka/.test(a.textContent))?.textContent.trim(),
        checkbox: box ? `${box.getBoundingClientRect().width}x${box.getBoundingClientRect().height}` : null,
        subtotal: [...document.querySelectorAll('.review-table th')].map((t) => t.textContent.trim()).filter((t) => /samtala|Samtals/i.test(t)),
      };
    });
    log('5 checkout', JSON.stringify(co));
    await p.screenshot({ path: `${OUT}/5b-checkout-focus-390.png` });
    // clean up the local cart
    await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });
    await ctx.close();
  }
  // 6. Search overlay: focus shows on the underline, no box around the input
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.locator('[data-search-open]').click(); await p.waitForTimeout(600);
    await p.keyboard.type('nike');
    const ov = await p.evaluate(() => { const i = document.activeElement; return { field: i.type, shadow: getComputedStyle(i).boxShadow, underline: getComputedStyle(i.closest('form')).borderBottomColor }; });
    log('6 search overlay', JSON.stringify(ov));
    await p.screenshot({ path: `${OUT}/6-search-overlay-1440.png`, clip: { x: 300, y: 60, width: 840, height: 160 } });
    await p.keyboard.press('Enter'); await p.waitForLoadState('load');
    log('6 overlay submit ->', p.url().replace(BASE, ''));
    await p.close();
  }
} finally {
  await browser.close();
}
