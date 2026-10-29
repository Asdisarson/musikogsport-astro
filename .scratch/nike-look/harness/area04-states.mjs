// Area 04 expanded states (local storefront only; NO order: every /api/checkout request is aborted).
// usage: node area04-states.mjs [base]
// /karfa/: shipping calculator open → postcode 220 → rates → Póstbox rate → locker picker; coupon <details> with a
// bogus code → inline error. /gera-upp/: coupon toggle with a bogus code → inline error. HOKA PDP: size-chart popup.
// Shots to shots/area04-states/, overflow per state; the cart is emptied at the end.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area04-states');
mkdirSync(OUT, { recursive: true });
const PDP = '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/';
const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const shot = (p, name) => p.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });

const browser = await chromium.launch();
try {
  for (const w of [1440, 360]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.route('**/api/checkout', (route) => { console.log('GUARD: aborted /api/checkout'); return route.abort(); });
    await p.goto(BASE + '/karfa/', { waitUntil: 'load' });
    await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
    await p.goto(BASE + '/karfa/', { waitUntil: 'load' });
    await p.locator('.cart-line').first().waitFor({ timeout: 30000 });

    // shipping calculator → rates → Póstbox → locker picker
    await p.locator('.ship-calc__toggle').click();
    const formH = await p.evaluate(() => [...document.querySelectorAll('.ship-calc__form input')].map((i) => Math.round(i.getBoundingClientRect().height)));
    await shot(p, `cart-calc-open-${w}`);
    await p.locator('.ship-calc__form input[aria-label="Póstnúmer"]').fill('220');
    await p.locator('.ship-calc__form button[type="submit"]').click();
    await p.locator('.cart-totals .ship-methods input').first().waitFor({ timeout: 90000 });
    const rates = await p.locator('.cart-totals .ship-methods label').allTextContents();
    const rows = await p.evaluate(() => [...document.querySelectorAll('.cart-totals .ship-methods label')].map((l) => Math.round(l.getBoundingClientRect().height)));
    const box = rates.findIndex((r) => /box/i.test(r));
    let picker = null;
    if (box >= 0) {
      await p.locator('.cart-totals .ship-methods input').nth(box).click();
      await p.locator('.droppoint__select').waitFor({ timeout: 60000 });
      await p.waitForFunction(() => !document.querySelector('.droppoint__select')?.disabled || /Engin/.test(document.querySelector('.droppoint__select option')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
      picker = await p.evaluate(() => { const s = document.querySelector('.droppoint__select'); return { h: Math.round(s.getBoundingClientRect().height), options: s.options.length }; });
    }
    console.log(`${w} cart rates`, JSON.stringify(rates.map((r) => r.trim())), 'label heights', JSON.stringify(rows), 'calc inputs', JSON.stringify(formH), 'picker', JSON.stringify(picker), 'overflow', await over(p));
    await shot(p, `cart-rates-postbox-${w}`);

    // coupon <details> with a bogus code
    await p.locator('.cart-totals__coupon > summary').click();
    await p.locator('.cart-totals__coupon input[name="coupon_code"]').fill('EKKITIL-XYZ');
    await p.locator('.cart-totals__coupon .coupon__apply').click();
    const err = await p.locator('.cart-totals__coupon .coupon__error').textContent({ timeout: 30000 }).catch(() => null);
    console.log(`${w} cart coupon error: ${JSON.stringify(err)} overflow ${await over(p)}`);
    await shot(p, `cart-coupon-error-${w}`);

    // checkout: the moved coupon block
    await p.goto(BASE + '/gera-upp/', { waitUntil: 'load' });
    await p.locator('#billing_first_name').waitFor({ timeout: 30000 });
    await p.locator('.checkout-coupon__toggle button').click();
    await p.locator('.coupon--checkout input').fill('EKKITIL-XYZ');
    await p.locator('.coupon--checkout .coupon__apply').click();
    const cerr = await p.locator('.coupon--checkout .coupon__error').textContent({ timeout: 30000 }).catch(() => null);
    console.log(`${w} checkout coupon error: ${JSON.stringify(cerr)} url ${p.url().replace(BASE, '')} overflow ${await over(p)}`);
    await shot(p, `checkout-coupon-error-${w}`);

    // the size-chart popup (rules shared with .popup and .vc-text)
    await p.goto(BASE + PDP, { waitUntil: 'load' });
    const guide = p.getByText('Stærðartafla', { exact: true }).filter({ visible: true }).first();
    await guide.click();
    await p.locator('.popup[open]').waitFor({ timeout: 15000 });
    await p.waitForTimeout(2500);
    const pop = await p.evaluate(() => {
      const d = document.querySelector('.popup[open]');
      const r = d.getBoundingClientRect();
      const t = d.querySelector('table');
      return { w: Math.round(r.width), radius: getComputedStyle(d).borderRadius, scrollW: d.scrollWidth - d.clientWidth, table: t ? Math.round(t.getBoundingClientRect().width) : null, h: [...d.querySelectorAll('h1,h2,h3,h4')].map((h) => `${h.tagName}:${getComputedStyle(h).fontSize}`).slice(0, 4) };
    });
    console.log(`${w} size chart`, JSON.stringify(pop), 'page overflow', await over(p));
    await p.screenshot({ path: join(OUT, `pdp-size-chart-${w}.png`) });

    await p.evaluate(async () => {
      const cart = await (await fetch('/api/cart')).json();
      for (const item of cart.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: item.key }) });
    });
    console.log(`${w} cart emptied:`, (await (await p.request.get(BASE + '/api/cart')).json()).items_count);
    await ctx.close();
  }
} finally {
  await browser.close();
}
