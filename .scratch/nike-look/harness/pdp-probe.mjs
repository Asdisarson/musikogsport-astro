// Area 06 probe (GET + page-state clicks only; no add to cart): element shots of the PDP gallery tail, the
// description edge and the related row, plus computed values for each change.
// usage: node pdp-probe.mjs <base> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, out] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
mkdirSync(out, { recursive: true });
const HOKA = '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/';
const GALLERY = '/verslun/skor/strigaskor-skor-2/nike-gamma-force-low/';
const browser = await chromium.launch();
try {
  for (const w of [1440, 390]) {
    const mobile = w < 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    for (const [name, path] of [['hoka', HOKA], ['gallery', GALLERY]]) {
      await p.goto(base + path, { waitUntil: 'load' });
      await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const items = p.locator('.pdp-gallery__item');
      const n = await items.count();
      if (!mobile && n > 1) { await items.nth(n - 1).scrollIntoViewIfNeeded(); await p.waitForTimeout(600); await p.locator('.pdp-gallery').screenshot({ path: join(out, `${name}-${w}-gallery.png`) }); }
      const desc = p.locator('.pdp-desc');
      if (await desc.count()) { await desc.scrollIntoViewIfNeeded(); await p.screenshot({ path: join(out, `${name}-${w}-desc.png`) }); }
      const rel = p.locator('.product-row--related');
      if (await rel.count()) { await rel.scrollIntoViewIfNeeded(); await p.waitForTimeout(500); await rel.screenshot({ path: join(out, `${name}-${w}-related.png`) }); }
      const meta = p.locator('.pdp-meta');
      if (await meta.count()) await meta.screenshot({ path: join(out, `${name}-${w}-meta.png`) });
      const m = await p.evaluate(() => {
        const cs = (q) => { const el = document.querySelector(q); return el ? getComputedStyle(el) : null; };
        const last = [...document.querySelectorAll('.pdp-gallery__item')].at(-1);
        const arrows = [...document.querySelectorAll('.product-row--related .product-row__arrow')].map((a) => `${a.dataset.carouselStep}:${getComputedStyle(a).display}${a.disabled ? '(disabled)' : ''}`);
        const atc = document.querySelector('.pdp-atc');
        return {
          images: document.querySelectorAll('.pdp-gallery__item').length,
          lastSpan: last ? Math.round(last.getBoundingClientRect().width) + 'px of ' + Math.round(document.querySelector('.pdp-gallery').getBoundingClientRect().width) : null,
          imgFit: cs('.pdp-gallery__item img')?.objectFit,
          loaded: [...document.querySelectorAll('.pdp-gallery__item img')].filter((i) => i.naturalWidth && !i.src.endsWith('/placeholder.svg')).length,
          title: cs('.pdp-title')?.fontSize,
          price: `${cs('.pdp-price .price')?.fontSize}/${cs('.pdp-price .price')?.fontWeight}`,
          badge: document.querySelector('.pdp-badge')?.textContent + ' bg ' + cs('.pdp-badge')?.backgroundColor,
          swatchH: cs('.pdp-swatch')?.height,
          metaCols: cs('.pdp-meta')?.gridTemplateColumns,
          atc: { disabled: atc?.disabled, describedby: atc?.getAttribute('aria-describedby'), hint: document.getElementById(atc?.getAttribute('aria-describedby') ?? '')?.textContent, bg: atc ? getComputedStyle(atc).backgroundColor : null, opacity: atc ? getComputedStyle(atc).opacity : null },
          cartRow: (() => { const q = document.querySelector('.pdp-qty')?.getBoundingClientRect(); const a = atc?.getBoundingClientRect(); return q && a ? (Math.abs(q.top - a.top) < 2 ? 'one row' : 'stacked') : null; })(),
          descRule: cs('.pdp-desc__inner')?.borderTopWidth,
          relRule: cs('.product-row--related .product-row__title')?.borderBottomWidth,
          arrows,
          dataTip: document.querySelectorAll('[data-tip]').length,
        };
      });
      console.log(name, w, JSON.stringify(m));
      // keyboard focus on the first swatch, then pick it: focus ring + filled state + hint gone
      if (name === 'hoka') {
        const sw = p.locator('.pdp-swatch:not(:disabled)').first();
        await sw.focus();
        await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
        const ring = await sw.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
        await p.keyboard.press('Enter');
        await p.waitForTimeout(300);
        const after = await p.evaluate(() => ({ label: document.querySelector('.pdp-var__label')?.textContent, bg: getComputedStyle(document.querySelector('.pdp-swatch[aria-checked="true"]')).backgroundColor, color: getComputedStyle(document.querySelector('.pdp-swatch[aria-checked="true"]')).color, hint: document.querySelector('.pdp-hint')?.textContent ?? null, atcDisabled: document.querySelector('.pdp-atc').disabled, describedby: document.querySelector('.pdp-atc').getAttribute('aria-describedby') }));
        await p.locator('.pdp-vars').screenshot({ path: join(out, `hoka-${w}-chosen-focus.png`) });
        console.log('  focus ring', ring, 'after choose', JSON.stringify(after));
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
