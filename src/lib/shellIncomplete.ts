// A page rendered with a part missing (a product photo whose colour sampling timed out, an archive whose facet
// counts were not ready) is served as usual but never stored (lib/shellStore): it would stay short for a day.
// The page's frontmatter calls markIncomplete(Astro); src/middleware.ts reads isIncomplete(ctx.locals) after the
// render. Pure; SERVER-ONLY by use.
import type { ShellTier } from './shellPolicy';

export interface ShellLocals {
  shellIncomplete?: boolean;
  shellTier?: ShellTier;
}

/** Tells the store what a page is when its URL can't (a product under /verslun/ is a product, a category there is a
 *  listing): call from the page's frontmatter. Without the call the URL's own tier applies. */
export function setShellTier(astro: { locals: object }, tier: ShellTier): void {
  (astro.locals as ShellLocals).shellTier = tier;
}

export function shellTierOf(locals: object): ShellTier | undefined {
  return (locals as ShellLocals).shellTier;
}

/** Call from a page's frontmatter when the page is about to be served with something missing. */
export function markIncomplete(astro: { locals: object }): void {
  (astro.locals as ShellLocals).shellIncomplete = true;
}

export function isIncomplete(locals: object): boolean {
  return (locals as ShellLocals).shellIncomplete === true;
}
