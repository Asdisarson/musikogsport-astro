// Area 07 probe: shoot one order-received URL (GET only, no order is placed) and measure the receipt.
// usage: node area07-probe.mjs <base> <path-with-key> <set>
// Writes shots/<set>/thankyou-<w>-fold.png and -full.png. Local storefronts only.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [base, path, set] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base ?? '')) throw new Error(`refusing: not a local storefront (${base})`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', set);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const w of [1440, 390, 360]) {
    const p = await browser.newPage({ viewport: { width: w, height: w > 500 ? 1000 : 844 } });
    // nothing on this page may post a checkout
    await p.route('**/api/checkout', (r) => r.abort());
    const res = await p.goto(base + path, { waitUntil: 'load' });
    await p.screenshot({ path: `${OUT}/thankyou-${w}-fold.png` });
    await p.screenshot({ path: `${OUT}/thankyou-${w}-full.png`, fullPage: true });
    const m = await p.evaluate(() => {
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const total = document.querySelector('.review-table__total-row strong');
      const rows = [...document.querySelectorAll('.review-table tfoot tr')];
      const totalRow = document.querySelector('.review-table__total-row');
      const above = totalRow?.previousElementSibling?.querySelector('th');
      const th = document.querySelector('.thankyou .review-table thead th');
      const thLast = document.querySelector('.thankyou .review-table thead th:last-child');
      // widened selector proof: the same receipt table inside .account__content (view-order's wrapper)
      let account = null;
      const table = document.querySelector('.thankyou .review-table');
      if (table) {
        const wrap = document.createElement('div');
        wrap.className = 'account__content';
        wrap.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px';
        wrap.appendChild(table.cloneNode(true));
        document.body.appendChild(wrap);
        const a = wrap.querySelector('thead th');
        const aLast = wrap.querySelector('thead th:last-child');
        account = { align: cs(a).textAlign, alignLast: cs(aLast).textAlign, transform: cs(a).textTransform, border: cs(a).borderBottomWidth + ' ' + cs(a).borderBottomStyle };
        wrap.remove();
      }
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        tfoot: rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
        hasMillisamtala: rows.some((r) => /Millisamtala/.test(r.textContent)),
        total: total ? { text: total.textContent, size: cs(total).fontSize, weight: cs(total).fontWeight } : null,
        ruleAboveTotal: above ? cs(above).borderBottomColor + ' ' + cs(above).borderBottomWidth : null,
        thead: th ? { align: cs(th).textAlign, alignLast: cs(thLast).textAlign, transform: cs(th).textTransform } : null,
        accountThead: account,
        statusPill: document.querySelector('.thankyou__status') ? cs(document.querySelector('.thankyou__status')).color : 'absent (bacs order)',
        good: getComputedStyle(document.documentElement).getPropertyValue('--good').trim(),
        notice: document.querySelector('.thankyou__notice')?.textContent.trim(),
      };
    });
    console.log(w, res?.status(), JSON.stringify(m));
    await p.close();
  }
} finally {
  await browser.close();
}
