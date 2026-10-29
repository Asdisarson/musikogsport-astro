// Area 4 smoke: one LOCAL bacs order through the real checkout UI on the production preview.
// Guard: any /api/checkout request whose payment_method is not 'bacs' is aborted (Straumur's key is LIVE).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4323';
const OUT = process.argv[2] ?? 'shots/smoke';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.route('**/api/checkout', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.payment_method !== 'bacs') {
      console.log('GUARD: aborted checkout with payment_method', body.payment_method);
      return route.abort();
    }
    console.log('checkout request: payment_method', body.payment_method, '| kennitala', body.extensions?.mos?.kennitala, '| skiptimidi', body.extensions?.mos?.skiptimidi);
    return route.continue();
  });
  await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
  await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
  await p.goto(`${BASE}/gera-upp/`, { waitUntil: 'load' });
  await p.locator('#billing_first_name').waitFor();
  const fill = async (id, v) => p.locator(`#${id}`).fill(v);
  await fill('billing_first_name', 'Prufa');
  await fill('billing_last_name', 'Smoke');
  await fill('billing_kennitala', '0101302989');
  await fill('billing_address_1', 'Dalshraun 10');
  await fill('billing_postcode', '220');
  await fill('billing_city', 'Hafnarfjörður');
  await fill('billing_phone', '5552887');
  await fill('billing_email', 'smoke-test@example.invalid');
  await p.locator('.checkout-extra .form-row-check input').check();
  await fill('order_comments', 'refined-goya smoke test, delete me');
  // wait for Pósturinn rates in the review column
  await p.locator('input[name="shipping_method"]').first().waitFor({ timeout: 90000 });
  const rates = await p.locator('.ship-methods label').allTextContents();
  console.log('rates:', JSON.stringify(rates.map((r) => r.trim())));
  const pick = rates.findIndex((r) => /sækja|verslun/i.test(r));
  const idx = pick >= 0 ? pick : rates.findIndex((r) => !/box/i.test(r));
  // controlled radio: it turns checked only once the cart store confirms the rate
  const rate = p.locator('input[name="shipping_method"]').nth(idx);
  if (!(await rate.isChecked())) await rate.click();
  await p.waitForFunction((i) => document.querySelectorAll('input[name="shipping_method"]')[i]?.checked, idx, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.locator('.pay-method', { hasText: 'Bankamillifærsla' }).locator('input').check();
  await p.locator('.checkout-terms input').check();
  const sel = await p.evaluate(() => {
    const li = document.querySelector('.pay-method[data-selected]');
    return { selected: li?.textContent.trim(), ring: li ? getComputedStyle(li).boxShadow : null, total: document.querySelector('.review-table__total-row strong')?.textContent };
  });
  console.log('before Panta:', JSON.stringify(sel));
  await p.screenshot({ path: `${OUT}/checkout-filled-1440.png`, fullPage: true });
  if (!/Bankamillifærsla/.test(sel.selected ?? '')) throw new Error('bacs not selected; refusing to place the order');
  await Promise.all([p.waitForURL(/order-received\/\d+/, { timeout: 90000 }), p.locator('.checkout__place').click()]);
  console.log('landed:', p.url().replace(BASE, ''));
  await p.waitForLoadState('load');
  await p.screenshot({ path: `${OUT}/order-received-1440.png` });
  console.log('cart after:', (await (await p.request.get(`${BASE}/api/cart`)).json()).items_count);
} finally {
  await browser.close();
}
