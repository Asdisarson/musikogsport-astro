// Console errors and page errors per page and width (local storefront only). The cart and checkout get one
// HOKA variation in a LOCAL Store API cart (no order is placed), emptied afterwards.
// usage: node console-check.mjs [base]
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const PATHS = ['/', '/voruflokkur/skor/', '/hafa-samband/', '/oskalisti/', '/min-sida/', '/karfa/', '/gera-upp/'];

const browser = await chromium.launch();
let total = 0;
try {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 768, hasTouch: w < 768 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(BASE + '/karfa/', { waitUntil: 'load' });
    await page.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
    for (const p of PATHS) {
      errors.length = 0;
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      total += errors.length;
      console.log(`${w} ${p}: ${errors.length ? JSON.stringify(errors) : 'no console errors'}`);
    }
    await page.evaluate(async () => {
      const cart = await (await fetch('/api/cart')).json();
      for (const item of cart.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: item.key }) });
    });
    await ctx.close();
  }
  console.log('total console errors:', total);
} finally {
  await browser.close();
}
