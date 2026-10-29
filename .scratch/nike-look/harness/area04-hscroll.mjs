// Area 04 sideways-overflow sweep (local storefront only; no order is ever placed).
// usage: node area04-hscroll.mjs [base]
// Per width: one HOKA variation in a LOCAL Store API cart → /karfa/, /gera-upp/, the side cart open on /; then the
// cart is emptied → /karfa/ (empty + tiles); then the signed-out account, content and error pages.
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const WIDTHS = [1920, 1440, 1400, 1280, 1200, 1199, 1100, 1024, 992, 991, 768, 576, 390, 360, 320];
const PLAIN = ['/min-sida/', '/min-sida/lost-password/', '/hafa-samband/', '/skilmalar/', '/opnunartimi/', '/staerdir/', '/um-okkur/', '/personuvernd/', '/oskalisti/', '/ekki-til-xyz/'];
const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

const browser = await chromium.launch();
let bad = 0;
let checks = 0;
const report = (w, what, o) => { checks++; if (o !== 0) { bad++; console.log(`OVERFLOW ${w} ${what} ${o}`); } };
try {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 768, hasTouch: w < 768 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/karfa/', { waitUntil: 'load' });
    await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
    await p.goto(BASE + '/karfa/', { waitUntil: 'load' });
    await p.locator('.cart-line').first().waitFor({ timeout: 30000 });
    // open the discount <details> too, so its field and button count
    await p.locator('.cart-totals__coupon > summary').click();
    report(w, '/karfa/ (item, coupon open)', await over(p));
    await p.goto(BASE + '/gera-upp/', { waitUntil: 'load' });
    await p.locator('#billing_first_name').waitFor({ timeout: 30000 });
    await p.locator('.checkout-coupon__toggle button').click();
    report(w, '/gera-upp/ (coupon open)', await over(p));
    await p.goto(BASE + '/', { waitUntil: 'load' });
    const opener = p.locator('button[aria-label^="Opna körfu"]').filter({ visible: true }).first();
    await opener.click();
    await p.locator('.side-cart').waitFor({ timeout: 15000 });
    await p.waitForTimeout(450);
    const panel = await p.evaluate(() => { const r = document.querySelector('.side-cart').getBoundingClientRect(); return Math.round(r.right - innerWidth); });
    report(w, 'side cart (panel right edge vs viewport)', panel);
    await p.evaluate(async () => {
      const cart = await (await fetch('/api/cart')).json();
      for (const item of cart.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: item.key }) });
    });
    await p.goto(BASE + '/karfa/', { waitUntil: 'load' });
    await p.locator('.cart-empty').waitFor({ timeout: 30000 });
    report(w, '/karfa/ (empty + tiles)', await over(p));
    for (const path of PLAIN) {
      await p.goto(BASE + path, { waitUntil: 'load' });
      report(w, path, await over(p));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`checks ${checks}, overflowing ${bad}`);
