// Area 01 close-ups (local only): the first tile row and the first story row at 1440 and 390, store notice hidden.
// usage: node area01-crops.mjs [base] [suffix]
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const SUFFIX = process.argv[3] ?? '';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area01');
const browser = await chromium.launch();
try {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext(w >= 768 ? { viewport: { width: w, height: 900 } } : { viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '.store-notice,[data-to-top]{display:none!important}' });
    for (const [name, sel] of [['row', '.product-row--home'], ['story', '.story-row'], ['hero', '.hero']]) {
      const el = page.locator(sel).nth(name === 'row' ? 1 : 0);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await el.screenshot({ path: join(OUT, `crop-${name}-${w}${SUFFIX}.png`) });
    }
    // keyboard focus on the hero CTA (Tab from the top of the page)
    await page.evaluate(() => window.scrollTo(0, 0));
    // (desktop tabs through the whole mega-menu first; after one keyboard Tab a scripted focus still counts as
    // keyboard focus for :focus-visible)
    await page.keyboard.press('Tab');
    await page.locator('.hero__cta').focus();
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${document.activeElement.className}: ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} offset ${s.outlineOffset}`; });
    console.log(w, 'focus', ring);
    await page.locator('.hero__copy').screenshot({ path: join(OUT, `focus-cta-${w}.png`) });
    await ctx.close();
  }
} finally {
  await browser.close();
}
