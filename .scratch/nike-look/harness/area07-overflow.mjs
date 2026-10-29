// Which elements stick out past the viewport on a GET-only page: node area07-overflow.mjs <base> <path> <w>
import { chromium } from 'playwright';

const [base, path, width = '360'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base ?? '')) throw new Error('refusing: not local');
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: Number(width), height: 844 } });
  await p.goto(base + path, { waitUntil: 'load' });
  console.log(JSON.stringify(await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)} "${(el.textContent || '').trim().slice(0, 40)}"`);
    }
    return { overflow: document.documentElement.scrollWidth - innerWidth, wide: out.slice(0, 15) };
  }), null, 1));
} finally {
  await browser.close();
}
