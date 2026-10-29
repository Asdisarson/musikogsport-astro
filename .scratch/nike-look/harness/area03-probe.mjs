// Area 03 probe (local preview only): PDP geometry, stickiness, gallery/thumbs, keyboard, wishlist, size chart,
// colourways, one LOCAL add to cart (emptied afterwards), console errors, sideways overflow with every <details> open.
// usage: node area03-probe.mjs <base> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, out] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
mkdirSync(out, { recursive: true });
const P = {
  hoka: '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/',
  sale: '/verslun/fatnadur/nedri-likami/buxur-leggings/nike-fast-buxur-graenar/',
  gallery: '/verslun/skor/strigaskor-skor-2/nike-gamma-force-low/',
  simple: '/verslun/kyn/born/stitch-reidhjolabjalla/',
  colour: '/verslun/sumar/trek-solstice-mips-hjolahjalmur-s-m-nokkrir-litir/',
  saleSimple: '/verslun/aefingarvorur/brusar/stanley-quencher-protour-flip-straw-violet-blossom-1-18l/',
};
const log = (...a) => console.log(...a);
const r = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : null);
const browser = await chromium.launch();
const errors = [];
const ctxFor = (w, h = 900) => {
  const mobile = w < 768;
  return browser.newContext({ viewport: { width: w, height: mobile ? 844 : h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
};
async function open(ctx, path) {
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${path}: ${m.text().slice(0, 160)}`); });
  p.on('pageerror', (e) => errors.push(`${path}: ${String(e).slice(0, 160)}`));
  const res = await p.goto(base + path, { waitUntil: 'load' });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  return [p, res?.status()];
}
try {
  // 1. geometry per width
  for (const w of [1920, 1440, 1200, 1024, 992, 390, 360]) {
    const ctx = await ctxFor(w);
    const [p, status] = await open(ctx, P.hoka);
    const g = await p.evaluate(() => {
      const box = (q) => document.querySelector(q)?.getBoundingClientRect();
      const cs = (q) => { const e = document.querySelector(q); return e ? getComputedStyle(e) : null; };
      const item = box('.pdp-gallery__item a');
      const sw = box('.pdp-swatch');
      return {
        crumbs: box('.pdp > .breadcrumbs'), thumbs: box('.pdp-thumbs'), thumb: box('.pdp-thumb'), thumbBorder: cs('.pdp-thumb')?.borderColor, thumbActive: cs('.pdp-thumb[aria-current="true"]')?.borderColor,
        image: item, aspect: item ? (item.width / item.height).toFixed(3) : null, rail: box('.pdp-rail'), railPos: cs('.pdp-rail')?.position,
        title: `${cs('.pdp-title')?.fontSize}/${cs('.pdp-title')?.fontWeight} ${cs('.pdp-title')?.fontFamily.split(',')[0]}`, subtitle: document.querySelector('.pdp-subtitle')?.textContent, subColor: cs('.pdp-subtitle')?.color,
        swatch: sw, swRadius: cs('.pdp-swatch')?.borderRadius, swCols: cs('.pdp-swatches')?.gridTemplateColumns, swGap: cs('.pdp-swatches')?.gap,
        qty: box('.pdp-qty'), atc: box('.pdp-atc'), wish: box('.pdp-wish'), atcRadius: cs('.pdp-atc')?.borderRadius,
        count: document.querySelector('.pdp-gallery__count')?.textContent?.trim(), countShown: cs('.pdp-gallery__count')?.display,
        imgs: [...document.querySelectorAll('.pdp-gallery__item img')].map((i) => ({ ok: i.naturalWidth > 0 && !i.currentSrc.endsWith('/placeholder.svg'), cur: i.currentSrc.split('/').pop(), sizes: i.sizes })).slice(0, 3),
        hscroll: document.documentElement.scrollWidth - innerWidth,
      };
    });
    log(`\n[${w}] ${status}`, JSON.stringify(g, (k, v) => (v && typeof v === 'object' && 'x' in v && 'width' in v ? r(v) : v)));
    await p.screenshot({ path: join(out, `hoka-${w}-fold.png`) });
    await ctx.close();
  }

  // 2. desktop behaviour at 1440x900 and 1440x800
  for (const h of [900, 800]) {
    const ctx = await ctxFor(1440, h);
    const [p] = await open(ctx, P.gallery);
    // all images loaded through srcset (scroll the stack)
    for (let y = 0; y < 9000; y += 600) { await p.evaluate((t) => scrollTo(0, t), y); await p.waitForTimeout(60); }
    await p.waitForTimeout(800);
    const load = await p.evaluate(() => [...document.querySelectorAll('.pdp-gallery__item img, .pdp-thumb img')].map((i) => (i.naturalWidth > 0 && !i.currentSrc.endsWith('/placeholder.svg') ? 1 : 0)).reduce((a, b) => a + b, 0) + '/' + document.querySelectorAll('.pdp-gallery__item img, .pdp-thumb img').length);
    const cur = await p.evaluate(() => [...new Set([...document.querySelectorAll('.pdp-gallery__item img, .pdp-thumb img')].map((i) => (i.currentSrc.match(/-(\d+x\d+)\.\w+$/) || ['', 'full'])[1]))].join(','));
    // thumb click scrolls its image under the header and marks it
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(300);
    await p.locator('.pdp-thumb').nth(5).click();
    await p.waitForTimeout(1200);
    const th = await p.evaluate(() => ({ top: Math.round(document.querySelectorAll('.pdp-gallery__item')[5].getBoundingClientRect().top), current: [...document.querySelectorAll('.pdp-thumb')].findIndex((b) => b.getAttribute('aria-current') === 'true'), thumbsTop: Math.round(document.querySelector('.pdp-thumbs').getBoundingClientRect().top), scrollY }));
    // rail: sticky; open every accordion; the rail's foot must come into view before .pdp ends; never past .pdp
    await p.evaluate(() => document.querySelectorAll('.pdp-tab').forEach((d) => (d.open = true)));
    await p.waitForTimeout(300);
    const rail = await p.evaluate(async () => {
      const rail = document.querySelector('.pdp-rail');
      const pdp = document.querySelector('.pdp');
      const notice = document.querySelector('.store-notice');
      const covered = notice && getComputedStyle(notice).display !== 'none' ? notice.offsetHeight : 0;
      const pdpBottom = pdp.getBoundingClientRect().bottom + scrollY;
      const samples = [];
      for (const y of [400, 1200, 2400, pdpBottom - innerHeight - 50, pdpBottom - innerHeight + 300]) {
        scrollTo(0, y);
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const b = rail.getBoundingClientRect();
        samples.push({ y: Math.round(scrollY), top: Math.round(b.top), bottom: Math.round(b.bottom), view: innerHeight - covered, pdpBottom: Math.round(pdp.getBoundingClientRect().bottom) });
      }
      return { railH: rail.offsetHeight, railTopVar: rail.style.getPropertyValue('--rail-top'), samples, footer: Math.round(document.querySelector('.site-footer')?.getBoundingClientRect().top + scrollY), related: Math.round(document.querySelector('.pdp-related')?.getBoundingClientRect().top + scrollY) };
    });
    log(`\n[1440x${h} gallery] loaded ${load} sizes ${cur}; thumb#5 ->`, JSON.stringify(th), '\nrail', JSON.stringify(rail));
    await p.evaluate(() => scrollTo(0, 1600));
    await p.waitForTimeout(400);
    await p.screenshot({ path: join(out, `gallery-1440x${h}-scrolled.png`) });
    // back at the top: the first thumb is marked and the thumb column is back at 0 (its padding in view)
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(400);
    log('back to top: thumb column scrollTop', await p.evaluate(() => document.querySelector('.pdp-thumbs').scrollTop), 'current', await p.evaluate(() => [...document.querySelectorAll('.pdp-thumb')].findIndex((b) => b.getAttribute('aria-current') === 'true')));
    // lightbox
    await p.locator('.pdp-gallery__item a').first().click();
    await p.waitForTimeout(300);
    log('lightbox open', await p.evaluate(() => document.querySelector('.lightbox').open), await p.evaluate(() => document.querySelector('[data-lightbox-count]').textContent));
    await p.keyboard.press('Escape');
    await ctx.close();
  }

  // 3. keyboard on the size grid + accordion + size chart + wishlist + one local add to cart (HOKA, 1440)
  {
    const ctx = await ctxFor(1440);
    const [p] = await open(ctx, P.hoka);
    await p.evaluate(() => localStorage.removeItem('mos-wishlist'));
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(800);
    const first = p.locator('.pdp-swatch:not(:disabled)').first();
    await first.focus();
    const at = () => p.evaluate(() => document.activeElement?.textContent);
    const k0 = await at();
    await p.keyboard.press('ArrowRight'); const k1 = await at();
    await p.keyboard.press('ArrowDown'); const k2 = await at();
    await p.keyboard.press('ArrowLeft'); const k3 = await at();
    const ring = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    const before = await p.evaluate(() => ({ disabled: document.querySelector('.pdp-atc').disabled, hint: document.querySelector('.pdp-hint')?.textContent ?? null }));
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => ({ checked: document.querySelector('.pdp-swatch[aria-checked="true"]')?.textContent, weight: getComputedStyle(document.querySelector('.pdp-swatch[aria-checked="true"]')).fontWeight, shadow: getComputedStyle(document.querySelector('.pdp-swatch[aria-checked="true"]')).boxShadow, disabled: document.querySelector('.pdp-atc').disabled, hint: document.querySelector('.pdp-hint')?.textContent ?? null, sku: document.querySelector('[data-pdp-sku]')?.textContent, stock: document.querySelector('.pdp-stock')?.textContent }));
    const struck = await p.evaluate(() => { const d = document.querySelector('.pdp-swatch:disabled'); if (!d) return 'no sold-out size'; const s = getComputedStyle(d); return `${d.textContent} ${s.textDecorationLine} ${s.color} on ${s.backgroundColor}`; });
    log('\n[keyboard] focus', k0, '→R', k1, '→D', k2, '→L', k3, 'ring', ring, 'before', JSON.stringify(before), 'after Enter', JSON.stringify(after), 'sold-out', struck);
    await p.locator('.pdp-buy').screenshot({ path: join(out, 'hoka-1440-chosen.png') });
    // accordion by keyboard
    const sum = p.locator('.pdp-tab__title').first();
    await sum.focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    const acc = await p.evaluate(() => ({ open: document.querySelector('.pdp-tab').open, chevron: getComputedStyle(document.querySelector('.pdp-tab__chevron')).transform, h: Math.round(document.querySelector('.pdp-tab__title').getBoundingClientRect().height), titles: [...document.querySelectorAll('.pdp-tab__title')].map((s) => s.textContent.trim()) }));
    await p.keyboard.press('Enter');
    log('[accordion]', JSON.stringify(acc));
    // size chart popup after hydration
    await p.locator('[data-sizeguide]').click();
    await p.waitForTimeout(1200);
    log('[size chart] open', await p.evaluate(() => document.querySelector('[data-sizeguide-dialog]').open), 'loaded', await p.evaluate(() => !document.querySelector('[data-sizeguide-body]').textContent.includes('Sæki')));
    await p.keyboard.press('Escape');
    // wishlist
    const wish = async () => p.evaluate(() => ({ pressed: document.querySelector('.pdp-wish').getAttribute('aria-pressed'), count: [...document.querySelectorAll('[data-wish-count]')].map((e) => e.textContent).join('|'), stored: JSON.parse(localStorage.getItem('mos-wishlist') || '[]').map((x) => `${x.id}:${x.path}`) }));
    const w0 = await wish();
    await p.locator('.pdp-wish').click(); const w1 = await wish();
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(600); const w2 = await wish();
    await p.locator('.pdp-wish').click(); const w3 = await wish();
    log('[wishlist] start', JSON.stringify(w0), 'click', JSON.stringify(w1), 'reload', JSON.stringify(w2), 'click again', JSON.stringify(w3));
    // one local add to cart: choose the first in-stock size, add, side cart opens; then empty the cart
    await p.locator('.pdp-swatch:not(:disabled)').first().click();
    await p.locator('.pdp-atc').click();
    await p.waitForTimeout(2500);
    const cart = await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); return { items: (c.items ?? []).map((i) => `${i.id}x${i.quantity}`), drawer: !!document.querySelector('[data-cart-open="true"], .cart-drawer[open], .side-cart[data-open="true"], [data-sidecart][data-open="true"]') }; });
    log('[add to cart]', JSON.stringify(cart));
    await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });
    log('[cart emptied]', await p.evaluate(async () => ((await (await fetch('/api/cart')).json()).items ?? []).length));
    await ctx.close();
  }

  // 4. other products at 1440 and 390: sale, simple, colourways, sale simple
  for (const w of [1440, 390]) {
    const ctx = await ctxFor(w);
    for (const name of ['sale', 'simple', 'saleSimple', 'colour']) {
      const [p, status] = await open(ctx, P[name]);
      const m = await p.evaluate(() => ({
        title: document.querySelector('.pdp-title')?.textContent, subtitle: document.querySelector('.pdp-subtitle')?.textContent,
        price: document.querySelector('.pdp-price')?.textContent.replace(/\s+/g, ' ').trim(), offColor: document.querySelector('.pdp-price__off') ? getComputedStyle(document.querySelector('.pdp-price__off')).color : null,
        delColor: document.querySelector('.pdp-price del') ? getComputedStyle(document.querySelector('.pdp-price del')).color : null,
        swatches: document.querySelectorAll('.pdp-swatch').length, imageSwatches: document.querySelectorAll('.pdp-swatch--image').length, sizeGuide: document.querySelectorAll('[data-sizeguide]').length,
        labels: [...document.querySelectorAll('.pdp-var__label')].map((l) => l.textContent), atcDisabled: document.querySelector('.pdp-atc')?.disabled, images: document.querySelectorAll('.pdp-gallery__item').length, thumbs: document.querySelectorAll('.pdp-thumb').length,
      }));
      log(`\n[${w} ${name}] ${status}`, JSON.stringify(m));
      if (name === 'colour' && m.imageSwatches) {
        const src0 = await p.evaluate(() => document.getElementById('pdp-main').currentSrc);
        await p.locator('.pdp-swatch--image:not(:disabled)').nth(1).click();
        await p.waitForTimeout(800);
        const src1 = await p.evaluate(() => ({ src: document.getElementById('pdp-main').currentSrc, label: document.querySelector('.pdp-var__label').textContent, ok: document.getElementById('pdp-main').naturalWidth > 0 }));
        log('  colourway swap', src0.split('/').pop(), '→', JSON.stringify({ ...src1, src: src1.src.split('/').pop() }));
        await p.locator('.pdp-vars').screenshot({ path: join(out, `colour-${w}-chosen.png`) });
      }
      await p.screenshot({ path: join(out, `${name}-${w}-fold.png`) });
      await p.close();
    }
    await ctx.close();
  }

  // 5. sideways overflow with every <details> open, 320..1920
  const widths = [320, 360, 390, 414, 600, 768, 991, 992, 1024, 1100, 1199, 1200, 1280, 1440, 1600, 1920];
  const worst = {};
  for (const name of Object.keys(P)) {
    for (const w of widths) {
      const ctx = await ctxFor(w);
      const [p] = await open(ctx, P[name]);
      await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
      await p.waitForTimeout(150);
      const o = await p.evaluate(() => {
        const inScroller = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const ox = getComputedStyle(n).overflowX; if (ox !== 'visible') return true; } return false; };
        const bad = [];
        for (const el of document.querySelectorAll('.pdp *, .pdp-related *')) {
          const b = el.getBoundingClientRect();
          if (!b.width || el.closest('dialog:not([open])')) continue;
          if (b.right > innerWidth + 1 && !inScroller(el)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
        }
        return { o: document.documentElement.scrollWidth - innerWidth, bad: bad.slice(0, 4) };
      });
      if (o.o || o.bad.length) worst[`${name}@${w}`] = o;
      await ctx.close();
    }
  }
  log('\n[overflow, details open]', Object.keys(worst).length ? JSON.stringify(worst) : `0 on ${Object.keys(P).length} products × ${widths.length} widths`);
  log('[console errors]', errors.length ? JSON.stringify(errors) : 0);
} finally {
  await browser.close();
}
