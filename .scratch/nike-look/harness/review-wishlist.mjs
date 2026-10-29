// N-3 wishlist: saved items render with the API's srcset (a small candidate). Local preview, browser storage only.
// usage: node review-wishlist.mjs <base>
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:4323'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const browser = await chromium.launch();
const errors = [];
try {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      localStorage.setItem('mos-wishlist', JSON.stringify([264820, 263898, 263663].map((id) => ({ id, slug: `x${id}`, name: `Vara ${id}`, image: '' }))));
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await p.goto(base + '/oskalisti/', { waitUntil: 'load' });
    await p.locator('.product-grid--wish img[srcset]').first().waitFor({ timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => [...document.querySelectorAll('.product-grid--wish img')].map((im) => ({ rendered: Math.round(im.getBoundingClientRect().width), srcset: im.hasAttribute('srcset'), current: im.currentSrc.split('/').pop().slice(-34) })));
    console.log(`N-3 wishlist ${w} ${JSON.stringify(r)}`);
    await ctx.close();
  }
  console.log('errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
}
