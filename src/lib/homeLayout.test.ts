import { describe, expect, it } from 'vitest';
import { homeSections, planHome, HERO_FALLBACK_CTA } from './homeLayout';
import type { Banner, FrontPage, HeroSlide, WpImage } from './frontPage';

const img = (name: string): WpImage => ({ url: `http://localhost:10025/${name}.jpg`, width: 2000, height: 1000, alt: '' });
const banner = (title: string, withImage = true): Banner => ({ image: withImage ? img(title) : null, title, href: `/${title}/` });
const slide = (id: number, name: string, withImage = true): HeroSlide => ({
  id, name, href: `/vara/${id}/`, price: '', regular_price: '', sale_price: '', on_sale: false, price_html: '', image: withImage ? img(`p${id}`) : null,
});
const hero = (over: Partial<FrontPage['hero']> = {}): FrontPage['hero'] => ({ slides: [], heading: '', text: '', buttons: [], ...over });

describe('planHome', () => {
  it('uses the first banner with an image as the hero and pairs the rest into story rows', () => {
    const banners = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((t) => banner(t));
    const plan = planHome(hero({ heading: 'Fyrirsögn', text: 'Texti', buttons: [{ label: 'Vefverslun', href: '/verslun/' }, { label: 'Börn', href: '/b/' }] }), banners);
    expect(plan.hero?.kind).toBe('banner');
    if (plan.hero?.kind !== 'banner') return;
    expect(plan.hero.image.url).toContain('/a.jpg');
    expect(plan.hero.headline).toBe('Fyrirsögn');
    expect(plan.hero.text).toBe('Texti');
    expect(plan.hero.cta).toEqual({ label: 'Vefverslun', href: '/verslun/' });
    expect(plan.stories.map((r) => r.map((b) => b.title))).toEqual([['b', 'c'], ['d', 'e'], ['f', 'g'], ['h']]);
  });

  it('skips null and imageless banners when picking the hero, and keeps imageless ones as stories', () => {
    const plan = planHome(hero({ heading: 'H' }), [null, banner('plain', false), banner('pic'), banner('next')]);
    expect(plan.hero?.kind).toBe('banner');
    if (plan.hero?.kind !== 'banner') return;
    expect(plan.hero.image.url).toContain('/pic.jpg');
    expect(plan.stories.map((r) => r.map((b) => b.title))).toEqual([['plain', 'next']]);
  });

  it('falls back to the banner title for the headline and to the shop link for the CTA', () => {
    const plan = planHome(hero(), [banner('Hlaup')]);
    if (plan.hero?.kind !== 'banner') throw new Error('expected a banner hero');
    expect(plan.hero.headline).toBe('Hlaup');
    expect(plan.hero.cta).toEqual(HERO_FALLBACK_CTA);
    expect(plan.stories).toEqual([]);
  });

  it('ignores blank buttons when choosing the CTA', () => {
    const plan = planHome(hero({ heading: 'H', buttons: [{ label: ' ', href: '/x/' }, { label: 'Skoða', href: '/y/' }] }), [banner('a')]);
    if (plan.hero?.kind !== 'banner') throw new Error('expected a banner hero');
    expect(plan.hero.cta).toEqual({ label: 'Skoða', href: '/y/' });
  });

  it('treats a "#" or blank button href as missing when choosing the CTA', () => {
    const plan = planHome(hero({ heading: 'H', buttons: [{ label: 'Skoða', href: '#' }, { label: 'Tómt', href: '  ' }, { label: 'Hlaup', href: ' /hlaup/ ' }] }), [banner('a')]);
    if (plan.hero?.kind !== 'banner') throw new Error('expected a banner hero');
    expect(plan.hero.cta).toEqual({ label: 'Hlaup', href: '/hlaup/' });
    const none = planHome(hero({ heading: 'H', buttons: [{ label: 'Skoða', href: '#' }] }), [banner('a')]);
    if (none.hero?.kind !== 'banner') throw new Error('expected a banner hero');
    expect(none.hero.cta).toEqual(HERO_FALLBACK_CTA);
  });

  it('never leaves a banner headline empty: heading, then banner title, then the first slide name, then "Nýjungar"', () => {
    const fromSlide = planHome(hero({ heading: '  ', slides: [slide(1, 'Treyja')] }), [banner(' ')]);
    if (fromSlide.hero?.kind !== 'banner') throw new Error('expected a banner hero');
    expect(fromSlide.hero.headline).toBe('Treyja');
    const fallback = planHome(hero(), [banner('')]);
    if (fallback.hero?.kind !== 'banner') throw new Error('expected a banner hero');
    expect(fallback.hero.headline).toBe('Nýjungar');
  });

  it('never gives a product slide a blank name (each slide shows its own name as its heading)', () => {
    const plan = planHome(hero({ slides: [slide(1, '  '), slide(2, ' Jakki ')] }), []);
    if (plan.hero?.kind !== 'product') throw new Error('expected a product hero');
    expect(plan.hero.slides.map((s) => s.name)).toEqual(['Nýjungar', 'Jakki']);
  });

  it('falls back to the product slides when no banner has an image', () => {
    const plan = planHome(hero({ heading: 'H', slides: [slide(1, 'Treyja'), slide(2, 'Jakki'), slide(3, 'Engin mynd', false)] }), [null, banner('plain', false)]);
    expect(plan.hero?.kind).toBe('product');
    if (plan.hero?.kind !== 'product') return;
    expect(plan.hero.slides.map((s) => s.name)).toEqual(['Treyja', 'Jakki']);
    expect(plan.hero.headline).toBe('H');
    expect(plan.stories.map((r) => r.map((b) => b.title))).toEqual([['plain']]);
  });

  it('leaves the product headline empty without a heading, so each slide shows its own name', () => {
    const plan = planHome(hero({ slides: [slide(1, 'Treyja')] }), []);
    if (plan.hero?.kind !== 'product') throw new Error('expected a product hero');
    expect(plan.hero.headline).toBe('');
    expect(plan.hero.slides).toHaveLength(1);
  });

  it('has no hero when there is neither a banner image nor a product slide with an image', () => {
    expect(planHome(hero({ heading: 'H', slides: [slide(1, 'x', false)] }), [banner('plain', false)]).hero).toBeNull();
    expect(planHome(undefined, []).hero).toBeNull();
  });
});

describe('homeSections', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [banner(`s${i}a`), banner(`s${i}b`)]);
  const names = (s: ReturnType<typeof homeSections>) => s.map((x) => (x.kind === 'row' ? `row${x.index}` : `story:${x.banners[0].title}`));

  it('alternates product rows and story rows, then appends what is left of either', () => {
    expect(names(homeSections(2, rows(4)))).toEqual(['row0', 'story:s0a', 'row1', 'story:s1a', 'story:s2a', 'story:s3a']);
    expect(names(homeSections(3, rows(1)))).toEqual(['row0', 'story:s0a', 'row1', 'row2']);
    expect(homeSections(0, [])).toEqual([]);
  });
});
