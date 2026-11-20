// Which links the layout's hover prefetch (layouts/Base.astro) may fetch ahead of a click. CLIENT-safe, pure.
//
// Only the home page and the catalogue: listings and product pages, whose HTML is the same for every visitor and is
// held at the CDN, so fetching one ahead costs the origin little and carries no stock (that arrives live, after the
// page). An allow-list, not a deny-list: a link that is not named here is never fetched ahead, so a page that a
// visit changes (/utskra/ signs out) or that is per shopper (cart, checkout, account, wishlist) cannot slip in.
// Never a URL with a query: a filtered, sorted or searched listing is its own Store API query, kept in memory for
// two minutes at most, and hovering across a row of filter links would start one for each. Nor a later page of a
// listing (…/page/3/): a pointer moving along the pager would fetch them all. The old /vara/<slug>/ address is left
// out too: it only redirects.

const CATALOGUE = [/^\/$/, /^\/verslun\//, /^\/voruflokkur\//, /^\/brand\//, /^\/merkimidar\//];
const LATER_PAGE = /(^|\/)page\/\d+\/?$/;

/** Whether a same-origin link with this path and query (`location.search` form: '' or '?…') may be fetched ahead. */
export function prefetchable(pathname: string, search: string): boolean {
  if (search !== '' && search !== '?') return false;
  // one of our own paths in shape: a single leading slash, no backslash, no dot segment
  if (!/^\/(?![/\\])[^\\]*$/.test(pathname) || /(^|\/)\.\.?(\/|$)/.test(pathname)) return false;
  return !LATER_PAGE.test(pathname) && CATALOGUE.some((re) => re.test(pathname));
}
