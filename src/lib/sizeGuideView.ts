// Draws the /staerdir/ size charts in the browser: the product page's popup (SizeGuide.astro) and the /staerdir/
// page itself (pages/staerdir.astro) share this, so they look the same. It reads the WordPress content's `<h4>`
// headings and tables as cell text and rebuilds each table twice: wide (sizes across, the measure names pinned on the
// left) and sideways (sizes down the side). A chart shows wide where it fits its box and sideways where it doesn't,
// measured again whenever the box changes size. Several charts get pill tabs (the popup) or are stacked, each under its
// heading and gathered by audience, with the same pills on top as links that jump to each audience (the page); one
// chart gets its heading. Styles:
// `.sizeguide__*` in global.css.
import { audienceGroups, chartFromRows, sectionLabel, sectionSlug, sizeIndex, transpose, type Chart } from './sizeGuide';

export interface Section {
  heading: string;
  charts: Chart[];
}

const cellText = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

const readChart = (table: HTMLTableElement) => chartFromRows([...table.rows].map((tr) => [...tr.cells].map(cellText)));

/** The page's charts: each <h4> with the tables up to the next heading. */
export function splitSections(content: Element): Section[] {
  const out: Section[] = [];
  for (const h of content.querySelectorAll('h4')) {
    const charts: Chart[] = [];
    for (let n = h.nextElementSibling; n && !/^H[1-4]$/.test(n.tagName); n = n.nextElementSibling) {
      const found = n.matches('table') ? [n as HTMLTableElement] : [...n.querySelectorAll('table')];
      charts.push(...found.map(readChart).filter((c) => c.rows.length > 0));
    }
    if (charts.length) out.push({ heading: cellText(h), charts });
  }
  return out;
}

/** A table from cell text: the first row as an ink header, the first cell of each row as its row header. `mark`:
 *  the chosen size's column (wide) or row (sideways), -1 for none. */
function buildTable(rows: string[][], mark: { column?: number; row?: number }): HTMLTableElement {
  const table = document.createElement('table');
  rows.forEach((cells, r) => {
    const tr = (r === 0 ? table.createTHead() : table.tBodies[0] ?? table.createTBody()).insertRow();
    if (r > 0 && r === mark.row) tr.className = 'is-chosen';
    cells.forEach((text, c) => {
      const cell = document.createElement(r === 0 || c === 0 ? 'th' : 'td');
      if (r === 0) cell.scope = 'col';
      else if (c === 0) cell.scope = 'row';
      if (c > 0 && c === mark.column) cell.classList.add('is-chosen');
      cell.textContent = text;
      tr.append(cell);
    });
  });
  return table;
}

function buildChart(chart: Chart, chosen: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sizeguide__chart';
  if (chart.caption) {
    const cap = document.createElement('p');
    cap.className = 'sizeguide__caption';
    cap.textContent = chart.caption;
    wrap.append(cap);
  }
  const at = sizeIndex(chart.rows[0] ?? [], chosen);
  const wide = document.createElement('div');
  wide.className = 'sizeguide__scroll sizeguide__wide';
  wide.append(buildTable(chart.rows, { column: at }));
  const tall = document.createElement('div');
  tall.className = 'sizeguide__scroll sizeguide__tall';
  tall.append(buildTable(transpose(chart.rows), { row: at }));
  wrap.append(wide, tall);
  return wrap;
}

/** Wires a tab list and a chart body (the popup's or the page's; `idPrefix` keeps their ids apart). `render` shows
 *  the given charts with `chosen` (a size name, '' for none) highlighted: as tabs with the first one selected, or,
 *  `stacked`, all of them down the page. */
