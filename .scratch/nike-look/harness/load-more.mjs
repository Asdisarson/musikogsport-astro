// Load More on a category page: card count before/after the click, grid columns, horizontal overflow.
// usage: node load-more.mjs [base]
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
const browser = await chromium.launch();
try {
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    await page.goto(`${BASE}/voruflokkur/skor/`, { waitUntil: 'load', timeout: 120000 });
    const count = () => page.locator('[data-archive-grid] .product-grid > li').count();
    const before = await count();
    await page.locator('[data-load-more]').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-archive-grid] .product-grid > li').length > n, before, { timeout: 60000 });
    const after = await count();
    const info = await page.evaluate(() => ({
      cols: getComputedStyle(document.querySelector('[data-archive-grid] .product-grid')).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      status: document.querySelector('[role=status]')?.textContent?.trim(),
      moreLeft: Boolean(document.querySelector('[data-load-more]')),
      dupes: (() => { const hrefs = [...document.querySelectorAll('[data-archive-grid] .product-card__title a')].map((a) => a.getAttribute('href')); return hrefs.length - new Set(hrefs).size; })(),
    }));
    console.log(`${w}: cards ${before} -> ${after}, columns ${info.cols}, overflow ${info.overflow}, duplicates ${info.dupes}, more button ${info.moreLeft}, status "${info.status}"`);
    await page.close();
  }
} finally {
  await browser.close();
}
