// Area 2 fix probe: sticky sidebar scrolling, hidden category link focus, title focus ring clipping.
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: Number(process.argv[3] ?? 1440), height: 900 } });
  await page.goto(`${BASE}/verslun/`, { waitUntil: 'load', timeout: 120000 });
  const side = await page.evaluate(() => {
    const aside = document.querySelector('.archive-filters');
    const lists = [...document.querySelectorAll('.archive-filters .filter-group__list')];
    const nested = lists.filter((l) => l.scrollHeight > l.clientHeight + 1 && getComputedStyle(l).overflowY !== 'visible').length;
    aside.scrollTop = aside.scrollHeight;
    const last = [...aside.querySelectorAll('.filter-group__title')].pop();
    const a = aside.getBoundingClientRect();
    const r = last.getBoundingClientRect();
    return { scroll: `${aside.scrollHeight}/${aside.clientHeight}`, nestedScrollers: nested, lastGroup: last.textContent.trim(), lastGroupVisibleAfterScroll: r.top >= a.top && r.bottom <= a.bottom };
  });
  console.log('sidebar', JSON.stringify(side));

  await page.goto(`${BASE}/?s=hoka&post_type=product`, { waitUntil: 'load', timeout: 120000 });
  const cats = await page.evaluate(() => {
    for (const span of document.querySelectorAll('.product-card__cats')) {
      const links = [...span.querySelectorAll('a')];
      const hidden = links.find((l) => l.getBoundingClientRect().right > span.getBoundingClientRect().right + 1);
      if (hidden) {
        hidden.focus();
        return { found: true, scrollLeftAfterFocus: span.scrollLeft, overflow: getComputedStyle(span).overflowX };
      }
    }
    return { found: false };
  });
  console.log('hidden category link', JSON.stringify(cats));

  const title = await page.evaluate(() => {
    const h3 = document.querySelector('.product-card__title');
    const a = h3.querySelector('a');
    return { h3Overflow: getComputedStyle(h3).overflow, linkClamp: getComputedStyle(a).webkitLineClamp, linkOverflow: getComputedStyle(a).overflow };
  });
  console.log('title', JSON.stringify(title));
} finally {
  await browser.close();
}
