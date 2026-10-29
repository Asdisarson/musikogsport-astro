// Area 5 probe: contact icons render glyphs, contact form fields still serialise, the login eye toggles and is 44px,
// the lost link is a 44px target, and the phone 404 keeps its buttons off the screen edge.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4323';
const browser = await chromium.launch();
const size = (b) => (b ? `${Math.round(b.width)}x${Math.round(b.height)}` : null);
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/hafa-samband/`, { waitUntil: 'load' });
  const c = await p.evaluate(() => ({
    icons: [...document.querySelectorAll('.vc-icon')].map((i) => (i.querySelector('svg') ? 'svg' : 'empty')),
    formKeys: [...new FormData(document.querySelector('[data-contact-form]')).keys()],
    pairCols: getComputedStyle(document.querySelector('.contact-form__pair')).gridTemplateColumns.split(' ').length,
    mapH: Math.round(document.querySelector('.vc-map').getBoundingClientRect().height),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  console.log('contact 1440:', JSON.stringify(c));

  await p.goto(`${BASE}/min-sida/`, { waitUntil: 'load' });
  const eye = p.locator('.login-box .login-form__eye');
  const before = await p.locator('.login-box input[name="password"], .login-box #password').first().getAttribute('type');
  await eye.click();
  const after = await p.locator('.login-box input[name="password"], .login-box #password').first().getAttribute('type');
  console.log('login 1440: eye', size(await eye.boundingBox()), '| type', before, '->', after, '| lost', size(await p.locator('.login-box .login-form__lost').boundingBox()));

  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.goto(`${BASE}/min-sida/`, { waitUntil: 'load' });
  const lg = await m.evaluate(() => {
    const f = document.querySelector('.login-box form, .login-box').getBoundingClientRect();
    const row = document.querySelector('.login-box .login-form__row');
    const kids = [...row.children].map((k) => Math.round(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2));
    return { left: Math.round(f.left), right: Math.round(innerWidth - f.right), rowOneLine: new Set(kids).size === 1 };
  });
  console.log('login 390:', JSON.stringify(lg));
  await m.goto(`${BASE}/ekki-til-xyz/`, { waitUntil: 'load' });
  const nf = await m.evaluate(() => [...document.querySelectorAll('.notfound .btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(innerWidth - r.right), Math.round(r.height)]; }));
  console.log('404 390: buttons [left, right, height]', JSON.stringify(nf), '| status', (await m.request.get(`${BASE}/ekki-til-xyz/`)).status());
} finally {
  await browser.close();
}
