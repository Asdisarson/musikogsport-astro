// Area 03: keyboard focus inside the sticky rail is never hidden (WCAG 2.4.11) — Tab from the last gallery image
// into the rail, walk every rail stop, and Shift+Tab back from "Setja í körfu". Local preview only.
// usage: node area03-focus.mjs <base>
import { chromium } from 'playwright';

const [base] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const PATHS = ['/verslun/skor/strigaskor-skor-2/nike-gamma-force-low/', '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/'];
const browser = await chromium.launch();
let hidden = 0;
try {
  for (const h of [900, 800]) {
    for (const path of PATHS) {
      const p = await browser.newPage({ viewport: { width: 1440, height: h } });
      await p.goto(base + path, { waitUntil: 'load' });
      await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const where = () =>
        p.evaluate(() => {
          const el = document.activeElement;
          const b = el.getBoundingClientRect();
          const notice = document.querySelector('.store-notice');
          const bottom = innerHeight - (notice && getComputedStyle(notice).display !== 'none' ? notice.offsetHeight : 0);
          const header = document.querySelector('[data-header]')?.getBoundingClientRect().bottom ?? 60;
          return { el: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}:${(el.textContent || '').trim().slice(0, 14)}`, top: Math.round(b.top), bottom: Math.round(b.bottom), ok: b.top >= header - 1 && b.bottom <= bottom + 1, inRail: !!el.closest('.pdp-rail') };
        });
      await p.locator('.pdp-gallery__item a').last().focus();
      await p.waitForTimeout(200);
      const steps = [];
      for (let i = 0; i < 22; i++) {
        await p.keyboard.press('Tab');
        await p.waitForTimeout(120);
        const w = await where();
        if (!w.inRail) break;
        steps.push(w);
      }
      await p.locator('.pdp-atc').evaluate((b) => (b.disabled ? null : b));
      // Shift+Tab back from the wishlist pill (the ATC is disabled until a size is chosen)
      await p.locator('.pdp-wish').focus();
      await p.waitForTimeout(150);
      const back = [];
      for (let i = 0; i < 16; i++) {
        await p.keyboard.press('Shift+Tab');
        await p.waitForTimeout(120);
        const w = await where();
        if (!w.inRail) break;
        back.push(w);
      }
      // a wheel scroll puts a shifted rail back on its resting top
      await p.evaluate(() => scrollTo(0, 2400));
      await p.waitForTimeout(200);
      const restingTop = await p.evaluate(() => document.querySelector('.pdp-rail').style.getPropertyValue('--rail-top'));
      await p.locator('.pdp-swatch:not(:disabled)').first().focus();
      await p.waitForTimeout(200);
      const shiftedTop = await p.evaluate(() => document.querySelector('.pdp-rail').style.getPropertyValue('--rail-top'));
      console.log(`  resting ${restingTop}; first size focused while stuck → ${shiftedTop}; ${JSON.stringify(await where())}`);
      await p.mouse.move(700, 400);
      await p.mouse.wheel(0, 120);
      await p.waitForTimeout(300);
      const restTop = await p.evaluate(() => document.querySelector('.pdp-rail').style.getPropertyValue('--rail-top'));
      console.log(`  rail top while focused ${shiftedTop}, after a wheel ${restTop}`);
      const bad = [...steps, ...back].filter((s) => !s.ok);
      hidden += bad.length;
      console.log(`1440x${h} ${path.split('/').at(-2)}: tab ${steps.length} stops, shift-tab ${back.length}; hidden ${bad.length}`, bad.length ? JSON.stringify(bad.slice(0, 4)) : '');
      await p.close();
    }
  }
  console.log('hidden focus total:', hidden);
} finally {
  await browser.close();
}
