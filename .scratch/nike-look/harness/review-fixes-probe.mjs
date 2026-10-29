// Review fixes (N-1, N-3, N-4, N-5): lightbox natural width, card srcset candidates, Escape-then-Tab in the mega
// panel, size-grid Down over a sold-out size, console errors. Local preview only. No cart writes.
// usage: node review-fixes-probe.mjs <base>
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:4323'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const PDPS = ['/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/', '/verslun/skor/strigaskor-skor-2/nike-gamma-force-low/'];
const browser = await chromium.launch();
const errors = [];
const watch = (p, tag) => {
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${tag}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
};
try {
  // N-1: the lightbox shows the full-size src
  for (const path of PDPS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    watch(p, `pdp ${path}`);
    await p.goto(base + path, { waitUntil: 'load' });
    const n = await p.locator('[data-lightbox]').count();
    const i = n > 1 ? 1 : 0;
    await p.locator(`[data-gallery-item="${i}"]`).scrollIntoViewIfNeeded();
    await p.waitForFunction((k) => document.querySelectorAll('.pdp-gallery__track img')[k].complete, i, { timeout: 15000 }).catch(() => {});
    const tile = await p.evaluate((k) => {
      const im = document.querySelectorAll('.pdp-gallery__track img')[k];
      return { currentSrc: im.currentSrc.split('/').pop(), natural: im.naturalWidth };
    }, i);
    await p.locator(`[data-lightbox="${i}"]`).click();
    await p.waitForFunction(() => { const b = document.querySelector('[data-lightbox-img]'); return b.complete && b.naturalWidth > 0; }, null, { timeout: 20000 }).catch(() => {});
    const big = await p.evaluate(() => { const b = document.querySelector('[data-lightbox-img]'); return { src: b.src.split('/').pop(), natural: b.naturalWidth }; });
    const thumbs = await p.evaluate(() => [...document.querySelectorAll('.pdp-thumb img')].slice(0, 3).map((t) => ({ srcset: t.hasAttribute('srcset'), src: t.currentSrc.split('/').pop() })));
    console.log(`N-1 ${path} images=${n} image#${i + 1} tile=${JSON.stringify(tile)} lightbox=${JSON.stringify(big)} | N-13 thumbs=${JSON.stringify(thumbs)}`);
    await p.keyboard.press('Escape');
    await ctx.close();
  }

  // N-3: card image candidates on the wall and the home tiles (fresh context per width: no cached larger candidate)
  for (const [path, sel] of [['/voruflokkur/skor/', '.archive .product-card__media img'], ['/', '.product-row__track .product-card__media img']]) {
    for (const w of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      watch(p, `cards ${path} ${w}`);
      await p.goto(base + path, { waitUntil: 'load' });
      const imgs = p.locator(sel);
      for (let k = 0; k < Math.min(4, await imgs.count()); k++) await imgs.nth(k).scrollIntoViewIfNeeded();
      await p.waitForTimeout(1500);
      const r = await p.evaluate((s) => [...document.querySelectorAll(s)].slice(0, 4).map((im) => {
        const m = im.currentSrc.match(/-(\d+)x\d+\.\w+$/);
        return { rendered: Math.round(im.getBoundingClientRect().width), candidate: m ? `${m[1]}w` : `orig:${im.currentSrc.split('/').pop().slice(-24)}`, natural: im.naturalWidth, hasSrcset: im.hasAttribute('srcset') };
      }), sel);
      console.log(`N-3 ${path} ${w} dpr=1 ${JSON.stringify(r)}`);
      await ctx.close();
    }
  }

  // N-4: Escape then an immediate Tab must not land in the closing panel; hovering back reopens it
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    watch(p, 'mega');
    await p.goto(base + '/', { waitUntil: 'load' });
    const top = p.locator('.main-nav__list > li.nav-item--parent > .nav-item__link').first();
    const name = (await top.textContent()).trim();
    await top.focus();
    await p.keyboard.press('Tab');
    const into = await p.evaluate(() => !!document.activeElement?.closest('.mega'));
    await p.keyboard.press('Escape');
    const vis = await p.evaluate(() => getComputedStyle(document.querySelector('.nav-item--parent[data-suppress] > .mega')).visibility);
    await p.keyboard.press('Tab');
    const after = await p.evaluate(() => ({ text: document.activeElement?.textContent?.trim().slice(0, 20), inPanel: !!document.activeElement?.closest('.mega') }));
    await p.mouse.move(5, 600);
    await p.waitForTimeout(200);
    await top.hover();
    await p.waitForTimeout(700);
    const reopened = await p.evaluate(() => [...document.querySelectorAll('.nav-item--parent > .mega')].some((m) => getComputedStyle(m).visibility === 'visible'));
    console.log(`N-4 ${name}: Tab into panel=${into}; after Escape panel visibility=${vis}; next Tab → ${JSON.stringify(after)}; hover reopens=${reopened}`);
    await ctx.close();
  }

  // N-5: Down arrow in the size grid with a sold-out size (a real one if present, else one disabled by evaluate)
  for (const path of PDPS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    watch(p, `grid ${path}`);
    await p.goto(base + path, { waitUntil: 'load' });
    await p.locator('.pdp-swatches:not(.pdp-swatches--images) .pdp-swatch').first().waitFor({ timeout: 15000 });
    const grid = p.locator('.pdp-swatches:not(.pdp-swatches--images)').first();
    const state = await grid.evaluate((ul) => {
      const b = [...ul.querySelectorAll('button')];
      let simulated = false;
      // want: index 0 enabled, index 2 disabled, index 4 enabled
      if (!(b[2]?.disabled && !b[0].disabled && b[4] && !b[4].disabled)) {
        b.forEach((x, i) => (x.disabled = i === 2));
        simulated = true;
      }
      return { labels: b.slice(0, 6).map((x) => `${x.textContent.trim()}${x.disabled ? '(x)' : ''}`), simulated };
    });
    const btns = grid.locator('button');
    await btns.nth(0).focus();
    await p.keyboard.press('ArrowDown');
    const fromFirst = await p.evaluate(() => document.activeElement?.textContent?.trim());
    await btns.nth(1).focus();
    await p.keyboard.press('ArrowDown');
    const fromSecond = await p.evaluate(() => document.activeElement?.textContent?.trim());
    await btns.nth(1).focus();
    await p.keyboard.press('ArrowRight');
    const rightOfSecond = await p.evaluate(() => document.activeElement?.textContent?.trim());
    console.log(`N-5 ${path} ${JSON.stringify(state)} Down from #1 → ${fromFirst}; Down from #2 → ${fromSecond}; Right from #2 → ${rightOfSecond}`);
    await ctx.close();
  }
  console.log('console errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
}
