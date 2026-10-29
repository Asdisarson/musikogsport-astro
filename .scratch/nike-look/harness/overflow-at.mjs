// Which elements stick out past the viewport for any path and width (local storefront only).
// usage: node overflow-at.mjs <base> <path> <width>
import { chromium } from 'playwright';

const [base, path = '/', width = '320'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error(`refusing: not local (${base})`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
  await page.goto(base + path, { waitUntil: 'load' });
  const out = await page.evaluate(() => {
    const vw = innerWidth;
    const sel = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const rows = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 0.5 && !el.closest('[inert],[aria-hidden="true"]')) rows.push(`${sel(el)} right=${Math.round(r.right)} w=${Math.round(r.width)} text=${(el.textContent || '').trim().slice(0, 40)}`);
    }
    return { scroll: document.documentElement.scrollWidth - vw, rows: rows.slice(0, 15) };
  });
  console.log('overflow', out.scroll);
  out.rows.forEach((r) => console.log(' ', r));
} finally {
  await browser.close();
}
