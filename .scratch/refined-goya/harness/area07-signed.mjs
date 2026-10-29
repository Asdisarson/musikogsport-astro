// Area 07 signed-in run, LOCAL preview only (never production, never Straumur).
// usage:
//   node area07-signed.mjs --smoke [--set area07-signed]                        sign in, place ONE bacs order, then shoot
//   node area07-signed.mjs --order <id> --thanks <path> [--set area07-signed]   sign in and shoot only
// The disposable test customer's login comes from CRED (outside the repo); the password is never printed.
// Guard: any /api/checkout request whose payment_method is not 'bacs' is aborted (Straumur's key is LIVE).
// The smoke order's billing email is smoke-test@example.invalid, so smoke-cleanup.php accepts it.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = 'http://127.0.0.1:4323';
const CRED = '/Users/cy/.claude/jobs/3b134443/tmp/area07-cred.json';
const SET = arg('set', 'area07-signed');
const WIDTHS = arg('widths', '1440,390,360').split(',').map(Number);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots', SET);
mkdirSync(OUT, { recursive: true });
const cred = JSON.parse(readFileSync(CRED, 'utf8'));
const viewport = (w) => (w >= 768 ? { viewport: { width: w, height: 900 }, deviceScaleFactor: 1 } : { viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

async function guard(page) {
  await page.route('**/api/checkout', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.payment_method !== 'bacs') {
      console.log('GUARD: aborted checkout with payment_method', body.payment_method);
      return route.abort();
    }
    console.log('checkout request: payment_method', body.payment_method);
    return route.continue();
  });
}

async function signIn(page) {
  await page.goto(`${BASE}/min-sida/`, { waitUntil: 'load' });
  const box = page.locator('.login-box');
  await box.locator('input[name="username"]').fill(cred.login);
  await box.locator('input[name="password"]').fill(cred.password);
  await Promise.all([page.waitForResponse((r) => r.url().includes('/api/account/login'), { timeout: 30000 }), box.locator('button[type="submit"]').click()]);
  const ok = await page.locator('.account__nav').waitFor({ timeout: 30000 }).then(() => true, () => false);
  if (!ok) {
    const names = (await page.context().cookies()).map((c) => c.name);
    throw new Error(`sign-in failed: ${page.url().replace(BASE, '')} cookies=${names.join(',')}`);
  }
  console.log('signed in as', cred.login, '(id', cred.id + ')');
}

async function smoke(page) {
  await page.evaluate(async () => fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 257264, quantity: 1 }) }));
  await page.goto(`${BASE}/gera-upp/`, { waitUntil: 'load' });
  await page.locator('#billing_first_name').waitFor();
  const fill = async (id, v) => page.locator(`#${id}`).fill(v);
  await fill('billing_first_name', 'Prufa');
  await fill('billing_last_name', 'Smoke');
  await fill('billing_kennitala', '0101302989');
  await fill('billing_address_1', 'Dalshraun 10');
  await fill('billing_postcode', '220');
  await fill('billing_city', 'Hafnarfjörður');
  await fill('billing_phone', '5552887');
  await fill('billing_email', 'smoke-test@example.invalid');
  await page.locator('.checkout-extra .form-row-check input').check();
  await fill('order_comments', 'refined-goya signed-in smoke test, delete me');
  await page.locator('input[name="shipping_method"]').first().waitFor({ timeout: 90000 });
  const rates = await page.locator('.ship-methods label').allTextContents();
  console.log('rates:', JSON.stringify(rates.map((r) => r.trim())));
  const pick = rates.findIndex((r) => /sækja|verslun/i.test(r));
  const idx = pick >= 0 ? pick : rates.findIndex((r) => !/box/i.test(r));
  const rate = page.locator('input[name="shipping_method"]').nth(idx);
  if (!(await rate.isChecked())) await rate.click();
  await page.waitForFunction((i) => document.querySelectorAll('input[name="shipping_method"]')[i]?.checked, idx, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.locator('.pay-method', { hasText: 'Bankamillifærsla' }).locator('input').check();
  await page.locator('.checkout-terms input').check();
  const sel = await page.evaluate(() => document.querySelector('.pay-method[data-selected]')?.textContent.trim());
  await page.screenshot({ path: join(OUT, 'checkout-filled-1440-full.jpg'), fullPage: true, type: 'jpeg', quality: 62 });
  if (!/Bankamillifærsla/.test(sel ?? '')) throw new Error('bacs not selected; refusing to place the order');
  await Promise.all([page.waitForURL(/order-received\/\d+/, { timeout: 90000 }), page.locator('.checkout__place').click()]);
  const thanks = page.url().replace(BASE, '');
  const id = Number(thanks.match(/order-received\/(\d+)/)[1]);
  console.log('landed:', thanks.replace(/key=[^&]+/, 'key=…'));
  console.log('cart after:', (await (await page.request.get(`${BASE}/api/cart`)).json()).items_count);
  return { id, thanks };
}

