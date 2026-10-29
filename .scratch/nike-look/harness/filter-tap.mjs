// Investigate: tapping a filter option in the phone panel. What is at the tap point, and does it navigate?
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/voruflokkur/skor/`, { waitUntil: 'load' });
  await p.locator('[data-filters-open]').tap();
  await p.waitForTimeout(500);
  const group = p.locator('.filter-group').first();
  if (!(await group.evaluate((d) => d.open))) await group.locator('summary').tap();
  const opt = group.locator('.filter-option__link').first();
  const info = await opt.evaluate((a) => {
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const row = a.closest('.filter-option__row');
    const t = row?.querySelector('.filter-option__toggle');
    return {
      href: a.getAttribute('href'), text: a.textContent.trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      hitAtCenter: hit === a || a.contains(hit) ? 'the link' : (hit?.className || hit?.tagName),
      toggle: t ? [Math.round(t.getBoundingClientRect().left), Math.round(t.getBoundingClientRect().width), Math.round(t.getBoundingClientRect().height)] : null,
    };
  });
  console.log('option', JSON.stringify(info));
  const [nav] = await Promise.all([p.waitForURL((u) => u.href !== `${BASE}/voruflokkur/skor/`, { timeout: 20000 }).then(() => 'navigated').catch(() => 'no navigation'), opt.tap()]);
  await p.waitForLoadState('load');
  console.log('after tap:', nav, p.url().replace(BASE, ''), '| Endursetja links:', await p.locator('.archive-filters__reset').count(), '| checked:', await p.locator('.filter-option__link[aria-checked="true"]').count());
} finally {
  await browser.close();
}
