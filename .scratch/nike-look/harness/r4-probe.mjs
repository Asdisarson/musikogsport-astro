// R4 probe (GET + one swatch click, no add to cart): swatch label containment (real + injected long labels),
// add-to-cart line count, page sideways overflow, and the receipt tfoot via an injected .thankyou table.
// usage: node r4-probe.mjs <base>
import { chromium } from 'playwright';

const [base] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const HOKA = '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/';
const LONG = ['Ein stærð', '122/128 cm', 'Barnastærð 146/152', 'XXXL/4XL', 'One size fits all'];

const measureSwatches = (LONG) => {
  const lines = (el) => {
    const r = document.createRange(); r.selectNodeContents(el);
    return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
  };
  const out = [];
  for (const b of document.querySelectorAll('.pdp-swatch')) {
    const r = document.createRange(); r.selectNodeContents(b);
    const t = r.getBoundingClientRect(); const c = b.getBoundingClientRect();
    const inside = t.left >= c.left - 0.5 && t.right <= c.right + 0.5 && t.top >= c.top - 0.5 && t.bottom <= c.bottom + 0.5;
    out.push({ label: b.textContent, inside, lines: lines(b), w: Math.round(c.width), h: Math.round(c.height), top: Math.round(c.top), checked: b.getAttribute('aria-checked') === 'true', color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor });
  }
  // rows must stay uniform: every button in a grid row has the same height
  const rows = {};
  for (const s of out) (rows[s.top] ??= new Set()).add(s.h);
  return { n: out.length, overflowing: out.filter((s) => !s.inside).map((s) => s.label), uneven: Object.values(rows).filter((h) => h.size > 1).length, sample: out.filter((s) => LONG.includes(s.label) || s.checked).map((s) => `${s.label}${s.checked ? '[checked ' + s.color + ' on ' + s.bg + ']' : ''}:${s.w}x${s.h}/${s.lines}L`) };
};

const browser = await chromium.launch();
try {
  for (const w of [1440, 1200, 390, 360, 320]) {
    const mobile = w < 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(base + HOKA, { waitUntil: 'load' });
    await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const real = await p.evaluate(measureSwatches, LONG);
    const pre = await p.evaluate(() => {
      const atc = document.querySelector('.pdp-atc');
      const r = document.createRange(); r.selectNodeContents(atc);
      const lines = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
      const de = document.documentElement;
      return {
        atc: `${lines} line(s), btn ${Math.round(atc.getBoundingClientRect().width)}px, text ${Math.round(r.getBoundingClientRect().width)}px, padL ${getComputedStyle(atc).paddingLeft}, overflow ${atc.scrollWidth > atc.clientWidth}`,
        hint: document.querySelector('.pdp-hint')?.textContent ?? null,
        sideways: de.scrollWidth - de.clientWidth,
      };
    });
    // choose the first in-stock size, then inject long labels into the chosen one and the next ones (no clicks after)
    await p.locator('.pdp-swatch:not(:disabled)').first().click();
    await p.waitForTimeout(250);
    const injected = await p.evaluate((LONG) => {
      const all = [...document.querySelectorAll('.pdp-swatch')];
      const start = Math.max(0, all.findIndex((b) => b.getAttribute('aria-checked') === 'true'));
      LONG.forEach((t, i) => { const b = all[(start + i) % all.length]; if (b) b.textContent = t; });
      return true;
    }, LONG);
    const inj = injected && (await p.evaluate(measureSwatches, LONG));
    const sideways2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`PDP ${w}: real ${real.n} swatches, overflowing=${JSON.stringify(real.overflowing)}, unevenRows=${real.uneven}; ATC ${pre.atc}; hint=${pre.hint}; sideways=${pre.sideways}px`);
    console.log(`  injected: overflowing=${JSON.stringify(inj.overflowing)}, unevenRows=${inj.uneven}, sideways=${sideways2}px; ${inj.sample.join(' | ')}`);

    // receipt tfoot: the built CSS against the new markup (amount spans + review-table__text cells)
    if (w <= 390) {
      const rec = await p.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'thankyou';
        host.innerHTML = `<section class="thankyou__details"><table class="review-table"><thead><tr><th>Vara</th><th>Samtals</th></tr></thead>
          <tbody><tr><td>HOKA Restore TC Unisex <strong class="review-table__qty">× 1</strong></td><td>25.990 kr.</td></tr></tbody>
          <tfoot>
            <tr><th>Millisamtala:</th><td><span class="review-table__amount">125.990 kr.</span></td></tr>
            <tr><th>Afsláttur:</th><td><span class="review-table__amount">-12.599 kr.</span></td></tr>
            <tr><th>Vörusendingar:</th><td class="review-table__text"><span class="review-table__amount">15.990 kr.</span> Heimsending með Póstinum á höfuðborgarsvæðinu</td></tr>
            <tr><th>Greiðslumáti:</th><td class="review-table__text">Millifæra inn á bankareikning</td></tr>
            <tr class="review-table__total-row"><th>Samtals:</th><td><strong>129.381 kr.</strong></td></tr>
          </tfoot></table></section>`;
        document.body.prepend(host);
        const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
        const table = host.querySelector('table').getBoundingClientRect();
        const box = host.getBoundingClientRect();
        const res = {
          amounts: [...host.querySelectorAll('tfoot .review-table__amount, .review-table__total-row strong')].map((e) => `${e.textContent}:${lines(e)}L`),
          shipCell: lines(host.querySelectorAll('tfoot td')[2]),
          bacsCell: lines(host.querySelectorAll('tfoot td')[3]),
          tableFits: table.right <= box.right + 0.5 && table.left >= box.left - 0.5,
          tableW: Math.round(table.width), boxW: Math.round(box.width),
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
        host.remove();
        return res;
      });
      console.log(`  receipt ${w}: ${JSON.stringify(rec)}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
