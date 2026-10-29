// Area 01: the product-slide hero fallback, shot through a TEMPORARY ?__product switch in index.astro
// (removed again before the final build). usage: node area01-product-hero.mjs [base]
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area01');
const browser = await chromium.launch();
try {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext(w >= 768 ? { viewport: { width: w, height: 900 } } : { viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/?__product', { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '.store-notice{display:none!important}' });
    const hero = page.locator('.hero');
    await hero.screenshot({ path: join(OUT, `product-hero-${w}-a.png`) });
    const info = await page.evaluate(() => ({
      kind: document.querySelector('.hero')?.className,
      slides: document.querySelectorAll('[data-hero-slide]').length,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent),
      arrows: [...document.querySelectorAll('[data-hero-step]')].map((b) => { const r = b.getBoundingClientRect(); return `${r.width}x${r.height}`; }),
    }));
    await page.locator('[data-hero-step="1"]').click();
    await page.waitForTimeout(500);
    const active = await page.evaluate(() => [...document.querySelectorAll('[data-hero-slide]')].findIndex((s) => s.dataset.active === 'true'));
    await hero.screenshot({ path: join(OUT, `product-hero-${w}-b.png`) });
    console.log(w, JSON.stringify(info), 'active after next:', active, 'errors:', errors.length);
    await ctx.close();
  }
} finally {
  await browser.close();
}
