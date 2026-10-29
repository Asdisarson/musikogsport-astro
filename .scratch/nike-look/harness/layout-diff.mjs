// Dumps every element's rect + a few computed styles on a set of pages for two local storefronts and reports the
// differences, to prove a CSS-only cleanup changed nothing visible. usage: node layout-diff.mjs <baseA> <baseB> [widths]
import { chromium } from 'playwright';

const [A, B] = [process.argv[2], process.argv[3]].map((u) => (u ?? '').replace(/\/$/, ''));
for (const u of [A, B]) if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u)) throw new Error(`refusing: not local (${u})`);
const WIDTHS = (process.argv[4] ?? '1440,1100,390').split(',').map(Number);
const PDP = '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/';
const PAGES = [
  ['home', '/'],
  ['wall', '/voruflokkur/skor/'],
  ['wall-hidden', '/voruflokkur/skor/', { hideRail: true }],
  ['search', '/?s=hoka&post_type=product'],
  ['pdp', PDP],
  ['wishlist', '/oskalisti/', { wishlist: true }],
  ['cart-empty', '/karfa/'],
  ['notfound', '/ekki-til-xyz/'],
  ['about', '/um-okkur/'],
  ['contact', '/hafa-samband/'],
  ['account', '/min-sida/'],
];
const WISHLIST = [264820, 263898, 263663, 263713, 264470, 264603, 209042].map((id) => ({ id, slug: 's' + id, path: '/', name: 'p' + id, image: '' }));
const PROPS = ['display', 'position', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'fontFamily', 'padding', 'margin', 'gap', 'flexWrap', 'gridTemplateColumns', 'gridAutoColumns', 'borderTopWidth', 'opacity', 'visibility', 'order'];

const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const browser = await chromium.launch();

async function dump(base, w, [name, path, opts = {}]) {
  const mobile = w < 768;
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  if (opts.wishlist) await ctx.addInitScript((l) => { try { localStorage.setItem('mos-wishlist', JSON.stringify(l)); } catch {} }, WISHLIST);
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: 'load' });
  if (opts.hideRail) {
    await page.evaluate(() => localStorage.setItem('mos-filters-hidden', '1'));
    await page.reload({ waitUntil: 'load' });
  }
  if (opts.wishlist) { await page.waitForSelector('.product-card img', { timeout: 8000 }).catch(() => {}); }
  if (name === 'pdp') await page.addStyleTag({ content: '.pdp-related{display:none!important}' }); /* random per server */
  await page.waitForTimeout(500);
  const rows = await page.evaluate((props) => {
    const out = [];
    document.querySelectorAll('body *').forEach((el, i) => {
      if (['SCRIPT', 'STYLE', 'ASTRO-ISLAND', 'ASTRO-SLOT'].includes(el.tagName) || el.closest('.pdp-related')) return; /* related products are random per load */
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const label = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.')}`;
      out.push(`${out.length} ${label} [${Math.round(b.x * 10) / 10},${Math.round(b.y * 10) / 10},${Math.round(b.width * 10) / 10},${Math.round(b.height * 10) / 10}] ` + props.map((p) => cs[p]).join('|'));
    });
    return out;
  }, PROPS);
  await ctx.close();
  return rows;
}

let diffs = 0;
for (const w of WIDTHS) {
  for (const p of PAGES) {
    if (ONLY && !ONLY.has(p[0])) continue;
    const [a, b] = [await dump(A, w, p), await dump(B, w, p)];
    const n = Math.max(a.length, b.length);
    const d = [];
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) d.push(`   - ${a[i] ?? '(none)'}\n   + ${b[i] ?? '(none)'}`);
    console.log(`${w} ${p[0]}: ${a.length} elements vs ${b.length}, ${d.length} differ`);
    if (d.length) { diffs += d.length; console.log(d.slice(0, 6).join('\n')); }
  }
}
await browser.close();
console.log(diffs ? `\nDIFFERENCES: ${diffs}` : '\nidentical layout and computed styles');
process.exit(diffs ? 1 : 0);