export function mountSizeGuide(tabs: HTMLElement, body: HTMLElement, idPrefix = 'sizeguide') {
  /** Each shown chart wide when its wide table fits the body, else sideways. */
  function fitCharts() {
    body.querySelectorAll<HTMLElement>('.sizeguide__panel:not([hidden]) .sizeguide__chart').forEach((chart) => {
      const wide = chart.querySelector<HTMLElement>('.sizeguide__wide');
      if (!wide) return;
      chart.dataset.layout = 'wide';
      chart.dataset.layout = wide.scrollWidth > wide.clientWidth + 1 ? 'tall' : 'wide';
    });
  }
  new ResizeObserver(fitCharts).observe(body);

  const tabList = () => [...tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

  function select(index: number, focus = false) {
    tabList().forEach((t, i) => {
      const on = i === index;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    body.querySelectorAll<HTMLElement>('.sizeguide__panel').forEach((p, i) => (p.hidden = i !== index));
    fitCharts();
  }

  // arrow keys, Home and End move between the tabs (WAI-ARIA tabs, automatic activation)
  tabs.addEventListener('keydown', (e) => {
    const list = tabList();
    if (!list.length) return; // the stacked page's pills are plain links
    const at = Math.max(0, list.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    const to =
      e.key === 'ArrowRight' ? (at + 1) % list.length : e.key === 'ArrowLeft' ? (at - 1 + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(to, true);
  });

  function buildPanel(s: Section, id: string, chosen: string, headingTag: 'h3' | 'h5' | null): HTMLElement {
    const panel = document.createElement('section');
    panel.className = 'sizeguide__panel';
    panel.id = id;
    if (headingTag) {
      const h = document.createElement(headingTag);
      h.className = 'sizeguide__heading';
      h.textContent = sectionLabel(s.heading);
      panel.append(h);
    }
    panel.append(...s.charts.map((c) => buildChart(c, chosen)));
    return panel;
  }

  /** The popup: several charts behind pill tabs, the first one selected; one chart under its heading. */
  function renderTabs(shown: Section[], chosen: string) {
    const many = shown.length > 1;
    tabs.hidden = !many;
    tabs.replaceChildren(
      ...(many ? shown : []).map((s, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sizeguide__tab';
        tab.id = `${idPrefix}-tab-${i}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `${idPrefix}-panel-${i}`);
        tab.textContent = sectionLabel(s.heading);
        tab.addEventListener('click', () => select(i));
        return tab;
      }),
    );
    body.replaceChildren(
      ...shown.map((s, i) => {
        const panel = buildPanel(s, `${idPrefix}-panel-${i}`, chosen, many ? null : 'h5');
        if (many) {
          panel.setAttribute('role', 'tabpanel');
          panel.setAttribute('aria-labelledby', `${idPrefix}-tab-${i}`);
        }
        return panel;
      }),
    );
    if (many) select(0);
    else fitCharts();
  }

  /** The page: every chart down the page under its heading, gathered by audience (Börn, Karlar, Konur), and the
   *  pills an overview of links to each audience. A chart's id is its heading's slug, so a link to one chart
   *  (/staerdir/#konur-efri-likami) survives the charts being reordered. */
  function renderStacked(shown: Section[], chosen: string) {
    const groups = audienceGroups(shown.map((s) => s.heading));
    const slugs = shown.map((s) => sectionSlug(s.heading));
    const taken = new Set<string>(groups.map((g) => g.id));
    const panelId = (i: number) => (slugs[i] && !taken.has(slugs[i]) && slugs.indexOf(slugs[i]) === i ? slugs[i] : `${idPrefix}-panel-${i}`);
    const titled = groups.length > 1;
    tabs.hidden = !titled;
    tabs.replaceChildren(
      ...(titled ? groups : []).map((g) => {
        const link = document.createElement('a');
        link.className = 'sizeguide__tab';
        link.href = `#${g.id}`;
        link.textContent = g.label;
        return link;
      }),
    );
    body.replaceChildren(
      ...groups.map((g) => {
        const group = document.createElement('section');
        group.className = 'sizeguide__group';
        group.id = g.id;
        if (titled) {
          const h = document.createElement('h2');
          h.className = 'sizeguide__group-title';
          h.textContent = g.label;
          group.append(h);
        }
        group.append(...g.indices.map((i) => buildPanel(shown[i], panelId(i), chosen, 'h3')));
        return group;
      }),
    );
    fitCharts();
  }

  function render(shown: Section[], chosen = '', { stacked = false } = {}) {
    if (stacked) renderStacked(shown, chosen);
    else renderTabs(shown, chosen);
  }

  return { render };
}
