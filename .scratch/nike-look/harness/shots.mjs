// Refined-Goya screenshot + metrics harness (local storefront only; never production, never Straumur).
// usage: node shots.mjs --base http://127.0.0.1:4323 --set before|after [--only home,archive] [--widths 1440,390,360]
// Writes shots/<set>/<page>-<width>-fold.png, <page>-<width>-full.jpg and shots/<set>/metrics.json.
// Cart pages put one HOKA variation in a LOCAL Store API cart through /api/cart (no order is placed) and empty it
// afterwards. The wishlist page is seeded through localStorage.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not a local storefront (${BASE})`);
const SET = arg('set', 'after');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const WIDTHS = arg('widths', '1440,390,360').split(',').map(Number);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots', SET);
mkdirSync(OUT, { recursive: true });

const PDP = '/verslun/skor/strigaskor-skor-2/hoka-restore-tc-unisex/';
const WISHLIST = [
  { id: 209042, slug: 'hoka-restore-tc-unisex', path: PDP, name: 'HOKA Restore TC unisex', image: '' },
  { id: 999999, slug: 'ekki-til-lengur', path: '/verslun/ekki-til-lengur/', name: 'Vara sem er ekki lengur til', image: '' },
];
// [name, path, opts] — opts.cart: 'item' | 'empty'; opts.widths limits widths; opts.wishlist seeds localStorage.
const PAGES = [
  ['home', '/'],
  ['archive', '/voruflokkur/skor/'],
  ['archive-filtered', '/voruflokkur/skor/?kyn=konur', { widths: [1440, 390] }],
  ['shop', '/verslun/', { widths: [1440, 390] }],
  ['sale', '/voruflokkur/sale/', { widths: [1440, 390] }],
  ['brand', '/brand/nike/', { widths: [1440, 390] }],
  ['tag', '/merkimidar/born/', { widths: [1440, 390] }],
  ['search', '/?s=hoka&post_type=product'],
  ['search-p2', '/page/2/?s=hoka&post_type=product', { widths: [1440, 390] }],
  ['search-empty', '/?s=zzqxvv&post_type=product', { widths: [1440, 390] }],
  ['wishlist', '/oskalisti/', { widths: [1440, 390], wishlist: true }],
  ['pdp', PDP],
  // area 06: a chosen size (filled swatch, enabled button), a one-image sale product, a 12-image gallery
  ['pdp-chosen', PDP, { click: '.pdp-swatch:not(:disabled)' }],
  ['pdp-sale', '/verslun/fatnadur/nedri-likami/buxur-leggings/nike-fast-buxur-graenar/'],
  ['pdp-gallery', '/verslun/skor/strigaskor-skor-2/nike-gamma-force-low/'],
  // nike-look area 03: a simple product (no sizes) and a colour product whose colours have their own photos
  ['pdp-simple', '/verslun/kyn/born/stitch-reidhjolabjalla/'],
  ['pdp-colour', '/verslun/sumar/trek-solstice-mips-hjolahjalmur-s-m-nokkrir-litir/'],
  ['contact', '/hafa-samband/'],
  ['terms', '/skilmalar/', { widths: [1440, 390] }],
  ['hours', '/opnunartimi/', { widths: [1440, 390] }],
  ['sizes', '/staerdir/', { widths: [1440, 390] }],
  ['about', '/um-okkur/', { widths: [1440, 390] }],
  ['privacy', '/personuvernd/', { widths: [1440, 390] }],
  ['notfound', '/ekki-til-xyz/', { widths: [1440, 390] }],
  ['account', '/min-sida/'],
  ['lost-password', '/min-sida/lost-password/', { widths: [1440, 390] }],
  ['cart-empty', '/karfa/', { widths: [1440, 390], cart: 'empty' }],
  ['cart', '/karfa/', { cart: 'item' }],
  ['checkout', '/gera-upp/', { cart: 'item' }],
  ['checkout-failed', '/gera-upp/?straumurStatus=failed', { widths: [1440, 390], cart: 'item' }],
];
// Overlays opened by a click: [name, path, selector, minWidth, maxWidth, opts]
const OVERLAYS = [
  ['ov-menu', '/', '[data-menu-open]', 0, 9999],
  ['ov-search', '/', '[data-search-open]', 0, 9999],   // nike-look: phones have a search icon too
  ['ov-login', '/', '[data-login-link]', 0, 9999],
  ['ov-sidecart', '/', 'button[aria-label^="Opna körfu"]', 0, 9999, { cart: 'item' }],
  ['ov-filters', '/voruflokkur/skor/', '[data-filters-open]', 0, 991],
];

