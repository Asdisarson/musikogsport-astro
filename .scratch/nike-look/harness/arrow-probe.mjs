// Home carousel arrows: opacity at rest and on hover (desktop), on a touch phone, and whether disabled arrows show.
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
const browser = await chromium.launch();
const state = (page) => page.evaluate(() => [...document.querySelectorAll('.product-row:not(.product-row--related) .product-row__arrow')].slice(0, 2).map((b) => ({
  cls: b.className.replace('product-row__arrow ', ''), disabled: b.disabled, display: getComputedStyle(b).display, opacity: getComputedStyle(b).opacity,
  right: Math.round(b.getBoundingClientRect().right), vw: innerWidth,
})));
try {
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desk.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 });
  console.log('desktop rest ', JSON.stringify(await state(desk)));
  await desk.locator('.product-row:not(.product-row--related)').first().hover();
  await desk.waitForTimeout(400);
  console.log('desktop hover', JSON.stringify(await state(desk)));
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 });
  console.log('phone        ', JSON.stringify(await state(phone)));
} finally {
  await browser.close();
}
