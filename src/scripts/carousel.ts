// The round-arrow carousels ([data-carousel]: the home product rows, "Þér gæti líkað", the empty cart's
// suggestions, the home Instagram row). Scroll-snap does the sliding; the arrows step one tile at a time. Imported
// by each carousel component: Astro bundles it once per page, so every carousel is bound exactly once.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
document.querySelectorAll<HTMLElement>('[data-carousel]').forEach((root) => {
  const track = root.querySelector<HTMLElement>('[data-carousel-track]');
  const prev = root.querySelector<HTMLButtonElement>('[data-carousel-step="-1"]');
  const next = root.querySelector<HTMLButtonElement>('[data-carousel-step="1"]');
  if (!track || !prev || !next) return;
  // the ends are marked with aria-disabled, so a focused arrow keeps focus; with nothing to scroll the arrows hide
  const isOff = (btn: HTMLElement) => btn.getAttribute('aria-disabled') === 'true';
  const gap = () => parseFloat(getComputedStyle(track).columnGap) || 0;
  const itemWidth = () => track.querySelector<HTMLElement>('li')?.getBoundingClientRect().width || track.clientWidth / 3;
  const sync = () => {
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    prev.setAttribute('aria-disabled', String(atStart));
    next.setAttribute('aria-disabled', String(atEnd));
    root.toggleAttribute('data-carousel-static', atStart && atEnd);
  };
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-carousel-step]');
    const behavior: ScrollBehavior = reduceMotion.matches ? 'auto' : 'smooth';
    if (btn && !isOff(btn)) track.scrollBy({ left: Number(btn.dataset.carouselStep) * (itemWidth() + gap()), behavior });
  });
  track.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  sync();
});
