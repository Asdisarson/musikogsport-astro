import { describe, expect, it } from 'vitest';
import { splitSections } from './sizeGuideView';

// splitSections reads the WordPress content as DOM, but the vitest run has no DOM library, so these tests build a
// small stand-in with the few members it uses: tag names, children and parents, text, tables' rows and cells, and
// querySelectorAll over plain tag names in document order.
type Kid = FakeEl | string;

class FakeEl {
  parentElement: FakeEl | null = null;
  readonly children: FakeEl[] = [];
  readonly tagName: string;
  private readonly text: string;

  constructor(tag: string, ...kids: Kid[]) {
    this.tagName = tag.toUpperCase();
    this.text = kids.filter((k): k is string => typeof k === 'string').join('');
    for (const k of kids) {
      if (k instanceof FakeEl) {
        k.parentElement = this;
        this.children.push(k);
      }
    }
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }

  get nextElementSibling(): FakeEl | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get rows(): FakeEl[] {
    return this.descendants().filter((e) => e.tagName === 'TR');
  }

  get cells(): FakeEl[] {
    return this.children.filter((e) => e.tagName === 'TD' || e.tagName === 'TH');
  }

  matches(selector: string): boolean {
    return this.tagName === selector.toUpperCase();
  }

  descendants(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }

  querySelectorAll(selector: string): FakeEl[] {
    const tags = selector.split(',').map((s) => s.trim().toUpperCase());
    return this.descendants().filter((e) => tags.includes(e.tagName));
  }
}

const div = (...kids: Kid[]) => new FakeEl('div', ...kids);
const h4 = (text: string) => new FakeEl('h4', text);
const h2 = (text: string) => new FakeEl('h2', text);
const tr = (...cells: string[]) => new FakeEl('tr', ...cells.map((c) => new FakeEl('td', c)));
// A chart whose first body row carries `label`, so each test can tell the charts apart.
const table = (label: string) => new FakeEl('table', tr('Stærð', label), tr('Brjóst', '90'));
const content = (...kids: FakeEl[]) => new FakeEl('div', ...kids) as unknown as Element;

/** Each section as its heading and the label of each chart it holds. */
const outline = (el: Element) =>
  splitSections(el).map((s) => [s.heading, s.charts.map((c) => c.rows[0][1])]);

describe('splitSections: each table belongs to the nearest heading before it', () => {
  it('keeps a later heading wrapped in a div from taking the earlier heading\'s tables', () => {
    expect(outline(content(h4('KARLAR'), table('K'), div(h4('KONUR'), table('W'))))).toEqual([
      ['KARLAR', ['K']],
      ['KONUR', ['W']],
    ]);
  });

  it('finds a heading wrapped in a div, with its table in a separate element after it', () => {
    expect(outline(content(div(h4('KARLAR')), div(table('K'))))).toEqual([['KARLAR', ['K']]]);
  });

  it('keeps a table in a wrapper after its heading with that heading', () => {
    expect(outline(content(h4('KARLAR'), div(table('K'), table('L'))))).toEqual([['KARLAR', ['K', 'L']]]);
  });

  it('ends a section at a heading of a lower level, wrapped or not', () => {
    expect(outline(content(h4('KARLAR'), table('K'), h2('Annað'), table('X')))).toEqual([['KARLAR', ['K']]]);
    expect(outline(content(h4('KARLAR'), table('K'), div(h2('Annað'), table('X'))))).toEqual([['KARLAR', ['K']]]);
  });

  it('gives a table before any heading to no section', () => {
    expect(outline(content(table('X'), h4('KARLAR'), table('K')))).toEqual([['KARLAR', ['K']]]);
  });

  it('gives a heading with no table no section, and drops a table with no rows', () => {
    expect(outline(content(h4('A'), h4('B'), new FakeEl('table'), table('K')))).toEqual([['B', ['K']]]);
  });
});
