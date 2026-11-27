// /staerdir/ shows the WordPress size tables (`.sizeguide-page__source`) unless the page script has drawn the charts
// over them. A script that never loads (a deploy removed its file, or Cloudflare still serves the previous HTML) must
// leave the tables readable; with JavaScript off nothing hides them either. The page is not run in a test, so the
// classes the page script and the CSS share are pinned here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import page from '../routes/sizes.astro?raw';

// read from disk: vitest returns an empty string for a stylesheet imported with ?raw
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

// the rules whose body hides the source, with comments taken out first
const hidingSelectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^{}]*)\}/g)]
  .filter(([, sel, body]) => sel.includes('sizeguide-page__source') && /display\s*:\s*none/.test(body))
  .map(([, sel]) => sel.trim());

// the module script, from its first line to the end of the file
const script = page.slice(page.indexOf('<script>'));

describe('/staerdir/ WordPress source', () => {
  it('is visible by default: only a pending or drawn page hides it', () => {
    expect(hidingSelectors.length).toBeGreaterThan(0);
    for (const sel of hidingSelectors) expect(sel).toMatch(/\.is-(pending|drawn)\b/);
  });

  it('is held back before the page script runs, so no raw table flashes before its chart', () => {
    // an inline script at the top of the page, ahead of the source, adds the pending class
    const pending = page.indexOf("classList.add('is-pending')");
    expect(pending).toBeGreaterThan(-1);
    expect(pending).toBeLessThan(page.indexOf('data-sizeguide-source'));
    expect(page.slice(0, pending)).toMatch(/<script is:inline>/);
  });

  it('is released when the page script cannot run: the pending class is removed once the document has loaded', () => {
    // a module script runs before DOMContentLoaded, so this only matters when that script never ran
    expect(page).toMatch(/addEventListener\('DOMContentLoaded'[\s\S]*?classList\.remove\('is-pending'\)/);
  });

  it('marks the page drawn only after the charts are rendered, and releases it on the no-chart path', () => {
    const drawn = script.indexOf("classList.add('is-drawn')");
    expect(drawn).toBeGreaterThan(script.indexOf('render(sections'));
    expect(drawn).toBeLessThan(script.indexOf('} catch'));
    expect(script).toMatch(/classList\.remove\('is-pending'\)/);
  });

  it('has no noscript override, since the source is visible unless drawn', () => {
    expect(page).not.toMatch(/<noscript>/);
    expect(page).not.toMatch(/is-plain/);
  });
});
