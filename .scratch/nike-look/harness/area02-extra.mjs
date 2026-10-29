// Area 02 extra checks (local only, no cart writes): home tile height and hover swap, the rail's last row vs the
// fixed store notice, controls above the full-card title overlay (wishlist heart, a simple product's
// "Setja í körfu"), and the phone header row (h1 + sort). usage: node area02-extra.mjs [base]
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area02');
const browser = await chromium.launch();
const hitTest = (sel) => (el) => {
  const b = el.getBoundingClientRect();
  const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  return hit === el || el.contains(hit) ? 'own' : `covered by ${hit?.tagName}.${hit?.className}`;
};
try {
  // home tiles: caption height (title + categories + price, no reserved action line) and the hover swap
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const tile = page.locator('.product-row--home .product-card').first();
    await tile.scrollIntoViewIfNeeded();
    const m = await tile.evaluate((c) => ({ card: Math.round(c.getBoundingClientRect().height), media: Math.round(c.querySelector('.product-card__media').getBoundingClientRect().height), caption: Math.round(c.querySelector('.product-card__caption').getBoundingClientRect().height), after: Math.round(c.querySelector('.product-card__after').getBoundingClientRect().height) }));
    await tile.hover();
    await page.waitForTimeout(350);
    const h = await tile.evaluate((c) => ({ price: getComputedStyle(c.querySelector('.product-card__price')).opacity, action: getComputedStyle(c.querySelector('.product-card__action')).opacity, text: c.querySelector('.product-card__action').textContent.trim() }));
    console.log(`home tile 1440: card ${m.card} = image ${m.media} + caption ${m.caption} (price block ${m.after}); hover: price opacity ${h.price}, action ${h.action} "${h.text}"`);
    const row = page.locator('.product-row--home').first();
    await row.screenshot({ path: join(OUT, 'extra-home-row-1440.png') });
    await page.close();
  }
  // the rail's end vs the store notice (/verslun/ has the longest rail)
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/verslun/', { waitUntil: 'load' });
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const rail = document.querySelector('.archive-filters');
      rail.scrollTop = rail.scrollHeight;
      const rb = rail.getBoundingClientRect();
      const notice = document.querySelector('.store-notice');
      const nb = notice && getComputedStyle(notice).display !== 'none' ? notice.getBoundingClientRect() : null;
      const links = [...rail.querySelectorAll('a, summary')].filter((a) => a.getBoundingClientRect().height > 0);
      const last = links[links.length - 1].getBoundingClientRect();
      const lastEl = links[links.length - 1];
      return { railBottom: Math.round(rb.bottom), noticeTop: nb ? Math.round(nb.top) : 'none', lastRowBottom: Math.round(last.bottom), lastText: lastEl.textContent.trim().slice(0, 30), scroll: `${Math.round(rail.scrollTop)}/${rail.scrollHeight - rail.clientHeight}` };
    });
    console.log(`rail end /verslun/ 1440: rail bottom ${r.railBottom}, notice top ${r.noticeTop}, last row bottom ${r.lastRowBottom} ("${r.lastText}"), rail scrolled ${r.scroll}`);
    await page.screenshot({ path: join(OUT, 'extra-rail-end-1440.png') });
    await page.close();
  }
  // controls above the overlay
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/verslun/', { waitUntil: 'load' });
    const add = page.locator('.archive [data-card-add]').first();
    if (await add.count()) {
      const card = page.locator('.archive .product-card:has([data-card-add])');
      await card.first().scrollIntoViewIfNeeded();
      await card.first().hover();
      await page.waitForTimeout(350);
      console.log(`simple product "Setja í körfu" under the pointer: ${await add.evaluate(hitTest())}`);
    } else console.log('no simple in-stock product on /verslun/ page 1');
    await page.evaluate(() => localStorage.setItem('mos-wishlist', JSON.stringify([{ id: 209042, slug: 'hoka-restore-tc-unisex', path: '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/', name: 'HOKA Restore TC unisex', image: '' }])));
    await page.goto(BASE + '/oskalisti/', { waitUntil: 'load' });
    await page.waitForSelector('.wish-btn');
    console.log(`wishlist heart under the pointer: ${await page.locator('.wish-btn').first().evaluate(hitTest())}; size ${await page.locator('.wish-btn').first().evaluate((b) => `${b.offsetWidth}x${b.offsetHeight}`)}`);
    await page.evaluate(() => localStorage.removeItem('mos-wishlist'));
    await page.close();
  }
  // phone header row
  for (const [w, path] of [[390, '/voruflokkur/skor/'], [360, '/?s=hoka&post_type=product'], [320, '/voruflokkur/skor/']]) {
    const page = await browser.newPage({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(BASE + path, { waitUntil: 'load' });
    const g = await page.evaluate(() => {
      const rect = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`; };
      return { h1: rect('.archive__title'), sort: rect('.archive__sort select') };
    });
    console.log(`phone header ${w} ${path}: h1 ${g.h1}; sort ${g.sort}`);
    await page.locator('.archive__head').screenshot({ path: join(OUT, `extra-head-${w}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
