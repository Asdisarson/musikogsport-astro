// Which elements stick out past the viewport on /karfa/ at a given width (cart with one line).
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4323';
const w = Number(process.argv[2] ?? 992);
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: w, height: 900 } });
  await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
  await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
  await p.reload({ waitUntil: 'load' });
  await p.locator('.cart-line').waitFor();
  console.log(JSON.stringify(await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
    }
    const row = document.querySelector('.cart-page__row');
    return { cols: getComputedStyle(row).gridTemplateColumns, rowW: Math.round(row.getBoundingClientRect().width), line: getComputedStyle(document.querySelector('.cart-line')).gridTemplateColumns, wide: out.slice(0, 12) };
  }), null, 1));
  await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });
} finally {
  await browser.close();
}
