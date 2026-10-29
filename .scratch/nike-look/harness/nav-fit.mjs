// Header fit probe (local storefront only): at each width, the logo / nav / right-cluster boxes, any overlap
// between them, sideways overflow, and the header + utility bar heights.
// usage: node nav-fit.mjs [base] [widths]
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const WIDTHS = (process.argv[3] ?? '1920,1440,1366,1280,1200,1100,1024,992,991,768,390,360').split(',').map(Number);

const browser = await chromium.launch();
try {
  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el || getComputedStyle(el).display === 'none') return null;
        const b = el.getBoundingClientRect();
        return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const items = [...document.querySelectorAll('.main-nav__list > li > .nav-item__link')].map((a) => a.getBoundingClientRect());
      const navText = items.length ? { l: Math.round(items[0].left), r: Math.round(items[items.length - 1].right) } : null;
      return {
        logo: box('.site-header__logo'), nav: box('.main-nav'), navText, right: box('.site-header__right'),
        header: box('.site-header'), utility: box('.utility'),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        navFont: document.querySelector('.nav-item__link') ? getComputedStyle(document.querySelector('.nav-item__link')).fontFamily.split(',')[0] : null,
      };
    });
    const clash = [];
    if (r.navText && r.logo && r.navText.l < r.logo.r) clash.push(`nav<logo by ${r.logo.r - r.navText.l}`);
    if (r.navText && r.right && r.navText.r > r.right.l) clash.push(`nav>right by ${r.navText.r - r.right.l}`);
    console.log(`${w}: logo ${JSON.stringify(r.logo)} navText ${JSON.stringify(r.navText)} right ${JSON.stringify(r.right)} header h${r.header?.h} utility h${r.utility?.h} overflowX ${r.overflowX} font ${r.navFont} ${clash.length ? 'CLASH ' + clash.join(', ') : 'ok'}`);
    await page.close();
  }
} finally {
  await browser.close();
}
