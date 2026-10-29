// Area 07: a paid Pósturinn shipping row in the receipt table, injected into a GET page (no order is placed).
// usage: node area07-shiprow.mjs <base> <set>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, set = 'area07'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base ?? '')) throw new Error('refusing: not local');
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', set);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const w of [360, 390, 1440]) {
    const p = await browser.newPage({ viewport: { width: w, height: 844 } });
    await p.goto(base + '/min-sida/', { waitUntil: 'load' });
    const m = await p.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      main.innerHTML = `<div class="thankyou"><section class="thankyou__details"><h2>Pöntunarupplýsingar</h2>
        <table class="review-table"><thead><tr><th>Vara</th><th>Samtals</th></tr></thead>
        <tbody><tr><td>HOKA Restore TC Unisex - 40 <strong class="review-table__qty">× 1</strong></td><td>12.495 kr.</td></tr></tbody>
        <tfoot><tr><th>Millisamtala:</th><td>12.495 kr.</td></tr>
        <tr><th>Vörusendingar:</th><td id="ship">1.200 kr. Pósturinn – Afhent á pósthúsi Kópavogi</td></tr>
        <tr><th>Greiðslumáti:</th><td>Millifæra inn á bankareikning</td></tr>
        <tr class="review-table__total-row"><th>Samtals:</th><td><strong>13.695 kr.</strong></td></tr></tfoot></table></section></div>`;
      const td = document.getElementById('ship');
      const text = td.firstChild;
      const r = document.createRange();
      const i = text.data.indexOf('kr.');
      r.setStart(text, 0);
      r.setEnd(text, i + 3);
      const tops = [...r.getClientRects()].map((x) => Math.round(x.top));
      return { overflow: document.documentElement.scrollWidth - innerWidth, amountOneLine: new Set(tops).size === 1, tops };
    });
    await p.screenshot({ path: `${OUT}/shiprow-${w}.png`, fullPage: true });
    console.log(w, JSON.stringify(m));
    await p.close();
  }
} finally {
  await browser.close();
}
