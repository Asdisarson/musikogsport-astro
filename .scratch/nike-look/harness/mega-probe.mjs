// Mega-menu probe (local storefront only): hover shots of a grouped and a flat panel, panel geometry, the
// keyboard path (Tab into the panel, Escape closes it and returns focus), console errors.
// usage: node mega-probe.mjs [base] [width]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const W = Number(process.argv[3] ?? 1440);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area00');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const panelInfo = () => page.evaluate(() => {
    const open = [...document.querySelectorAll('.mega')].filter((m) => getComputedStyle(m).visibility === 'visible');
    return open.map((m) => {
      const b = m.getBoundingClientRect();
      const cols = [...m.querySelectorAll(':scope .mega__col')].map((c) => Math.round(c.getBoundingClientRect().left));
      return { top: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width), colLefts: cols.slice(0, 8), owner: m.parentElement.querySelector('.nav-item__link').textContent.trim() };
    });
  });

  for (const name of ['Konur', 'Börn', 'Fatnaður', 'Vörumerki', 'Verslun']) {
    await page.mouse.move(5, 500);
    await page.waitForTimeout(500);
    await page.locator('.main-nav__list > li > .nav-item__link', { hasText: new RegExp(`^${name}$`) }).hover();
    await page.waitForTimeout(700);
    console.log(`hover ${name}:`, JSON.stringify(await panelInfo()));
    if (['Konur', 'Fatnaður', 'Börn'].includes(name)) await page.screenshot({ path: join(OUT, `mega-${name.normalize('NFD').replace(/[^\w]/g, '')}-${W}.png`) });
  }

  // fast sweep: from Fatnaður's open panel to Konur, then down into Konur's first column while Fatnaður's panel
  // is still fading out; Konur's panel must be the one open
  await page.locator('.main-nav__list > li > .nav-item__link', { hasText: /^Fatnaður$/ }).hover();
  await page.waitForTimeout(600);
  await page.locator('.main-nav__list > li > .nav-item__link', { hasText: /^Konur$/ }).hover();
  await page.waitForTimeout(120);
  const konurCol = await page.locator('.main-nav__list > li', { hasText: 'Konur' }).first().locator('.mega__col').first().boundingBox();
  await page.mouse.move(konurCol.x + 20, konurCol.y + 40, { steps: 4 });
  await page.waitForTimeout(600);
  console.log('fast sweep Fatnaður → Konur panel:', JSON.stringify((await panelInfo()).map((p) => p.owner)));

  // keyboard: focus Konur, Tab into its panel, Escape
  await page.mouse.move(5, 800);
  await page.waitForTimeout(500);
  await page.locator('.main-nav__list > li > .nav-item__link', { hasText: /^Konur$/ }).focus();
  await page.waitForTimeout(100);
  console.log('focus Konur → open:', JSON.stringify((await panelInfo()).map((p) => p.owner)));
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), inPanel: !!document.activeElement?.closest('.mega') }));
  console.log('Tab →', JSON.stringify(focused));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => document.activeElement?.textContent?.trim());
  console.log('Escape → open:', JSON.stringify((await panelInfo()).map((p) => p.owner)), 'focus:', after);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  console.log('Tab after Escape → focus:', await page.evaluate(() => document.activeElement?.textContent?.trim()), 'open:', JSON.stringify((await panelInfo()).map((p) => p.owner)));
  console.log('console errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
}
