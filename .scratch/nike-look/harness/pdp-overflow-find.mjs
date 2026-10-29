// Sideways overflow on product pages (GET only, local preview): page overflow plus any visible element sticking
// out past the viewport that is NOT a slide inside a horizontal scroller (gallery / related carousel).
// usage: node pdp-overflow-find.mjs <base> <w1,w2,...> <path> [<path> ...]
import { chromium } from 'playwright';

const [base, widths, ...paths] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const browser = await chromium.launch();
try {
  for (const path of paths) {
    for (const w of widths.split(',').map(Number)) {
      const mobile = w < 768;
      const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const p = await ctx.newPage();
      await p.goto(base + path, { waitUntil: 'load' });
      const r = await p.evaluate(() => {
        const inScroller = (el) => {
          for (let n = el.parentElement; n; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
          }
          return false;
        };
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const b = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          if (!b.width || s.visibility === 'hidden' || s.display === 'none' || el.closest('dialog:not([open]),[inert],[aria-hidden="true"]')) continue;
          if (b.right > innerWidth + 1 && !inScroller(el)) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(b.right)}`);
        }
        return { overflow: document.documentElement.scrollWidth - innerWidth, offenders: out.slice(0, 8) };
      });
      console.log(path, w, 'overflow', r.overflow, r.offenders.length ? r.offenders.join(' | ') : 'no offenders');
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
