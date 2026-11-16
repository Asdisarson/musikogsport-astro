// What the home page shows, decided from the WordPress "Forsíða" data (mos/v1/front-page):
// - the hero image is the first banner that has an image; without one, the product slides (on #F5F5F5)
// - the hero text is hero.heading / hero.text / hero.buttons[0], with fallbacks
// - the other banners become story tiles in pairs; an odd one out is shown full width
import type { Banner, FrontPage, WpImage } from './frontPage';

export const HERO_FALLBACK_CTA = { label: 'Skoða nýjungar', href: '/verslun/' } as const;
/** `sizes` for the banner hero's photo (`.hero__img`, object-fit: cover): the width it is drawn at before the crop,
 *  which on a phone is wider than the screen because the hero is taller than the photo's shape. The heights are
 *  global.css `.hero`'s: min(585px, 150vw) up to 991px, min(800px, 56vw) above (its 440px floor never applies there). '100vw' when the size is unknown. */
export function heroBannerSizes(width: number, height: number): string {
  if (!(width > 0 && height > 0)) return '100vw';
  const ratio = width / height;
  const px = (h: number) => `${Math.round(h * ratio)}px`;
  const vw = (h: number) => `${Math.round(h * ratio)}vw`;
  return `(max-width: 991px) max(100vw, min(${px(585)}, ${vw(150)})), max(100vw, min(${px(800)}, ${vw(56)}))`;
}

/** The last resort for a heading, so the hero never renders an empty h1/h2. */
export const HERO_FALLBACK_HEADLINE = 'Nýjungar';

const isRealHref = (href: string) => {
  const h = href.trim();
  return h !== '' && h !== '#';
};

export interface HeroCta {
  label: string;
  href: string;
}

export interface HeroSlidePlan {
  name: string;
  href: string;
  image: WpImage;
}

interface HeroCommon {
  /** The page's h1. Empty only for product slides without a heading: each slide then shows its own name. */
  headline: string;
  text: string;
  cta: HeroCta;
}

export type HeroPlan =
  | (HeroCommon & { kind: 'banner'; image: WpImage })
  | (HeroCommon & { kind: 'product'; slides: HeroSlidePlan[] });

export interface HomePlan {
  hero: HeroPlan | null;
  /** Story rows: two tiles each, the last one may hold a single full-width tile. */
  stories: Banner[][];
}

function pairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

export function planHome(hero: FrontPage['hero'] | undefined, banners: (Banner | null)[]): HomePlan {
  const heroIndex = banners.findIndex((b) => Boolean(b?.image));
  const stories = pairs(banners.filter((b, i): b is Banner => b !== null && i !== heroIndex));
  const heading = hero?.heading.trim() ?? '';
  const text = hero?.text.trim() ?? '';
  // safeHref turns an unsafe link into '#', so '#' (like a blank href) means the button has nowhere to go
  const button = hero?.buttons.find((b) => b.label.trim() && isRealHref(b.href));
  const cta: HeroCta = button ? { label: button.label.trim(), href: button.href.trim() } : { ...HERO_FALLBACK_CTA };
  const slides = (hero?.slides ?? []).flatMap((s) => (s.image ? [{ name: s.name.trim() || HERO_FALLBACK_HEADLINE, href: s.href, image: s.image }] : []));

  const banner = heroIndex >= 0 ? banners[heroIndex] : null;
  if (banner?.image) {
    const firstSlide = hero?.slides.find((s) => s.name.trim())?.name.trim();
    const headline = heading || banner.title.trim() || firstSlide || HERO_FALLBACK_HEADLINE;
    return { hero: { kind: 'banner', image: banner.image, headline, text, cta }, stories };
  }
  if (slides.length > 0) return { hero: { kind: 'product', slides, headline: heading, text, cta }, stories };
  return { hero: null, stories };
}

export type HomeSection = { kind: 'row'; index: number } | { kind: 'stories'; banners: Banner[] };

/** Page order under the hero: product row, story row, product row, story row, … then the rest of either. */
export function homeSections(rowCount: number, stories: Banner[][]): HomeSection[] {
  const out: HomeSection[] = [];
  for (let i = 0; i < Math.max(rowCount, stories.length); i++) {
    if (i < rowCount) out.push({ kind: 'row', index: i });
    if (stories[i]) out.push({ kind: 'stories', banners: stories[i] });
  }
  return out;
}
