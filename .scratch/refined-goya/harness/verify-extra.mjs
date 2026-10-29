// Follow-ups: search overlay submit target (waiting for navigation), and the cart page's back link text.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4323';
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  await p.locator('[data-search-open]').click();
  await p.waitForTimeout(600);
  await p.keyboard.type('nike');
  const nav = await Promise.all([p.waitForURL((u) => u.search.includes('s='), { timeout: 30000 }).then(() => 'navigated').catch(() => 'no navigation'), p.keyboard.press('Enter')]);
  await p.waitForLoadState('load');
  console.log('overlay submit:', nav[0], p.url().replace(BASE, ''), '| h1:', (await p.locator('h1').first().textContent()).trim(), '| cards:', await p.locator('.product-card').count());

  await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
  await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const back = await p.evaluate(() => [...document.querySelectorAll('main a, .cart-page a')].map((a) => a.textContent.trim()).filter((t) => /áfram|Continue/i.test(t)));
  console.log('cart back link:', JSON.stringify(back));
  await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });
  console.log('cart emptied:', (await (await p.request.get(`${BASE}/api/cart`)).json()).items_count);
} finally {
  await browser.close();
}