// Runs in the page: overflow + offenders, small tap targets on phones, and the area-07 presentation probes.
function probe(narrow) {
  const vw = window.innerWidth;
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (offenders.length >= 6) break;
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && r.left < vw && visible(el) && !el.closest('[inert],[aria-hidden="true"],dialog:not([open])')) offenders.push(`${sel(el)} right=${Math.round(r.right)}`);
  }
  const small = [];
  if (narrow) for (const el of document.querySelectorAll('.account a[href], .account button, .account input:not([type=hidden])')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p,li,td,address')) continue;
    if (r.height < 44 || r.width < 44) small.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.value || '').trim().slice(0, 18)}"`);
  }
  const cs = (q, ...props) => { const el = document.querySelector(q); if (!el) return null; const s = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, s[p]])); };
  const rect = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const tfoot = [...document.querySelectorAll('.account__content .review-table tfoot tr, .thankyou .review-table tfoot tr')].map((tr) => tr.textContent.trim().replace(/\s+/g, ' ').slice(0, 60));
  const totalRow = document.querySelector('.review-table__total-row');
  const prev = totalRow?.previousElementSibling?.querySelector('th,td');
  const fields = [...document.querySelectorAll('.account-form .form-row')].map((r) => `${r.querySelector('input')?.id}:${rect(r).join(',')}`);
  const rowGaps = [];
  const rows = [...document.querySelectorAll('.account-form .form-row')];
  for (let i = 1; i < rows.length; i++) { const a = rows[i - 1].getBoundingClientRect(), b = rows[i].getBoundingClientRect(); if (b.top > a.bottom - 1) rowGaps.push(Math.round(b.top - a.bottom)); }
  return {
    overflowX: document.documentElement.scrollWidth - vw,
    offenders,
    smallTargets: narrow ? small : null,
    h1: document.querySelector('h1')?.textContent.trim(),
    nav: [...document.querySelectorAll('.account__nav li')].map((li) => rect(li).join(',')),
    navCurrent: document.querySelector('.account__nav [aria-current]')?.textContent.trim() ?? null,
    contentBox: document.querySelector('.account__content') ? rect(document.querySelector('.account__content')) : null,
    lead: document.querySelector('.account-order__lead')?.textContent.trim().replace(/\s+/g, ' ') ?? null,
    statusPill: cs('.order-status, .thankyou__status', 'color', 'borderTopColor', 'borderRadius'),
    thead: cs('.review-table thead th', 'textAlign', 'borderBottomWidth', 'borderBottomColor'),
    tfoot,
    total: cs('.review-table__total-row strong', 'fontSize', 'fontWeight'),
    ruleAboveTotal: prev ? getComputedStyle(prev).borderBottomColor : null,
    ordersTable: cs('.account-orders', 'display'),
    ordersRows: [...document.querySelectorAll('.account-orders tbody tr')].map((tr) => rect(tr).join(',')),
    statusCell: cs('.account-orders td[data-title="Staða"]', 'color', 'fontWeight'),
    fields, rowGaps,
  };
}

const browser = await chromium.launch();
const metricsPath = join(OUT, 'metrics.json');
const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')) : {};
try {
  let order = arg('order', null) ? { id: Number(arg('order')), thanks: arg('thanks') } : null;
  if (process.argv.includes('--smoke')) {
    if (order) throw new Error('pass --smoke or --order, not both');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'is-IS' });
    const p = await ctx.newPage();
    await guard(p);
    await signIn(p);
    order = await smoke(p);
    await ctx.close();
    writeFileSync(join(OUT, 'order.json'), JSON.stringify(order));
  }
  if (!order) throw new Error('no order: pass --smoke or --order <id> --thanks <path>');
  const PAGES = [
    ['thankyou', order.thanks],
    ['dashboard', '/min-sida/'],
    ['orders', '/min-sida/orders/'],
    ['view-order', `/min-sida/view-order/${order.id}/`],
    ['addresses', '/min-sida/edit-address/'],
    ['edit-billing', '/min-sida/edit-address/billing/'],
    ['edit-shipping', '/min-sida/edit-address/shipping/'],
    ['edit-account', '/min-sida/edit-account/'],
  ];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ ...viewport(w), locale: 'is-IS' });
    const p = await ctx.newPage();
    await guard(p);
    await signIn(p);
    for (const [name, path] of PAGES) {
      const res = await p.goto(BASE + path, { waitUntil: 'load', timeout: 120000 });
      await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await p.screenshot({ path: join(OUT, `${name}-${w}-fold.png`) });
      await p.screenshot({ path: join(OUT, `${name}-${w}-full.jpg`), fullPage: true, type: 'jpeg', quality: 62 });
      const m = await p.evaluate(probe, w < 768);
      metrics[`${name}@${w}`] = { http: res?.status() ?? null, ...m };
      console.log(`${SET} ${name} ${w} → ${res?.status()} overflow=${m.overflowX}${m.offenders.length ? ' ' + m.offenders.join(' | ') : ''}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 1));
}
