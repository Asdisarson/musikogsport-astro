// Delta-review fixes: a mouse click on a clipped category link navigates; keyboard focus still reveals the line;
// a focused invalid field shows the ink ring; cart reading order matches the layout; the nav flip only applies below 1200.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4323';
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  await p.goto(`${BASE}/verslun/`, { waitUntil: 'load' });
  // find a card whose category line is clipped and click the visible part of its last link
  const target = await p.evaluate(() => {
    for (const c of document.querySelectorAll('.product-card__cats')) {
      if (c.scrollWidth <= c.clientWidth) continue;
      const links = [...c.querySelectorAll('a')];
      const cr = c.getBoundingClientRect();
      const last = links.find((a) => a.getBoundingClientRect().right > cr.right && a.getBoundingClientRect().left < cr.right - 8);
      if (!last) continue;
      last.scrollIntoView({ block: 'center' });
      const r = last.getBoundingClientRect();
      return { href: last.getAttribute('href'), x: r.left + 4, y: r.top + r.height / 2 };
    }
    return null;
  });
  if (target) {
    await Promise.all([p.waitForURL((u) => u.pathname !== '/verslun/', { timeout: 20000 }).catch(() => {}), p.mouse.click(target.x, target.y)]);
    await p.waitForLoadState('load');
    console.log('#1 mouse click on a clipped link:', new URL(p.url()).pathname === target.href ? 'navigated' : `stayed at ${new URL(p.url()).pathname} (wanted ${target.href})`);
  } else console.log('#1 no clipped category line found at 1024');
  await p.goto(`${BASE}/verslun/`, { waitUntil: 'load' });
  await p.keyboard.press('Tab');
  await p.locator('.product-card__cats a').first().focus();
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  console.log('#1 keyboard reveal:', await p.evaluate(() => { const c = document.activeElement.closest('.product-card__cats'); return c ? getComputedStyle(c).whiteSpace : `focus on ${document.activeElement.className}`; }));

  // cart reading order vs layout (desktop and phone): checkout, then the coupon field, both inside the panel
  await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
  await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
  for (const w of [1440, 1100, 390]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
    await p.locator('.cart-line').waitFor();
    console.log(`#4 cart ${w}:`, JSON.stringify(await p.evaluate(() => {
      const all = [...document.querySelectorAll('a, button, input, select')];
      const co = document.querySelector('.cart-totals__checkout'); const cp = document.querySelector('.cart-totals__coupon input');
      return { domOrder: all.indexOf(co) < all.indexOf(cp) ? 'checkout→coupon' : 'coupon→checkout', visual: co.getBoundingClientRect().top < cp.getBoundingClientRect().top ? 'checkout above coupon' : 'coupon above checkout', couponInPanel: !!cp.closest('.cart-totals'), overflow: document.documentElement.scrollWidth - innerWidth };
    })));
  }
  await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });

  // invalid field keeps a focus ring
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
  await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
  await p.goto(`${BASE}/gera-upp/`, { waitUntil: 'load' });
  await p.locator('#billing_first_name').waitFor();
  await p.locator('.checkout__place').click();
  await p.waitForTimeout(800);
  const look = () => p.evaluate(() => { const i = getComputedStyle(document.querySelector('#billing_first_name')); return `${i.borderTopColor} / ${i.boxShadow}`; });
  const blurred = await look();
  await p.locator('#billing_first_name').focus();
  console.log('#2 invalid field: blurred', blurred, '| focused', await look());
  await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });

  // nav flip only below 1200
  for (const w of [1100, 1440]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    console.log(`#6 nav ${w}:`, JSON.stringify(await p.evaluate(() => {
      const subs = [...document.querySelectorAll('.main-nav__list > .nav-item > .nav-sub')];
      const last = subs[subs.length - 1];
      return { lastSubLeft: getComputedStyle(last).left, overflow: document.documentElement.scrollWidth - innerWidth };
    })));
  }
} finally {
  await browser.close();
}
