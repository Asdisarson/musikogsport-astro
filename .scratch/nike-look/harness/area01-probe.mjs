// Area 01 (home) probe, local storefront only: geometry vs the nike spec, white-on-image contrast measured on the
// real pixels, carousel arrow keyboard behaviour, h1 count and console errors.
// usage: node area01-probe.mjs [base] [widths]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const WIDTHS = (process.argv[3] ?? '1440,390,360').split(',').map(Number);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area01');
mkdirSync(OUT, { recursive: true });

const r = (n) => Math.round(n * 10) / 10;
const browser = await chromium.launch();
const pixelPage = await browser.newPage();
await pixelPage.setContent('<canvas id="c"></canvas>');

// Lightest 5% of a screenshot (relative luminance) → contrast of white text over it.
async function whiteContrast(png) {
  const url = `data:image/png;base64,${png.toString('base64')}`;
  return pixelPage.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const ls = [];
    for (let i = 0; i < d.length; i += 4) ls.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
    ls.sort((a, b) => a - b);
    const p95 = ls[Math.floor(ls.length * 0.95)];
    const max = ls[ls.length - 1];
    return { p95: Math.round((1.05 / (p95 + 0.05)) * 100) / 100, worst: Math.round((1.05 / (max + 0.05)) * 100) / 100 };
  }, url);
}

try {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext(w >= 768 ? { viewport: { width: w, height: 900 } } : { viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // load every lazy image
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 600) { await page.evaluate((t) => window.scrollTo(0, t), y); await page.waitForTimeout(60); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const geo = await page.evaluate(() => {
      const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, w: b.width, h: b.height, bottom: b.bottom + scrollY, right: b.right }; };
      const hero = document.querySelector('.hero');
      const hr = hero && rect(hero);
      const title = document.querySelector('.hero__title');
      const text = document.querySelector('.hero__text');
      const cta = document.querySelector('.hero__cta');
      const copy = document.querySelector('.hero__copy');
      const rows = [...document.querySelectorAll('.product-row--home')].map((row) => {
        const items = [...row.querySelectorAll('.product-row__item')];
        const a = items[0] && rect(items[0]);
        const b = items[1] && rect(items[1]);
        const btns = [...row.querySelectorAll('.round-btn')].map((x) => rect(x));
        const t = row.querySelector('.product-row__title');
        const track = row.querySelector('.product-row__track');
        const visible = items.filter((it) => { const q = it.getBoundingClientRect(); return q.left < innerWidth && q.right > 0; }).length;
        return { title: t.textContent, titleFz: getComputedStyle(t).fontSize, tile: a && { x: a.x, w: a.w }, gap: a && b ? b.x - a.right : null, arrows: btns.map((x) => `${x.w}x${x.h}@${Math.round(x.right)}`), visible, scrollW: track.scrollWidth, clientW: track.clientWidth };
      });
      const kids = [...document.querySelector('.home').children].filter((k) => !['SCRIPT', 'STYLE'].includes(k.tagName));
      const gaps = kids.slice(1).map((k, i) => Math.round(k.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom));
      const stories = [...document.querySelectorAll('.story')].map((s) => { const q = s.getBoundingClientRect(); return `${Math.round(q.width)}x${Math.round(q.height)}`; });
      const ctaR = cta && cta.getBoundingClientRect();
      return {
        hero: hr && { top: hr.y, h: hr.h, w: hr.w, kind: hero.className },
        titleFz: title && getComputedStyle(title).fontSize,
        titleW: title && Math.round(title.getBoundingClientRect().width),
        textFz: text && getComputedStyle(text).fontSize,
        copyLeft: copy && Math.round(copy.getBoundingClientRect().left),
        copyFromBottom: copy && hr && Math.round(hr.bottom - (copy.getBoundingClientRect().bottom + scrollY)),
        cta: ctaR && `${Math.round(ctaR.width)}x${Math.round(ctaR.height)}`,
        h1: [...document.querySelectorAll('h1')].map((x) => x.textContent.trim()),
        rows, gaps, stories,
        off: [...document.querySelectorAll('.product-card__off')].map((x) => `${x.textContent} ${getComputedStyle(x).color}`).slice(0, 3),
        badgeOnTiles: document.querySelectorAll('.product-card--tile .badge--sale').length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    console.log(`\n== ${w} ==`);
    console.log(JSON.stringify(geo, null, 1));

    // contrast: hide the white text (keep the gradient), screenshot each text box, read the lightest pixels
    await page.addStyleTag({ content: '.hero__title,.hero__text,.story__title{color:transparent!important;text-shadow:none!important}' });
    const targets = await page.evaluate(() => [...document.querySelectorAll('.hero--banner .hero__title, .hero--banner .hero__text, .story:not(.story--plain) .story__title')].map((el) => {
      const b = el.getBoundingClientRect();
      return { name: `${el.className} "${el.textContent.trim().slice(0, 24)}"`, x: b.x, y: b.y + scrollY, w: b.width, h: b.height, large: parseFloat(getComputedStyle(el).fontSize) >= 24 };
    }));
    for (const t of targets) {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 200)), t.y);
      await page.waitForTimeout(150);
      const sy = await page.evaluate(() => scrollY);
      const png = await page.screenshot({ clip: { x: Math.max(0, t.x), y: t.y - sy, width: Math.min(t.w, w - t.x), height: t.h } });
      const c = await whiteContrast(png);
      const need = t.large ? 3 : 4.5;
      console.log(`contrast ${w} ${t.name}: lightest-5% ${c.p95}:1, lightest pixel ${c.worst}:1 (needs ${need}) ${c.p95 >= need ? 'PASS' : 'FAIL'}`);
    }
    await page.reload({ waitUntil: 'load' });

    // keyboard: Tab to the first row's "next" arrow, press Enter until the end; focus must stay on it
    const next = page.locator('.product-row--home [data-carousel-step="1"]').first();
    const prev = page.locator('.product-row--home [data-carousel-step="-1"]').first();
    const track = page.locator('.product-row--home [data-carousel-track]').first();
    await next.focus();
    const steps = [];
    for (let i = 0; i < 15 && (await next.getAttribute('aria-disabled')) !== 'true'; i++) {
      const before = await track.evaluate((t) => t.scrollLeft);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
      steps.push(Math.round((await track.evaluate((t) => t.scrollLeft)) - before));
    }
    const kb = {
      steps,
      endDisabled: await next.getAttribute('aria-disabled'),
      prevDisabled: await prev.getAttribute('aria-disabled'),
      focusKept: await next.evaluate((n) => document.activeElement === n),
    };
    console.log('keyboard', JSON.stringify(kb));
    if (w === 1440) {
      await page.evaluate(() => document.querySelector('.product-row--home [data-carousel-track]').scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.locator('.product-row--home').first().screenshot({ path: join(OUT, `row-${w}.png`) });
    }
    console.log('console errors', errors.length ? JSON.stringify(errors) : 0);
    await ctx.close();
  }
} finally {
  await browser.close();
}
