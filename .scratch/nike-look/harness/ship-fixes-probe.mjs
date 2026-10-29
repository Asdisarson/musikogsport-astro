// /ship code-review fixes, checked on the production preview. No order is placed; the cart is emptied at the end.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4323';
const browser = await chromium.launch();
const addItem = (p, quantity = 1) => p.evaluate(async (q) => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: q }) }), quantity);
const emptyCart = (p) => p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
  await addItem(p, 2);
  // #1 the + button is reachable at the squeezed desktop widths
  for (const w of [992, 1024, 1100, 1199, 1440]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
    await p.locator('.cart-line').waitFor();
    const r = await p.evaluate(() => {
      const b = document.querySelector('.cart-line .line-qty button[aria-label="Fjölga"]').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const q = document.querySelector('.cart-line .line-qty').getBoundingClientRect();
      const sub = document.querySelector('.cart-line__subtotal').getBoundingClientRect();
      return { plusHit: hit?.closest('button')?.getAttribute('aria-label') ?? hit?.className, gapToSubtotal: Math.round(sub.left - q.right), overflow: document.documentElement.scrollWidth - innerWidth };
    });
    console.log(`#1 cart ${w}:`, JSON.stringify(r));
  }
  // #5 DOM order: totals/checkout before the coupon field
  const order = await p.evaluate(() => {
    const all = [...document.querySelectorAll('a, button, input, select')];
    return { checkout: all.indexOf(document.querySelector('.cart-totals__checkout')), coupon: all.indexOf(document.querySelector('.coupon__form input')) };
  });
  console.log('#5 focus order (lower first):', JSON.stringify(order));
  // #4 disabled outline button
  const dis = await p.evaluate(() => { const b = document.querySelector('.coupon__apply'); b.disabled = true; const s = getComputedStyle(b); const out = { opacity: s.opacity, cursor: s.cursor }; b.disabled = false; return out; });
  console.log('#4 coupon disabled:', JSON.stringify(dis));
  // #8 shipping label headers
  console.log('#8 shipping th:', JSON.stringify(await p.evaluate(() => { const th = document.querySelector('.cart-totals__shipping-head th'); return th ? { scope: th.scope, id: th.id, headers: document.querySelector('.cart-totals__shipping td')?.getAttribute('headers') } : null; })));

  // #3 checkout grand total rule
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${BASE}/gera-upp/`, { waitUntil: 'load' });
  await p.locator('.review-table__total-row').waitFor();
  const tot = await p.evaluate(() => {
    const th = document.querySelector('.review-table__total-row th'); const s = getComputedStyle(th);
    const prev = document.querySelector('.review-table__total-row').previousElementSibling.firstElementChild;
    const head = document.querySelector('.review-table__shipping-head th');
    return { totalPadTop: s.paddingTop, totalWeight: s.fontWeight, rowAboveBorder: getComputedStyle(prev).borderBottomColor, shipHeadPadBottom: head ? getComputedStyle(head).paddingBottom : null };
  });
  console.log('#3 checkout total:', JSON.stringify(tot));
  // #11 invalid field cue
  await p.locator('.checkout-terms input').check();
  await p.locator('.checkout__place').click();
  await p.waitForTimeout(800);
  console.log('#11 invalid:', JSON.stringify(await p.evaluate(() => { const r = document.querySelector('.form-row.is-invalid'); if (!r) return null; const i = getComputedStyle(r.querySelector('.input-text')); return { border: i.borderTopColor, shadow: i.boxShadow, label: getComputedStyle(r.querySelector('label')).color }; })));

  // phone: #14 thumbnail span, #5 visual order
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
  await addItem(m); // a new page is a new context: its own (empty) cart
  await m.reload({ waitUntil: 'load' });
  await m.locator('.cart-line').waitFor();
  console.log('#14/#5 cart 390:', JSON.stringify(await m.evaluate(() => ({
    thumbRow: getComputedStyle(document.querySelector('.cart-line__thumb')).gridRow,
    tops: ['.cart-lines', '.cart-totals', '.cart-totals__coupon'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }))));
  await emptyCart(m);

  // #13 phone filter label room
  await m.goto(`${BASE}/voruflokkur/skor/`, { waitUntil: 'load' });
  console.log('#13 filter link padding-right 390:', await m.evaluate(() => getComputedStyle(document.querySelector('.archive-filters .filter-option__link')).paddingRight));
  // #7 long single-word page title
  for (const w of [360, 375]) {
    await m.setViewportSize({ width: w, height: 800 });
    await m.goto(`${BASE}/personuvernd/`, { waitUntil: 'load' });
    console.log(`#7 personuvernd ${w}:`, JSON.stringify(await m.evaluate(() => { const h = document.querySelector('.page-head h1').getBoundingClientRect(); return { right: Math.round(h.right), vw: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth }; })));
  }

  // #6 focused category link reveals its line; #9 sidebar ring room; #12 campaign padding
  await p.goto(`${BASE}/voruflokkur/skor/`, { waitUntil: 'load' });
  await p.locator('.product-card__cats a').first().focus();
  console.log('#6 cats focus-within:', JSON.stringify(await p.evaluate(() => { const c = document.activeElement.closest('.product-card__cats'); const s = getComputedStyle(c); return { overflow: s.overflowX, whiteSpace: s.whiteSpace }; })));
  console.log('#9 sidebar padding:', await p.evaluate(() => getComputedStyle(document.querySelector('.archive-filters')).paddingLeft));
  await p.setViewportSize({ width: 992, height: 800 });
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  console.log('#12 campaign 992 padding-right:', await p.evaluate(() => getComputedStyle(document.querySelector('.campaign')).paddingRight));
  // #15 brand title
  await p.goto(`${BASE}/brand/didriksons/`, { waitUntil: 'load' });
  console.log('#15 brand title:', await p.title());
  await emptyCart(p);
} finally {
  await browser.close();
}
