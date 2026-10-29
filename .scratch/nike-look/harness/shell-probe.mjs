// Shell probe (local storefront only): element shots of the footer (desktop, phone closed, phone with one group
// open), the utility bar + header, the drawer's sub-panel, and the sticky header after a scroll; console errors.
// usage: node shell-probe.mjs [base]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area00');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];
try {
  for (const w of [1440, 390, 360]) {
    const phone = w < 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: phone ? 844 : 900 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${w} ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${w} ${e}`));
    await page.goto(BASE + '/hafa-samband/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.site-footer').screenshot({ path: join(OUT, `footer-${w}.png`) });
    const groups = await page.evaluate(() => [...document.querySelectorAll('[data-footer-group]')].map((d) => d.open));
    console.log(`${w} footer groups open:`, JSON.stringify(groups));
    if (phone) {
      await page.locator('.site-footer__title', { hasText: 'Hjálp' }).click();
      await page.waitForTimeout(300);
      await page.locator('.site-footer').screenshot({ path: join(OUT, `footer-${w}-open.png`) });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `top-${w}.png`), clip: { x: 0, y: 0, width: w, height: 140 } });
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300);
    const stuck = await page.evaluate(() => Math.round(document.querySelector('.site-header').getBoundingClientRect().top));
    console.log(`${w} header top after scroll: ${stuck}`);
    if (w < 1200) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('[data-menu-open]').filter({ visible: true }).first().click();
      await page.waitForTimeout(600);
      await page.locator('.side-menu [data-panel-open]').filter({ hasText: 'Börn' }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `drawer-sub-${w}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      console.log(`${w} drawer after Escape:`, await page.evaluate(() => document.querySelector('[data-side-menu]').dataset.open));
    }
    await ctx.close();
  }
  console.log('console errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
}
