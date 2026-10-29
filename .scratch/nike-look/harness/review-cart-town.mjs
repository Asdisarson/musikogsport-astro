// N-2: after a shipping calc with postcode 220 and no town, the cart's "Sending til" line and the reopened town
// field show no '&#8211;' entity. One HOKA variation in a LOCAL Store API cart (no order), emptied afterwards.
// usage: node review-cart-town.mjs <base>
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:4323'] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('local only');
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.route('**/api/checkout', (route) => route.abort());
  await p.goto(base + '/karfa/', { waitUntil: 'load' });
  await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
  await p.goto(base + '/karfa/', { waitUntil: 'load' });
  await p.locator('.cart-line').first().waitFor({ timeout: 30000 });
  await p.locator('.ship-calc__toggle').click();
  await p.locator('.ship-calc__form input[aria-label="Borg / Bær"]').fill('');
  await p.locator('.ship-calc__form input[aria-label="Póstnúmer"]').fill('220');
  await p.locator('.ship-calc__form button[type="submit"]').click();
  await p.locator('.ship-calc__dest').waitFor({ timeout: 90000 });
  const dest = (await p.locator('.ship-calc__dest').first().textContent()).trim();
  const apiCity = await p.evaluate(async () => (await (await fetch('/api/cart')).json()).shipping_address?.city);
  // a fresh page load: the town field is pre-filled from the cart
  await p.goto(base + '/karfa/', { waitUntil: 'load' });
  await p.locator('.ship-calc__dest').first().waitFor({ timeout: 30000 });
  const dest2 = (await p.locator('.ship-calc__dest').first().textContent()).trim();
  await p.locator('.ship-calc__toggle').first().click();
  const town = await p.locator('.ship-calc__form input[aria-label="Borg / Bær"]').first().inputValue();
  console.log(`N-2 Store API city=${JSON.stringify(apiCity)} | after calc: ${JSON.stringify(dest)} | reload: ${JSON.stringify(dest2)} | town field: ${JSON.stringify(town)} | entity shown: ${/&#|–/.test(dest + dest2 + town)}`);
  await p.evaluate(async () => {
    const cart = await (await fetch('/api/cart')).json();
    for (const item of cart.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: item.key }) });
  });
  console.log('cart emptied:', (await (await p.request.get(base + '/api/cart')).json()).items_count);
  await ctx.close();
} finally {
  await browser.close();
}
