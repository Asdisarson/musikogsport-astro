// Horizontal page overflow per base URL and width: node hscroll.mjs <base> <path> <w1,w2,...>
import { chromium } from 'playwright';

const [base, path = '/', widths = '992,1024'] = process.argv.slice(2);
const browser = await chromium.launch();
try {
  for (const w of widths.split(',').map(Number)) {
    const p = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(base + path, { waitUntil: 'load' });
    console.log(base, path, w, 'overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    await p.close();
  }
} finally {
  await browser.close();
}
