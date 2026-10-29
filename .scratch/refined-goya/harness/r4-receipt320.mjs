// R4-4 at 320: column widths of the injected receipt, new markup vs the old rule (all tfoot td wrap).
import { chromium } from 'playwright';
const [base, w = '320'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: Number(w), height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(base + '/', { waitUntil: 'load' });
  for (const mode of ['new', 'old']) {
    const r = await p.evaluate((mode) => {
      const amt = (a) => (mode === 'new' ? `<span class="review-table__amount">${a}</span>` : a);
      const txt = mode === 'new' ? ' class="review-table__text"' : '';
      const host = document.createElement('div');
      host.className = 'thankyou';
      host.innerHTML = `<section class="thankyou__details"><table class="review-table"><thead><tr><th>Vara</th><th>Samtals</th></tr></thead>
        <tbody><tr><td>HOKA Restore TC Unisex <strong class="review-table__qty">× 1</strong></td><td>25.990 kr.</td></tr></tbody>
        <tfoot>
          <tr><th>Millisamtala:</th><td>${amt('125.990 kr.')}</td></tr>
          <tr><th>Vörusendingar:</th><td${txt}>${amt('15.990 kr.')} Heimsending með Póstinum á höfuðborgarsvæðinu</td></tr>
          <tr><th>Greiðslumáti:</th><td${txt}>Millifæra inn á bankareikning</td></tr>
          <tr class="review-table__total-row"><th>Samtals:</th><td><strong>129.381 kr.</strong></td></tr>
        </tfoot></table></section>`;
      if (mode === 'old') { const s = document.createElement('style'); s.id = 'old'; s.textContent = '.thankyou .review-table tfoot td{white-space:normal}'; document.head.append(s); }
      document.body.prepend(host);
      const ths = [...host.querySelectorAll('tfoot th')].map((e) => Math.round(e.getBoundingClientRect().width));
      const tds = [...host.querySelectorAll('tfoot td')].map((e) => Math.round(e.getBoundingClientRect().width));
      const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
      const res = { table: Math.round(host.querySelector('table').getBoundingClientRect().width), content: host.clientWidth - 30, thCol: ths[0], tdCol: tds[0], amountLines: [...host.querySelectorAll('tfoot td')].map(lines), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      host.remove(); document.getElementById('old')?.remove();
      return res;
    }, mode);
    console.log(w, mode, JSON.stringify(r));
  }
} finally {
  await browser.close();
}
