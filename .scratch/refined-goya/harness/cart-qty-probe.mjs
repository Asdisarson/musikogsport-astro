// Area 4 probe: a qty-2 cart line shows "/ stk." unit price; the boxed stepper's − brings it to 1 and hides it.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4323';
const OUT = process.argv[2] ?? 'shots/smoke';
const browser = await chromium.launch();
try {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 1 });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/karfa/`, { waitUntil: 'load' });
    await p.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 2 }) }));
    await p.reload({ waitUntil: 'load' });
    await p.locator('.cart-line').waitFor();
    const info = await p.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? `${Math.round(b.width)}x${Math.round(b.height)}` : null; };
      const order = ['.cart-lines', '.cart-totals', '.cart-totals__coupon'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top));
      return { unit: document.querySelector('.cart-line__price')?.textContent, stepper: r('.cart-line .line-qty'), minus: r('.cart-line .line-qty button'), remove: r('.cart-line .line-remove'), tops: order, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    console.log(vp.width, 'qty 2:', JSON.stringify(info));
    const line = await p.locator('.cart-line').boundingBox();
    await p.screenshot({ path: `${OUT}/cart-qty2-${vp.width}.png`, clip: { x: 0, y: line.y - 10, width: vp.width, height: line.height + 20 } });
    await p.locator('.cart-line .line-qty button[aria-label="Fækka"]').click();
    await p.waitForFunction(() => document.querySelector('.line-qty__n')?.textContent === '1', null, { timeout: 30000 });
    console.log(vp.width, 'after −: qty 1, unit price shown:', await p.locator('.cart-line__price').count());
    await p.evaluate(async () => { const c = await (await fetch('/api/cart')).json(); for (const i of c.items ?? []) await fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) }); });
    await ctx.close();
  }
} finally {
  await browser.close();
}
