// Measures the rendered width of product-card images (wall grid, home tiles, PDP related tiles, wishlist) across
// widths, rail shown and hidden, and checks the `sizes` the page ships against them: the browser's resolved slot
// (found with a throw-away <img> whose srcset has one candidate per CSS pixel, so the chosen candidate IS the slot
// width) must be >= every measured width, and not wildly over. Local storefront only.
// usage: node sizes-measure.mjs [base] [--widths 1920,1440,...]
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const WIDTHS = arg('widths', '2560,1920,1800,1799,1600,1440,1400,1399,1300,1200,1199,1100,992,991,768,767,390,360,320').split(',').map(Number);
const PDP = '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/';
const WISHLIST = [264820, 263898, 263663, 263713, 264470, 264603, 209042].map((id) => ({ id, slug: 's' + id, path: '/', name: 'p' + id, image: '' }));

const browser = await chromium.launch();
const round = (x) => Math.round(x * 10) / 10;
const range = (xs) => {
  const u = [...new Set(xs.map(round))].sort((a, b) => a - b);
  return u.length === 0 ? 'none' : u.length === 1 ? `${u[0]}` : `${u[0]}-${u[u.length - 1]}`;
};

/** Widths of the matching images, and the `sizes` attribute they ship. */
const measure = (page, selector) =>
  page.evaluate((sel) => {
    const imgs = [...document.querySelectorAll(sel)];
    return { widths: imgs.map((i) => i.getBoundingClientRect().width), sizes: imgs.map((i) => i.getAttribute('sizes')).find(Boolean) ?? null };
  }, selector);

/** The slot width (CSS px) the browser resolves `sizes` to at this viewport. */
const resolve = (page, sizes) =>
  page.evaluate(async (s) => {
    const img = new Image();
    img.sizes = s;
    img.srcset = Array.from({ length: 1200 }, (_, k) => `/__sz/${k + 1} ${k + 1}w`).join(',');
    for (let t = 0; t < 40 && !img.currentSrc; t++) await new Promise((r) => setTimeout(r, 25));
    return Number(img.currentSrc.split('/__sz/')[1]) || null;
  }, sizes);

let bad = 0;
const report = (label, m, slot) => {
  const max = Math.max(...m.widths);
  const status = slot === null ? 'NO-SIZES' : slot + 0.5 < max ? 'UNDER' : slot > max * 1.25 + 1 ? 'over25%' : 'ok';
  if (status === 'UNDER' || status === 'NO-SIZES') bad++;
  return `${label}: ${range(m.widths)}px, slot ${slot ?? '-'}px ${status}`;
};

for (const w of WIDTHS) {
  const mobile = w < 768;
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await ctx.route('**/__sz/**', (r) => r.abort());
  const page = await ctx.newPage();
  const out = [];
  for (const st of w >= 992 ? ['rail', 'hidden'] : ['-']) {
    await page.goto(BASE + '/voruflokkur/skor/', { waitUntil: 'load' });
    await page.evaluate((hide) => { try { if (hide) localStorage.setItem('mos-filters-hidden', '1'); else localStorage.removeItem('mos-filters-hidden'); } catch {} }, st === 'hidden');
    await page.reload({ waitUntil: 'load' });
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.archive .product-grid')).gridTemplateColumns.split(' ').length);
    const m = await measure(page, '.archive .product-grid .product-card__media img');
    out.push(report(`wall ${st} (${cols} col)`, m, m.sizes ? await resolve(page, m.sizes) : null));
  }
  for (const [label, path, sel] of [
    ['home tiles', '/', '.product-card--tile .product-card__media img'],
    ['pdp related', PDP, '.pdp-related .product-card--tile .product-card__media img'],
  ]) {
    await page.goto(BASE + path, { waitUntil: 'load' });
    const m = await measure(page, sel);
    out.push(report(label, m, m.sizes ? await resolve(page, m.sizes) : null));
  }
  await ctx.addInitScript((list) => { try { localStorage.setItem('mos-wishlist', JSON.stringify(list)); } catch {} }, WISHLIST);
  await page.goto(BASE + '/oskalisti/', { waitUntil: 'load' });
  await page.waitForSelector('.product-card img', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const wl = await measure(page, '.product-card__media img');
  out.push(report('wishlist', wl, wl.sizes ? await resolve(page, wl.sizes) : null));
  console.log(`\n[${w}]\n  ` + out.join('\n  '));
  await ctx.close();
}
await browser.close();
console.log(bad ? `\nFAIL: ${bad} UNDER/NO-SIZES` : '\nall slots cover the measured widths');
process.exit(bad ? 1 : 0);
