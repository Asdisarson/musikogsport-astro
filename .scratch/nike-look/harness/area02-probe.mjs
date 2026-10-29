// Area 02 (the wall) probe, local storefront only: grid and card geometry vs the nike spec, the rail (width,
// stickiness, internal scroll, "Fela síur" fold + memory + reduced motion), keyboard on the rail and sort, card
// hover/focus action and the full-card title target, the phone pills/sheet, colour contrast, console errors.
// Shots go to shots/area02/probe-*. usage: node area02-probe.mjs [base]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing: not local (${BASE})`);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'area02');
mkdirSync(OUT, { recursive: true });
const WALL = '/voruflokkur/skor/';
const r = (n) => Math.round(n * 10) / 10;
const log = (...a) => console.log(...a);

// --- contrast of the card colours (WCAG relative luminance) ---
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [R, G, B] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
for (const [name, c] of [['label --accent', '#d33918'], ['subtitle/struck/Uppselt --meta', '#707072'], ['-N% --sale-green', '#107c10'], ['title/price --ink', '#111111']]) {
  log(`contrast ${name} ${c}: on #fff ${ratio(c, '#ffffff')}, on #f5f5f5 ${ratio(c, '#f5f5f5')}`);
}

const browser = await chromium.launch();
const errors = [];
const ctxFor = async (w, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 768, hasTouch: w < 768, deviceScaleFactor: 1, ...extra });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${w} ${m.text().slice(0, 140)}`); });
  page.on('pageerror', (e) => errors.push(`${w} ${String(e).slice(0, 140)}`));
  return { ctx, page };
};
const geometry = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const lis = [...document.querySelectorAll('.archive .product-grid > li')];
  const imgs = lis.slice(0, 4).map((li) => rect(li.querySelector('.product-card__media')));
  const grid = q('.archive .product-grid');
  const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
  const rowGap = lis[cols] && lis[0] ? Math.round(lis[cols].getBoundingClientRect().top - lis[0].getBoundingClientRect().bottom) : null;
  const rail = q('.archive-filters');
  const railS = rail && getComputedStyle(rail);
  const h1 = q('.archive__title');
  const cap = lis[0]?.querySelector('.product-card__caption');
  const lines = cap ? [...cap.children].map((c) => `${c.className.split(' ')[0].replace('product-card__', '')}:${getComputedStyle(c).fontSize}/${getComputedStyle(c).lineHeight}/${getComputedStyle(c).fontWeight}`) : [];
  return {
    cols, cell: rect(lis[0]), imgs, imgGap: imgs[1] && imgs[0] && imgs[1].y === imgs[0].y ? imgs[1].x - (imgs[0].x + imgs[0].w) : null, rowGap,
    rail: rect(rail), railVisibility: railS?.visibility, railPosition: railS?.position, railScrolls: rail ? rail.scrollHeight > rail.clientHeight : null,
    railCats: rect(q('.archive-cats')), h1: h1 ? `${h1.textContent.trim()} ${getComputedStyle(h1).fontSize}/${getComputedStyle(h1).fontWeight}` : null,
    toggle: q('[data-rail-toggle]')?.getAttribute('aria-expanded'), sort: rect(q('.archive__sort select')), lines,
    more: rect(q('.archive__more-btn')), moreBg: q('.archive__more-btn') ? getComputedStyle(q('.archive__more-btn')).backgroundColor : null,
    hscroll: document.documentElement.scrollWidth - innerWidth,
  };
});

try {
  // ---------- desktop widths, rail open ----------
  for (const w of [1920, 1440, 1200, 1024]) {
    const { ctx, page } = await ctxFor(w);
    await page.goto(BASE + WALL, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.removeItem('mos-filters-hidden'));
    await page.reload({ waitUntil: 'load' });
    const g = await geometry(page);
    log(`\n[${w} rail open] cols ${g.cols} cell ${g.cell?.w} imgs ${g.imgs.map((i) => `${i.x}+${i.w}`).join(' ')} imgGap ${g.imgGap} rowGap ${g.rowGap}`);
    log(`  rail ${JSON.stringify(g.rail)} cats ${g.railCats?.w} position ${g.railPosition} scrolls ${g.railScrolls}; h1 "${g.h1}"; toggle aria-expanded ${g.toggle}; sort ${JSON.stringify(g.sort)}`);
    log(`  caption ${g.lines.join(' | ')}; more ${JSON.stringify(g.more)} ${g.moreBg}; hscroll ${g.hscroll}`);
    if (w === 1920 || w === 1200) await page.screenshot({ path: join(OUT, `probe-wall-${w}-open.png`) });

    if (w === 1440) {
      await page.goto(BASE + '/verslun/', { waitUntil: 'load' });
      const sh = await page.evaluate(() => { const a = document.querySelector('.archive-filters'); return `scrollHeight ${a.scrollHeight} clientHeight ${a.clientHeight} overflowY ${getComputedStyle(a).overflowY} scrollbar ${getComputedStyle(a).scrollbarWidth}`; });
      log(`  /verslun/ rail: ${sh}`);
      await page.goto(BASE + WALL, { waitUntil: 'load' });
    }
    // sticky: scroll the page, the rail stays under the 60px bar
    await page.evaluate(() => window.scrollTo(0, 1600));
    await page.waitForTimeout(150);
    const stuck = await page.evaluate(() => Math.round(document.querySelector('.archive-filters').getBoundingClientRect().top));
    log(`  scrolled 1600: rail top ${stuck} (header 60)`);
    await page.evaluate(() => window.scrollTo(0, 0));

    // "Fela síur": mid-transition and settled
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('.archive')).gridTemplateColumns);
    await page.click('[data-rail-toggle]');
    await page.waitForTimeout(180);
    const mid = await page.evaluate(() => getComputedStyle(document.querySelector('.archive')).gridTemplateColumns);
    await page.waitForTimeout(400);
    const gh = await geometry(page);
    const stored = await page.evaluate(() => localStorage.getItem('mos-filters-hidden'));
    log(`  hide: columns ${before} → (180ms) ${mid} → ${await page.evaluate(() => getComputedStyle(document.querySelector('.archive')).gridTemplateColumns)}`);
    log(`  hidden: cols ${gh.cols} cell ${gh.cell?.w} img ${gh.imgs[0]?.w} imgGap ${gh.imgGap} rail visibility ${gh.railVisibility} toggle aria-expanded ${gh.toggle} label "${await page.locator('[data-rail-toggle]').innerText()}" stored ${stored} hscroll ${gh.hscroll}`);
    if (w === 1920 || w === 1200 || w === 1440) await page.screenshot({ path: join(OUT, `probe-wall-${w}-hidden.png`) });
    // remembered across a reload, with no fold animation on load
    await page.reload({ waitUntil: 'domcontentloaded' });
    const onLoad = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-filters-hidden'), vis: getComputedStyle(document.querySelector('.archive-filters')).visibility, cols: getComputedStyle(document.querySelector('.archive')).gridTemplateColumns }));
    log(`  after reload: html[data-filters-hidden] ${onLoad.attr}, rail ${onLoad.vis}, columns ${onLoad.cols}`);
    await page.click('[data-rail-toggle]');
    await page.waitForTimeout(450);
    log(`  shown again: toggle ${await page.getAttribute('[data-rail-toggle]', 'aria-expanded')} rail ${await page.evaluate(() => getComputedStyle(document.querySelector('.archive-filters')).visibility)}`);
    await ctx.close();
  }

  // ---------- keyboard, hover, focus, title target (1440) ----------
  {
    const { ctx, page } = await ctxFor(1440);
    await page.goto(BASE + WALL, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.removeItem('mos-filters-hidden'));
    await page.reload({ waitUntil: 'load' });
    await page.focus('[data-rail-toggle]');
    await page.keyboard.press('Tab');
    const afterToggle = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className);
    await page.keyboard.press('Tab');
    const afterSort = await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent?.trim().slice(0, 20)}`);
    log(`\n[keyboard 1440] Tab after toggle → ${afterToggle}; Tab after sort → ${afterSort}`);
    // walk to the first filter group summary and toggle it with Enter / Space
    for (let i = 0; i < 20; i++) {
      const tag = await page.evaluate(() => document.activeElement?.tagName);
      if (tag === 'SUMMARY') break;
      await page.keyboard.press('Tab');
    }
    const sum = await page.evaluate(() => { const d = document.activeElement?.closest('details'); return { text: document.activeElement?.textContent?.trim(), open: d?.open }; });
    await page.keyboard.press('Enter');
    const sumAfter = await page.evaluate(() => document.activeElement?.closest('details')?.open);
    await page.keyboard.press('Tab');
    const firstOption = await page.evaluate(() => `${document.activeElement?.getAttribute('role')} ${document.activeElement?.textContent?.trim()}`);
    log(`  summary "${sum.text}" open ${sum.open} → Enter → ${sumAfter}; Tab → ${firstOption}`);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    // the toggle by keyboard
    await page.focus('[data-rail-toggle]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const skipped = await page.evaluate(() => `${document.activeElement?.closest('.archive-filters') ? 'IN RAIL' : 'not in rail'}: ${document.activeElement?.className} ${document.activeElement?.textContent?.trim().slice(0, 30)}`);
    log(`  rail hidden by Enter, Tab ×2 from toggle → ${skipped}`);
    await page.focus('[data-rail-toggle]');
    await page.keyboard.press(' ');
    await page.waitForTimeout(450);
    log(`  Space shows it again: aria-expanded ${await page.getAttribute('[data-rail-toggle]', 'aria-expanded')}`);
    // sort by keyboard: change the select's value and the form submits
    await page.focus('#archive-orderby');
    const [nav] = await Promise.all([
      page.waitForNavigation({ timeout: 8000 }).catch(() => null),
      (async () => { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); })(),
    ]);
    if (!nav) {
      // Chromium on macOS opens the native popup on ArrowDown; the change → submit path itself:
      await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.selectOption('#archive-orderby', 'price')]);
      log(`  sort change (selectOption price) → ${page.url().replace(BASE, '')}; selected ${await page.$eval('#archive-orderby', (s) => s.value)}`);
    }
    log(`  sort ArrowDown → ${nav ? page.url().replace(BASE, '') : 'no navigation (popup?)'}; selected ${await page.$eval('#archive-orderby', (s) => s.value)}`);

    // hover reveals the action, no zoom; the action takes the click above the title overlay
    await page.goto(BASE + WALL, { waitUntil: 'load' });
    const card = page.locator('.archive .product-card').first();
    const action = card.locator('.product-card__action');
    const op0 = await action.evaluate((el) => getComputedStyle(el).opacity);
    await card.hover();
    await page.waitForTimeout(350);
    const hovered = await card.evaluate((c) => {
      const a = c.querySelector('.product-card__action :is(a,button)');
      const b = a.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const img = c.querySelector('.product-card__media img');
      const ib = c.querySelector('.product-card__media').getBoundingClientRect();
      const onImg = document.elementFromPoint(ib.x + ib.width / 2, ib.y + ib.height / 2);
      const cat = c.querySelector('.product-card__cats a');
      const cb = cat?.getBoundingClientRect();
      const onCat = cb ? document.elementFromPoint(cb.x + 4, cb.y + cb.height / 2) : null;
      return {
        opacity: getComputedStyle(c.querySelector('.product-card__action')).opacity, text: a.textContent.trim(), decoration: getComputedStyle(a).textDecorationLine,
        actionHit: hit === a || a.contains(hit), imgTransform: getComputedStyle(img).transform,
        imageHit: onImg?.closest('.product-card__title') ? 'title link' : onImg?.className, catHit: onCat === cat ? 'category link' : onCat?.className,
        title: c.querySelector('.product-card__title a').getAttribute('href'),
      };
    });
    log(`\n[hover 1440] action opacity ${op0} → ${hovered.opacity} "${hovered.text}" ${hovered.decoration}; action takes the click: ${hovered.actionHit}; img transform ${hovered.imgTransform}; a tap on the image hits: ${hovered.imageHit}; on the category: ${hovered.catHit}`);
    await page.screenshot({ path: join(OUT, 'probe-hover-1440.png'), clip: await card.evaluate((c) => { const b = c.getBoundingClientRect(); return { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 }; }) });
    // focus (keyboard) reveals it too
    await page.mouse.move(5, 5);
    await page.locator('.archive .product-card__title a').nth(1).focus();
    await page.waitForTimeout(350);
    const focusOp = await page.locator('.archive .product-card').nth(1).locator('.product-card__action').evaluate((el) => getComputedStyle(el).opacity);
    const ring = await page.locator('.archive .product-card__title a').nth(1).evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
    log(`  focus on the 2nd title: action opacity ${focusOp}; title ring ${ring}; Tab → ${next}`);
    // a tap on the image goes to the product
    const href = hovered.title;
    const mb = await page.locator('.archive .product-card__media').first().boundingBox();
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/voruflokkur/'), { timeout: 15000 }), page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2)]);
    log(`  click on the first image → ${page.url().replace(BASE, '')} (title href ${href})`);
    await ctx.close();
  }

  // ---------- reduced motion ----------
  {
    const { ctx, page } = await ctxFor(1440, { reducedMotion: 'reduce' });
    await page.goto(BASE + WALL, { waitUntil: 'load' });
    const t = await page.evaluate(() => ({ archive: getComputedStyle(document.querySelector('.archive')).transitionDuration, rail: getComputedStyle(document.querySelector('.archive-filters')).transitionDuration }));
    log(`\n[reduced motion] archive transition ${t.archive}, rail ${t.rail}`);
    await ctx.close();
  }

  // ---------- phones ----------
  for (const w of [390, 360]) {
    const { ctx, page } = await ctxFor(w);
    await page.goto(BASE + WALL, { waitUntil: 'load' });
    const g = await geometry(page);
    const pills = await page.evaluate(() => [...document.querySelectorAll('.archive__pills .wall-pill')].map((b) => { const r = b.getBoundingClientRect(); return `${b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
    const firstOpenerVisible = await page.evaluate(() => { const b = document.querySelector('[data-filters-open]'); const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).visibility === 'visible' ? b.textContent.trim() : 'HIDDEN'; });
    const chips = await page.evaluate(() => [...document.querySelectorAll('.archive__chips a')].map((a) => `${a.textContent.trim()}@${Math.round(a.getBoundingClientRect().height)}`));
    log(`\n[${w}] cols ${g.cols} cell ${g.cell?.w} imgs ${g.imgs.map((i) => `${i.x}+${i.w}`).join(' ')} imgGap ${g.imgGap} rowGap ${g.rowGap}; h1 "${g.h1}"; rail position ${g.railPosition}; hscroll ${g.hscroll}`);
    log(`  caption ${g.lines.join(' | ')}`);
    log(`  first [data-filters-open]: ${firstOpenerVisible}; pills ${pills.join(', ')}; chips ${chips.join(', ')}`);
    // a group pill opens the sheet at that group; Escape closes it and focus returns to that pill
    const brandPill = page.locator('[data-filters-group="brand"]');
    await brandPill.click();
    await page.waitForTimeout(450);
    const opened = await page.evaluate(() => ({ open: document.querySelector('[data-filters]').dataset.open, group: document.querySelector('[data-group="brand"]')?.open, focus: document.activeElement?.textContent?.trim(), expanded: document.querySelector('[data-filters-group="brand"]').getAttribute('aria-expanded') }));
    if (w === 390) await page.screenshot({ path: join(OUT, `probe-sheet-brand-${w}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    const closed = await page.evaluate(() => ({ open: document.querySelector('[data-filters]').dataset.open, focus: document.activeElement?.textContent?.trim() }));
    log(`  brand pill → sheet open ${opened.open}, Vörumerki open ${opened.group}, focus "${opened.focus}", aria-expanded ${opened.expanded}; Escape → open ${closed.open}, focus back on "${closed.focus}"`);
    await page.locator('.archive__pills .wall-pill').first().click();
    await page.waitForTimeout(450);
    const f2 = await page.evaluate(() => document.activeElement?.textContent?.trim());
    await page.click('[data-filters-close]');
    await page.waitForTimeout(450);
    const f3 = await page.evaluate(() => document.activeElement?.textContent?.trim());
    log(`  Sía pill → focus "${f2}"; Sýna vörur → focus back on "${f3}"`);
    // the hidden-rail memory never touches the phone layout
    await page.evaluate(() => { localStorage.setItem('mos-filters-hidden', '1'); });
    await page.reload({ waitUntil: 'load' });
    const g2 = await geometry(page);
    log(`  with mos-filters-hidden=1: cols ${g2.cols}, pills visible ${await page.locator('.archive__pills').isVisible()}`);
    await page.evaluate(() => localStorage.removeItem('mos-filters-hidden'));
    await ctx.close();
  }

  // ---------- area 01 carry-over: the single full-width story tile ----------
  for (const w of [1920, 1440]) {
    const { ctx, page } = await ctxFor(w);
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const tile = page.locator('.story-row--single .story').first();
    if (await tile.count()) {
      await tile.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await tile.screenshot({ path: join(OUT, `probe-story-single-${w}.png`) });
      log(`\n[story single ${w}] ${await tile.evaluate((t) => `${Math.round(t.getBoundingClientRect().width)}x${Math.round(t.getBoundingClientRect().height)} ${getComputedStyle(t.querySelector('.story__img')).objectPosition}`)}`);
    }
    await ctx.close();
  }

  // ---------- console errors on the wall pages ----------
  for (const w of [1440, 390]) {
    const { ctx, page } = await ctxFor(w);
    for (const p of [WALL, '/voruflokkur/skor/?kyn=konur', '/verslun/', '/voruflokkur/sale/', '/brand/nike/', '/merkimidar/born/', '/?s=hoka&post_type=product', '/oskalisti/']) {
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    }
    await ctx.close();
  }
  log(`\nconsole errors: ${errors.length ? JSON.stringify(errors) : 0}`);
} finally {
  await browser.close();
}