const viewport = (w) => (w >= 768 ? { width: w, height: 900, deviceScaleFactor: 1 } : { width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const HIDE_TOOLBAR = 'astro-dev-toolbar{display:none!important}';

async function settle(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

// Runs in the page: overflow, contrast on real backgrounds, tap targets, campaign lines, card images, styles.
function collectMetrics(narrow) {
  const vw = window.innerWidth;
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') return { image: true };
      const c = parse(s.backgroundColor);
      if (c && c.a > 0.95) return { color: c };
      node = node.parentElement;
    }
    return { color: { r: 255, g: 255, b: 255, a: 1 } };
  };

  const overflowX = document.documentElement.scrollWidth - vw;
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (offenders.length >= 6) break;
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && r.left < vw && visible(el) && !el.closest('[inert],[aria-hidden="true"],dialog:not([open])')) offenders.push(`${sel(el)} right=${Math.round(r.right)}`);
  }

  const lowContrast = [];
  let checked = 0;
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own || !visible(el) || el.closest('[aria-hidden="true"],dialog:not([open]),noscript')) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const bg = bgOf(el);
    if (!fg || bg.image) continue;
    checked++;
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const cr = ratio(blend(fg, bg.color), bg.color);
    if (cr < need) lowContrast.push({ text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), ratio: Math.round(cr * 100) / 100, need, el: sel(el) });
  }

  const smallTargets = [];
  if (narrow) {
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=radio]')) {
      if (!visible(el) || el.closest('dialog:not([open]),[inert]')) continue;
      const r = el.getBoundingClientRect();
      const inlineLink = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p,li,td');
      if (inlineLink) continue;
      if (r.height < 44 || r.width < 44) smallTargets.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)}${(el.textContent || '').trim() ? ' "' + el.textContent.trim().slice(0, 18) + '"' : ''}`);
    }
  }

  const campaign = [...document.querySelectorAll('.campaign__item')].filter(visible).map((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    return { text: el.textContent.trim().slice(0, 30), lines: Math.round(el.getBoundingClientRect().height / lh) };
  });
  const campaignHeight = Math.round(document.querySelector('.campaign')?.getBoundingClientRect().height ?? 0);

  const cardImgs = [...document.querySelectorAll('.product-card img')].filter((i) => i.naturalWidth);
  const nonSquare = cardImgs.filter((i) => { const q = i.naturalWidth / i.naturalHeight; return q < 0.85 || q > 1.15; }).map((i) => i.currentSrc.split('/').pop()).slice(0, 8);
  const pick = (q, prop) => { const el = document.querySelector(q); return el ? getComputedStyle(el)[prop] : null; };
  const grid = document.querySelector('.archive .product-grid, .product-grid');

  return {
    overflowX, offenders,
    contrast: { checked, failing: lowContrast.length, worst: lowContrast.sort((a, b) => a.ratio - b.ratio).slice(0, 12) },
    smallTargets: narrow ? { count: smallTargets.length, sample: smallTargets.slice(0, 12) } : null,
    campaign, campaignHeight,
    cards: { count: cardImgs.length, objectFit: pick('.product-card img', 'objectFit'), nonSquare, gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null },
    styles: {
      breadcrumbs: pick('.breadcrumbs', 'color'),
      inputBorder: pick('input[type=text], input[type=email], input[type=search], input:not([type])', 'borderTopColor'),
      cardTitleClamp: pick('.product-card__title', 'webkitLineClamp'),
    },
    title: document.title,
    status: document.querySelector('.notfound, [data-status-code]')?.textContent?.trim().slice(0, 40) ?? null,
  };
}

async function fillCart(page) {
  await page.goto(BASE + '/karfa/', { waitUntil: 'load', timeout: 120000 });
  const status = await page.evaluate(async () => (await fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) })).status);
  if (status >= 300) console.log('cart add failed', status);
}
async function emptyCart(page) {
  await page.evaluate(async () => {
    const cart = await (await fetch('/api/cart')).json();
    for (const item of cart.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: item.key }) });
  });
}

const metricsPath = join(OUT, 'metrics.json');
const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')) : {};
const browser = await chromium.launch();
try {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: viewport(w).width, height: viewport(w).height }, deviceScaleFactor: viewport(w).deviceScaleFactor, isMobile: viewport(w).isMobile, hasTouch: viewport(w).hasTouch, locale: 'is-IS' });
    await ctx.addInitScript((list) => { try { localStorage.setItem('mos-wishlist', JSON.stringify(list)); } catch {} }, WISHLIST);
    const page = await ctx.newPage();
    let carted = false;
    const shoot = async (name, path, opts = {}, open) => {
      if (ONLY && !ONLY.has(name)) return;
      if (opts.widths && !opts.widths.includes(w)) return;
      let p = page;
      let tmp = null;
      if (opts.cart === 'empty') { tmp = await browser.newContext({ viewport: { width: viewport(w).width, height: viewport(w).height }, deviceScaleFactor: viewport(w).deviceScaleFactor, isMobile: viewport(w).isMobile, hasTouch: viewport(w).hasTouch, locale: 'is-IS' }); p = await tmp.newPage(); }
      if (opts.cart === 'item' && !carted) { await fillCart(page); carted = true; }
      // 'load', then a bounded wait for idle: a page that keeps polling (e.g. the wishlist refresh while the
      // WooCommerce REST key is missing) must not hang the run.
      const res = await p.goto(BASE + path, { waitUntil: 'load', timeout: 120000 });
      await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await p.addStyleTag({ content: HIDE_TOOLBAR });
      if (open) {
        const target = p.locator(open).filter({ visible: true }).first();
        if (await target.count()) { await target.click(); await p.waitForTimeout(700); } else { console.log('  no trigger', name, w); }
      } else {
        await settle(p);
        if (opts.click) {
          // a page-state click (e.g. choose a size); never an add to cart or a checkout
          const target = p.locator(opts.click).filter({ visible: true }).first();
          if (await target.count()) { await target.click(); await p.waitForTimeout(400); } else { console.log('  no click target', name, w); }
        }
      }
      await p.screenshot({ path: join(OUT, `${name}-${w}-fold.png`) });
      if (!open) await p.screenshot({ path: join(OUT, `${name}-${w}-full.jpg`), fullPage: true, type: 'jpeg', quality: 62 });
      metrics[`${name}@${w}`] = { http: res?.status() ?? null, ...(await p.evaluate(collectMetrics, w < 768)) };
      if (tmp) await tmp.close();
      console.log(`${SET} ${name} ${w} → ${res?.status()}`);
    };
    for (const [name, path, opts] of PAGES) await shoot(name, path, opts);
    for (const [name, path, selector, min, max, opts] of OVERLAYS) if (w >= min && w <= max) await shoot(name, path, opts ?? {}, selector);
    if (carted) await emptyCart(page);
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 1));
}
