import { describe, expect, it } from 'vitest';
import { safeHref, safeIframeSrc, withSafeHrefs } from './safeUrl';

describe('safeHref', () => {
  it('keeps relative links, fragments and queries', () => {
    for (const ok of ['/voruflokkur/skor/', '#', '#top', '?s=hoka', 'skilmalar/']) expect(safeHref(ok)).toBe(ok);
  });

  it('keeps http(s), mailto and tel links', () => {
    for (const ok of ['https://www.instagram.com/musikogsport/', 'http://example.is/', 'mailto:verslun@musikogsport.is', 'tel:+3545553110', '//maps.google.com/x'])
      expect(safeHref(ok)).toBe(ok);
  });

  it('replaces script-capable or unknown schemes with #, however they are disguised', () => {
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd'])
      expect(safeHref(bad)).toBe('#');
  });

  it('refuses backslash forms that browsers read as another host (MU-07)', () => {
    // new URL('/\\evil.example', base) is https://evil.example/: the parser reads a backslash as "/".
    for (const bad of ['/\\evil.example', '\\\\evil.example', '\\/evil.example', '\\evil.example', '/\t\\evil.example', '/\n\\evil.example/x', ' /\\evil.example'])
      expect(safeHref(bad)).toBe('#');
  });

  it('keeps a backslash later in a path (same origin)', () => {
    expect(safeHref('/a\\b/')).toBe('/a\\b/');
  });

  it('turns empty or non-string values into #', () => {
    expect(safeHref('')).toBe('#');
    expect(safeHref(undefined)).toBe('#');
    expect(safeHref(null)).toBe('#');
    expect(safeHref(42)).toBe('#');
  });
});

describe('safeIframeSrc', () => {
  it('allows absolute http(s) embeds only', () => {
    const map = 'https://www.google.com/maps/embed?pb=!1m18!1m12';
    expect(safeIframeSrc(map)).toBe(map);
    expect(safeIframeSrc('http://maps.example/embed')).toBe('http://maps.example/embed');
  });

  it('refuses script, data and relative sources', () => {
    for (const bad of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', '/wp-admin/', '', undefined]) expect(safeIframeSrc(bad)).toBeNull();
  });
});

describe('withSafeHrefs', () => {
  it('cleans every *href field at any depth and leaves everything else alone', () => {
    const input = {
      title: 'javascript:not-a-link',
      hero: { buttons: [{ label: 'A', href: 'javascript:alert(1)' }, { label: 'B', href: '/brand/hoka/' }] },
      footer: { directions_href: 'data:text/html,x', email: 'verslun@musikogsport.is' },
      items: [{ href: '/a/', children: [{ href: 'vbscript:x', children: [] }] }],
      count: 3,
    };
    expect(withSafeHrefs(input)).toEqual({
      title: 'javascript:not-a-link',
      hero: { buttons: [{ label: 'A', href: '#' }, { label: 'B', href: '/brand/hoka/' }] },
      footer: { directions_href: '#', email: 'verslun@musikogsport.is' },
      items: [{ href: '/a/', children: [{ href: '#', children: [] }] }],
      count: 3,
    });
  });

  it('keeps an empty optional href empty, so "no link" stays distinguishable', () => {
    expect(withSafeHrefs({ directions_href: '' })).toEqual({ directions_href: '' });
  });
});

describe('linkRel (CO-26)', () => {
  it("is noopener for a link opening a new tab or leaving the site, else nothing", async () => {
    const { linkRel } = await import('./safeUrl');
    expect(linkRel('_blank')).toBe('noopener');
    expect(linkRel('_blank', false)).toBe('noopener');
    expect(linkRel('', true)).toBe('noopener');
    expect(linkRel(undefined, true)).toBe('noopener');
    expect(linkRel('')).toBeUndefined();
    expect(linkRel('_self', false)).toBeUndefined();
  });
});
